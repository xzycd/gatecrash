# Contributing

Guestlist is deliberately narrow. Open an issue before adding a new network
mode or report concept. Small fixes can go straight to a pull request.

## Local checks

```bash
npm install
npm run check
npm run demo
```

Use Node 22.12 or newer. Tests should not contact the public internet. The demo
and integration suite bind only to `127.0.0.1` on an available port.

Read [docs/decisions.md](docs/decisions.md) before changing replay behavior,
classification, terminal rendering, or saved output. A network bug needs a
test that proves credentials, scope, and unsafe methods still behave correctly.

Keep public prose plain. Describe the current program instead of narrating a
diff. Do not paste real captures, tokens, customer routes, or response bodies
into an issue.
