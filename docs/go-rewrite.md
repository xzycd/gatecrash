# Should Gatecrash be rewritten in Go?

Short answer: not yet, and probably not for the reason it would be done.

The case for Go is real but it is a case about *distribution*, not about the
language. Almost all of it can be tested for a day's work instead of a rewrite.
This document records the measurements so the question does not have to be
re-argued from memory.

## What was measured

On this machine, Node 26, after `npm run build`:

| | |
|---|---|
| `gatecrash --version`, cold, mean of 10 | **82 ms** (max 100 ms) |
| bare `node -e ''` | **30 ms** |
| `import 'commander'` | 12 ms |
| `import 'yaml'` | 9 ms |
| `import 'parse5'` | 7 ms |
| `gatecrash demo`, full run, mean of 5 | **314 ms** |
| source to port | 4,955 lines across 30 files |
| tests to re-earn | 1,265 lines |
| runtime dependency tree | 3 direct, 5 total |
| external imports in the whole codebase | `commander`, `parse5`, `yaml` |

So of the 82 ms before the tool does anything, 30 ms is Node existing, ~28 ms is
those three imports, and the remaining ~24 ms is Gatecrash's own thirty modules.
A Go binary would start in about 5 ms.

## What Go would actually buy

1. **A single static binary.** Today the install path is
   `npm i -g @xzycd/gatecrash` and it needs Node ≥ 22.12. For a tool people run
   on a jump box, in a container, or from a CI image they did not build, "there
   is a binary" is a real feature and the strongest argument in the pile.
2. **~77 ms back per invocation.** Worth having. Worth noticing that it is 26%
   of a three-route demo against localhost and rounds to nothing against any
   capture with real network in it — the run is dominated by
   `target.requests_per_second`, which defaults to 2.
3. **A concurrency model that fits.** `runWorkers` and `RateGate` in
   `src/core/replay.ts` are a worker pool and a token bucket written by hand
   because JavaScript has neither. Goroutines, channels, and
   `golang.org/x/time/rate` are that code deleted.
4. **A smaller supply chain.** 111 packages in `node_modules` becomes a `go.sum`
   with about three lines in it. For a security tool this is not nothing.

Every dependency has a direct equivalent: `net/http` for `fetch`,
`golang.org/x/net/html` for `parse5`, `gopkg.in/yaml.v3` for `yaml`, `flag` or
`cobra` for `commander`. Nothing here is hard.

## What it would cost

1. **6,220 lines rewritten**, and the tests re-earned rather than translated. The
   tests are the part that encodes what the tool refuses to do; a port that
   passes a translated suite has proved less than it looks.
2. **The entire release apparatus is npm-shaped, and it is the good part.**
   `docs/decisions.md` commits to trusted publishing over OIDC with provenance,
   a reviewed `npm-shrinkwrap.json`, a staged release a maintainer approves with
   2FA, and GitHub releases held as drafts until the npm version is public so
   the updater can never advertise a version that cannot be installed. None of
   that survives the move. It would be replaced by GoReleaser, a per-platform
   build matrix, checksums, and signing — all of which is achievable and none of
   which exists yet.
3. **`gatecrash update` does not get simpler in Go.** It already downloads the
   release archive through a bounded reader and matches it against
   `SHA256SUMS` before npm installs that exact local file. A Go build could
   reuse the same trust boundary, but it would also need per-platform asset
   selection and an authenticity story stronger than a checksum published
   beside the binary. The bounded download and digest code now exists; the
   multi-platform distribution and signing work does not.

## The experiment to run first

The pain being solved is "it needs Node installed" plus "it takes a tenth of a
second to start". Both can be tested without touching the language:

- Node ships **Single Executable Applications**, and `bun build --compile`
  produces a standalone binary from the same TypeScript.
- The import graph is small enough to make this plausible: 30 files, three
  external packages, no dynamic `require`, no native addons, no plugin loading.

If a single binary comes out the other side, Go's headline advantage is gone and
the release pipeline stays intact. If it does not, and shipping a binary is a
hard requirement, Go is a reasonable answer.

## If it does happen

The port is meaningfully cheaper than it was before this branch. The UI used to
be React and Ink — a component tree, a reconciler, and a flexbox layout engine,
none of which has a Go equivalent, and easily the least portable thing in the
repository. It is now about 900 lines that build strings and count columns:
`src/ui/ink.ts`, `src/ui/view.ts`, `src/ui/motion.ts`. That maps to Go almost
line for line.

Port order, if it comes to it: `core/` first behind the existing JSON report
schema, so both implementations can be run against the same capture and
diffed; `ui/` second; `update` last, because it is the piece that has to be
argued about rather than translated.

## Decision

Keep TypeScript. Run the single-binary experiment. Revisit this document with
the result rather than with an opinion.
