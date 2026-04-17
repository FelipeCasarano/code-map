# tiny-app example

A two-line project to demonstrate the install path on a brand-new repo.

```bash
cd examples/tiny-app
node ../../src/cli/index.js sync
node ../../src/cli/index.js resolve greet
node ../../src/cli/index.js impact src/index.js
```

That's the whole loop. After `sync`, every later command reads only `.code-map/` - it never re-walks the source tree.
