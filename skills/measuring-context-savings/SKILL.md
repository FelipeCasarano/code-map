---
name: measuring-context-savings
description: Read and report the token savings the Code Map plugin produced this session, compared against a naive baseline. Trigger when the user asks "how much did we save?", "show stats", or wants a per-session report.
---

# Measuring Context Savings

The plugin records every tool call to `.code-map/sessions/<id>.jsonl` with `raw_candidate_tokens`, `delivered_tokens`, latency, and ok flag.

## Per-session summary

Run `cm stats` (defaults to session id `default`, or whatever `CM_SESSION` env var holds).
The result includes:
- `events`: number of plugin calls
- `raw_candidate_tokens`: tokens the naive baseline would have shipped
- `delivered_tokens`: tokens actually delivered to the agent
- `saved_tokens` and `saved_percent`: the difference
- `median_latency_ms`: speed
- `ok_rate`: share of calls that returned a hit

## Benchmark report

Run `npm run benchmark` for the fixture suite, or `node scripts/benchmark-self.js` for the larger self-test.
Each writes a snapshot to `.code-map/benchmark.json` containing per-task hits, recall, and a composite score.

## What to report

When the user asks for savings, prefer:
1. Headline: `saved_percent` and `saved_tokens` for the current session.
2. Caveats: the naive baseline assumes the agent would otherwise have read full candidate files. Real-world savings depend on how a given agent retrieves context.
3. Sanity check: confirm `ok_rate` is high. Cheap-but-wrong is not savings.
