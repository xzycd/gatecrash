# Contributing

Gatecrash is deliberately narrow. Open an issue before adding a network mode or
report concept. Small fixes can go straight to a pull request.

## Local checks

```bash
npm install
npm run check
npm run demo
```

Use Node 22.12 or newer. Tests must not contact the public internet. The demo
and integration suite bind only to `127.0.0.1` on an available port.

Read [docs/decisions.md](docs/decisions.md) before changing replay behavior,
classification, terminal rendering, or saved output. A network change needs a
test that proves credentials, scope, captured headers, and unsafe methods still
behave correctly.

Keep public prose plain. Describe the current program instead of narrating a
diff. Do not paste real captures, tokens, target routes, headers, query values,
or response bodies into an issue.
