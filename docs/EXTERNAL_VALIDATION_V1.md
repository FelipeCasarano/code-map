# Code Map — Validação Externa em Repo Real (sem viés)

**Data:** 2026-04-29
**Repo testado:** `expressjs/express` (clonado fresh em `external-express/` — 132 arquivos JS, 2.465.216 tokens corpus, **nunca foi visto durante o desenvolvimento do plugin**).
**Objetivo:** validar se os ganhos da iteração interna se mantêm em código de produção real, ou se eram artefato dos repos sintéticos (`realworld-node`, `greenfield-mini-api`, `adversarial-repo`).

---

## 1. Como evitei viés

- **Repo escolhido sem prévia**: `expressjs/express`. Nunca executei o plugin contra ele antes desta seção. O índice `.code-map/` nem existia até a primeira chamada de sync.
- **Ground truth verificado por grep + leitura**, não por lembrança. Cada `expected_top1` foi confirmado com `grep -n` no arquivo correto antes de gravar a suíte.
- **Mesma harness e mesma baseline** das medições internas — nenhum tuning específico foi feito.
- **Mesmo binário do Code Map**: variantes idênticas (`default` e `v6-payload-slim` final).
- **Mesmo critério de tokens**: `JSON.stringify(payload).length / 3.6 − newlines × 0.15` em ambos os lados.

Suíte: [`code-map/scripts/harness/suite-external.json`](../scripts/harness/suite-external.json). 16 tarefas (10 locate, 6 impact). Resultados em [`scripts/harness/results/ext-before.json`](../scripts/harness/results/ext-before.json) e [`ext-after.json`](../scripts/harness/results/ext-after.json).

Como rodar:
```bash
cd code-map
node scripts/harness/run.js --suite=suite-external.json --variant=default --fresh --out=scripts/harness/results/ext-before.json
node scripts/harness/run.js --suite=suite-external.json --variant=v6-payload-slim --fresh --out=scripts/harness/results/ext-after.json
```

---

## 2. Resultados externos — números reais

### 2.1 Agregado (16 tarefas, repo `expressjs/express`)

| Métrica | CM antes | CM depois | Baseline grep+read |
|---|---|---|---|
| Top-1 locate | 0.30 | **0.30** | 0.40 |
| Top-3 locate | 0.30 | 0.30 | **0.80** |
| Impact F1 | 0.30 | **0.44** | 0.17 |
| Impact recall | 1.00 | 1.00 | 0.83 |
| Impact precision | 0.18 | 0.27 | 0.10 |
| Tokens entregues | 15.233 | **861** | 113.263 |
| Saves vs baseline | 86.6% | **99.2%** | — |

### 2.2 Comparação com a suíte interna

| Métrica | Interna depois | **Externa depois** | Diferença |
|---|---|---|---|
| Top-1 | 0.90 | **0.30** | **−0.60** ⚠️ |
| Top-3 | 1.00 | **0.30** | **−0.70** ⚠️ |
| Impact F1 | 0.70 | 0.44 | −0.26 |
| Impact recall | 0.83 | 1.00 | +0.17 |
| Saves vs baseline | 95.0% | 99.2% | +4.2 pp |

**O headline é honesto:** a iteração que entregou 95% interno **não generaliza para locate em código JS de produção**. Os ganhos de impact e tokens persistem; locate desabou. Isso era invisível na suíte interna porque os repos sintéticos usam estilos de declaração que o parser cobre (`function X()`, ES6 classes, TS).

Quanto à economia de tokens em relação ao corpus bruto (2.465.216): CM depois entregou 861 tokens = **99.965% de redução vs ler tudo**. Esse número é verdadeiro mas pouco útil quando 70% das respostas são erradas.

---

## 3. Gargalos diagnosticados (causa raiz, não sintoma)

Cada gargalo abaixo foi verificado com diagnóstico direto, não inferência. As linhas e arquivos estão concretos para um agente atacar.

### G1 — Parser ignora `exports.X = function`, `app.X = function`, `res.X = function` (CRÍTICO)

**Evidência:** [src/core/parser.js:104-122](../src/core/parser.js) — os 4 padrões regex cobrem `function name`, `const name = function`, `class name`, `method-in-class`. Nenhum cobre **method assignment to object**, que é o estilo dominante em JS Node clássico.

**Confirmado em diagnóstico direto:**
- `parseFile("lib/utils.js")` retorna apenas `{acceptParams, createETagGenerator, parseExtendedQueryString}` — **falta** `etag, wetag, normalizeType, normalizeTypes, compileETag, compileQueryParser, compileTrust, setCharset` (8 símbolos exportados, todos como `exports.X = function`).
- `parseFile("lib/application.js")` retorna apenas `{logerror, tryRender}` — **falta** `app.handle, app.engine, app.listen, app.route, app.param, app.render, app.use, app.set, app.get, app.init` etc.
- `parseFile("lib/response.js")` similar: faltam `res.send, res.json, res.sendFile, res.cookie, res.jsonp, res.status, res.sendStatus, res.render, etc.`

**Efeito prático:** 7 das 10 queries de locate falham top-1 (`app.handle, app.engine, app.listen, res.cookie, res.jsonp, View, compileETag`). Para o estilo Express, **a maioria absoluta dos símbolos públicos não existe no índice**.

**Severidade:** CRÍTICA. É o gargalo dominante. Sozinho ele explica a queda de top-1 de 0.90 → 0.30.

### G2 — Resolver não normaliza queries dotted (`obj.method`)

**Evidência:** diagnóstico de `cm_resolve("app.handle")` retorna `layer: null, hits: []`. Mesmo se o parser extraísse `handle`, a query `app.handle` não casaria com a alias `handle` porque o resolver compara strings inteiras lowercased.

**Efeito prático:** mesmo após corrigir G1, queries naturais como `app.handle`, `res.cookie`, `User.findById`, `db.query` continuariam falhando. Agentes naturalmente referenciam métodos com o objeto.

**Severidade:** ALTA — necessária junto com G1.

### G3 — Resolver não diferencia lib vs test quando scores empatam

**Evidência:** `cm_resolve("View")` na external-express retornou 3× `test/app.render.js` antes de `lib/view.js`, porque o teste contém múltiplas declarações `function View(name, options)` (mocks) e o parser as registra como aliases idênticas a 0.92. Como o alias map é um array por chave, a ordem de inserção importa, e tests vêm depois das libs alfabeticamente em alguns scans.

**Efeito prático:** consultas a símbolos comuns ranqueam mocks de teste antes da implementação real. Veja `ext-locate-View top1=0` apesar de o símbolo existir.

**Severidade:** ALTA. `search.js` já tem `× 0.85` para test files (linha 65), mas **resolver ignora isso**.

### G4 — Layer "fuzzy-basename" do resolver vence layers de símbolo quando query parece nome de arquivo

**Evidência:** `cm_resolve("app.engine")` retornou `test/app.engine.js` via `fuzzy-basename` porque o nome do arquivo de teste é literalmente `app.engine.js`. O resolver achou que era match de path antes de cair em search.

**Efeito prático:** queries como `res.cookie`, `app.listen`, `app.engine` casam com nomes de teste e top-1 fica errado.

**Severidade:** ALTA. Bug de ordenação de camadas no resolver.

### G5 — Impact ainda traz ruído alto em precision (P=0.27 externo)

**Evidência:** `ext-impact-utils` retorna 6 arquivos quando o gabarito tem 3 (P=0.33). `ext-impact-application` traz 4 arquivos quando o gabarito tem 1 (P=0.25).

**Causa:** mesmo o `impactPrecise` segue arestas `affects` (anchor-derivadas) e `tested_by` em demasia em monorepos com muitos tests indiretos. Em Express, mexer em `application.js` "afeta" via test discovery muitos arquivos de teste, mas o gabarito honesto pede só `lib/express.js` (que requires `application`).

**Severidade:** MÉDIA. Recall ótimo (1.0), precision baixa. Para impact precisaria de **modos de pergunta**: "afeta apenas direto" vs "afeta transitivo".

### G6 — Top-3 baseline 0.80 vs CM 0.30 (locate)

**Evidência:** quando CM falha top-1 ele falha top-3 também — porque os 3 hits são mocks/testes do mesmo nome. Baseline grep com fallback de leitura espalha mais por arquivos diferentes, então top-3 ainda pega o lib correto às vezes.

**Severidade:** ALTA, derivado de G1+G3+G4. Resolver fica em "desconfiança alta dentro de uma camada errada" em vez de espalhar candidatos.

### G7 — Falta sinal de baixa confiança / fallback automático

**Evidência:** `cm_resolve("compileETag")` retornou `test/utils.js` (que tem `var utils = require('../lib/utils')`) com layer `symbol-contains` — score 0.5. Não há indicador de "isto é fraco, considere search ou rg". Agente que confia top-1 erra.

**Severidade:** MÉDIA. Calibragem de confiança ausente.

---

## 4. Plano otimizado para agents de IA aplicarem (priorizado por ROI)

Cada item é projetado para ser **executável por um agente sozinho**, com critério de aceitação automático (rodar a harness externa). Tempo estimado é para um agente Claude trabalhando em foco.

### Tarefa A1 — Estender parser JS para method-assignment (G1) 🔴 CRÍTICA

**Onde:** [`src/core/parser.js`](../src/core/parser.js), `extractJSSymbols()`.

**O que adicionar:** três regex novas:
```js
// exports.NAME = function NAME?(...) | exports.NAME = (...) =>
{ kind: "function", re: /^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/gm },
// IDENT.NAME = function NAME?(...)   (proto/method on object)
{ kind: "method", re: /^\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/gm },
// IDENT.prototype.NAME = function ...
{ kind: "method", re: /^\s*([A-Za-z_$][\w$]*)\.prototype\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/gm },
```
Para os dois últimos, registrar **dois nomes**: `name` (e.g., `handle`) e um `qualifiedName` (e.g., `app.handle`). Isso alimenta os matches de G2.

**Critério de aceitação:** rodar `node scripts/harness/run.js --suite=suite-external.json --variant=v6-payload-slim --fresh` deve elevar `top1_acc` de 0.30 para **≥ 0.70**. Sem isso, A1 não é considerado feito.

**Impacto esperado:** +0.40 em top-1 sozinho. É a única tarefa que justifica todas as outras.

**Risco:** falsos positivos em código que faz `obj.X = anything` não-funcional. Mitigar: regex exige `function` ou arrow `=>` no RHS.

### Tarefa A2 — Resolver aceita queries dotted (G2) 🔴 CRÍTICA

**Onde:** [`src/core/resolver.js`](../src/core/resolver.js).

**O que adicionar:** **antes** da camada 7, expandir a query: se contém `.`, dividir e tentar:
1. `qualifiedName` exato no índice de aliases (precisa do parser A1 emitindo qualifiedNames).
2. Cair para `lastSegment` (ex.: `app.handle` → `handle`) em alias.
3. Penalizar match cujo arquivo é teste se a query não tem `test|spec`.

**Critério de aceitação:** queries `app.handle, res.cookie, app.engine, app.listen, res.jsonp` retornam `lib/application.js` ou `lib/response.js` em top-1. Verificar via `cm_resolve` direto.

**Impacto esperado:** sem A2, ganhos de A1 ficam parciais.

### Tarefa A3 — Resolver aplica role-penalty (G3) 🟠 ALTA

**Onde:** `src/core/resolver.js`, na lista final antes do sort.

**O que adicionar:**
```js
// Apply role boost: penalize test-role hits when query has no test intent.
const queryHasTestIntent = /test|spec/i.test(q);
for (const h of hits) {
  if (!queryHasTestIntent && (/\btests?\b/.test(h.rel) || /\.spec\.|\.test\./.test(h.rel))) {
    h.score *= 0.7;
  }
}
```
**Critério de aceitação:** `cm_resolve View` retorna `lib/view.js` em top-1, não `test/app.render.js`.

**Impacto esperado:** +0.10 a +0.15 top-1 em qualquer repo com testes que repliquem fixtures.

### Tarefa A4 — Reordenar camadas: symbol antes de fuzzy-basename (G4) 🟠 ALTA

**Onde:** `src/core/resolver.js`. Hoje a camada 6 (`fuzzy-basename`) executa antes da 7 (`symbol-contains`); pior, o fuzzy-basename casa nomes de arquivo de teste com queries dotted.

**O que mudar:** pular `fuzzy-basename` quando a query tem `.` (é claramente uma referência simbólica, não um path) ou penalizar fuzzy-basename de arquivos test-role no caso default.

**Critério de aceitação:** `cm_resolve "app.engine"` não retorna `test/app.engine.js` em top-1.

**Impacto esperado:** +0.10 top-1.

### Tarefa A5 — Impact com modo "direto" vs "transitivo" (G5) 🟡 MÉDIA

**Onde:** [`src/core/impact.js`](../src/core/impact.js) e [`src/core/graph.js`](../src/core/graph.js) (`impactPrecise`).

**O que adicionar:** opção `mode: "direct" | "transitive"`. Em `direct`, depth=1 e propagateRules sem `affects` (anchors). Em `transitive`, manter atual. Em payload slim, default = direct para precision; `cm_impact ... --transitive` para recall.

**Critério de aceitação:** `ext-impact-utils` em modo direto sobe precision para ≥ 0.50 sem perder recall ≥ 0.67.

**Impacto esperado:** +0.10 a +0.15 F1 médio em repos médios/grandes.

### Tarefa A6 — Confidence + auto-fallback explícito (G7) 🟡 MÉDIA

**Onde:** `src/core/index.js` ou wrapper novo em `src/core/explain.js`.

**O que adicionar:** se `result.layer in ["symbol-contains","fuzzy-basename"]` ou `hits[0].score < 0.7`, anotar `result.confidence = 0.4` e devolver flag `result.suggest_fallback = "rg"` no slim payload. Nada bloqueia o agente, apenas sinaliza.

**Critério de aceitação:** todas as queries que falharam top-1 no external retornam `confidence < 0.5` e `suggest_fallback === "rg"`. Agentes externos podem usar isso para acionar grep automaticamente.

**Impacto esperado:** sem mudar métricas brutas, **muda decisão do agente**. Se o agente cair em rg quando confidence baixa, top-1 efetivo do sistema (CM+rg) sobe sem sacrificar tokens nos casos onde CM acerta.

### Tarefa A7 — Adicionar à suíte: prototype-style methods, exports.X (G1, G3) 🟡 MÉDIA

**Onde:** [`scripts/harness/suite.json`](../scripts/harness/suite.json).

**O que adicionar:** 6-8 tarefas extras inspiradas no Express, plus uma fixture sintética `protostyle-fixture/` que reproduza `app.X = function`, `exports.X = function`, `Class.prototype.X` e métodos sobrescritos em testes.

**Critério de aceitação:** suíte cresce de 16 → ≥ 24 tarefas; rodar nova suíte interna deve manter top-1 ≥ 0.85 e impact F1 ≥ 0.65 após A1-A4.

**Impacto esperado:** evita regressão futura. Prevenção, não cura.

### Tarefa A8 — Tree-sitter atrás de flag, só JS/TS (Fase 4 do plano original) 🟢 BAIXA

**Onde:** novo `src/core/parser-ts.js`. Adicionar `tree-sitter` + `tree-sitter-javascript` + `tree-sitter-typescript` como deps opcionais.

**O que adicionar:** quando `CM_PARSER_TS=1` e o arquivo é `.js/.ts`, usar AST nativo. Senão, regex.

**Critério de aceitação:** rodar suíte externa com `--variant=tree-sitter` deve igualar ou superar `v6-payload-slim` em top-1 e F1, sem custo de >2× latência de sync.

**Impacto esperado:** elimina G1-G4 estruturalmente. Caro porque adiciona dependência nativa. Só faz sentido se A1-A6 não bastarem em outras linguagens.

---

## 5. Ordem recomendada de execução para um agente

1. **A1** (sozinho deve subir top-1 de 0.30 → ~0.65)
2. Re-rodar harness externa, registrar
3. **A2 + A3 + A4** combinados (deve subir para ~0.85)
4. Re-rodar
5. **A6** (não muda métricas brutas, mas habilita comportamento de agente híbrido)
6. **A5** (impact precision)
7. **A7** (prevenção de regressão — fazer ANTES de seguir adiante)
8. Avaliar: se top-1 ≥ 0.85 e F1 ≥ 0.65 em suíte ampliada, **parar**. **A8 só se ainda não bastar.**

**Critério global de "pronto":** rodar a harness externa no Express, em outro repo TS (ex.: `microsoft/typescript` clonado parcial), e em um Python (ex.: `psf/requests`) sem cair top-1 abaixo de 0.80 ou F1 abaixo de 0.60. Isso valida sem viés.

---

## 6. Antes/depois final desta validação

| Cenário | Fonte do número | Top-1 | Top-3 | F1 | Tokens | Saves vs BL |
|---|---|---|---|---|---|---|
| Suíte interna — Code Map default | `before-final.json` | 0.90 | 0.90 | 0.48 | 10.040 | 45.4% |
| Suíte interna — Code Map otimizado | `after-final.json` | 0.90 | 1.00 | 0.70 | 920 | 95.0% |
| **External Express — default** | `ext-before.json` | **0.30** | 0.30 | 0.30 | 15.233 | 86.6% |
| **External Express — otimizado** | `ext-after.json` | **0.30** | 0.30 | 0.44 | **861** | **99.2%** |

**Leitura honesta:** o trabalho da iteração interna entregou os ganhos prometidos **na suíte que ele otimizou**. Em código real Node clássico ele **economiza 99% de tokens, mas com top-1 de só 30%**. Para um agente real, isso seria um produto que custa pouco e erra muito — provavelmente pior que rg honesto.

**O caminho para "útil de verdade":** A1+A2+A3+A4 são suficientes para tirar locate do buraco. A8 (tree-sitter) só vira prioridade se A1-A4 não generalizarem para Python/Go.

---

## 7. Abrindo a auto-crítica

- **A suíte interna induziu confiança falsa.** Os repos sintéticos foram escritos no estilo "function/class/method-in-class", que é exatamente o que a regex cobre. Quando colidiu com Express (object-method-assignment), tudo desabou.
- **G1 deveria ter sido detectado antes.** Se eu tivesse rodado a iteração contra Express desde a primeira camada, teria gasto menos tempo otimizando token-savings (que já estava bom) e mais tempo no parser. Lição.
- **A4 e A5 (impact por modo) já estavam latentes nos números internos** (precision baixa em todos os cenários), mas eu aceitei porque o F1 médio passou da baseline. Externamente fica claro que precision precisa de mais atenção.

Conclusão honesta: o número "95% savings" do relatório anterior é verdadeiro para aquela suíte; **não é projeção válida para uso real até que A1-A4 estejam aplicados e validados externamente**. Veredito atualizado: ainda **promissor, mas a prioridade clara agora é parser, não otimização de payload**.
