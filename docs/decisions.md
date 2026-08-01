# Project decisions

This file records behavior that future edits must preserve.

## Product boundary

Gatecrash is an authorization boundary mapper. It replays captured requests
with named profiles and compares responses. It does not crawl a browser,
generate exploit payloads, infer business policy, or declare a vulnerability.

`gatecrash inspect` is the safe first step. It parses the same config and capture
as `check`, but it does not resolve environment secrets or send traffic.

## Network rules

- Every request must match `target.origin` exactly, both during preparation and
  immediately before replay.
- URLs with embedded credentials are rejected.
- `GET`, `HEAD`, and `OPTIONS` are the only default methods.
- Another method runs only when the user names it with `--allow-method`.
- Redirect mode stays `manual` so a replay cannot leave scope.
- Capture ingestion uses a small header allowlist: `Accept`, `Accept-Language`,
  and `Content-Type`.
- Session headers come from profile configuration. `Host`, `Content-Length`,
  raw `Cookie`, hop-by-hop headers, and control characters are rejected.
- Capture files stop at 100 MB or 100,000 entries. A run stops before network
  work when its route and profile plan exceeds 100,000 replays.
- Unknown config keys are errors. The profile count stops at 64 and each
  profile header or cookie map stops at 128 entries.
- A network change needs tests for scope, secrets, headers, and unsafe methods.

## Report privacy

Reports may contain origins, paths without query values, query names, profile
names, status codes, sizes, timings, body kinds, and comparison results. Reports
must not contain request headers, response headers, cookies, tokens, request
bodies, response bodies, or query values.

The input label is a basename, not a local directory path. Route IDs are
report-local ordinals. Finding IDs derive from those ordinals and profile names,
never from URL values or request bodies.

Saved files are replaced atomically and use mode `0600` where supported. Schema
changes increment `schemaVersion` and include a compatibility note in the
changelog.

## Terminal behavior

The live UI is inline. Do not use the alternate screen or issue a clear-screen
sequence. Progress can update in place, but the completed report must remain in
scrollback.

Wide terminals use profile columns. Narrow terminals use stacked route tracks.
Non-TTY output is plain text. JSON stdout contains JSON only.

Color supports labels but never carries meaning by itself. Keep route status,
finding IDs, outcome glyphs, and next commands readable with `NO_COLOR=1`.

## Brand system

The name is Gatecrash and the command is `gatecrash`. The line is "Same request.
Wrong session." The mark is a request diamond crossing a split gate. Keep the
full mark for welcome and first-run moments, then use the compact `◆╾┫` mark
during work.

The terminal uses patch-bay channels and status lamps as functional structure.
Avoid generic security imagery, glow effects, and nested boxes.

## Classification

Comparison is deterministic. JSON uses structure and token overlap after
configured volatile keys are replaced. HTML uses tag structure and visible
text. A result is called `review`, not `vulnerable`. The default similarity
threshold is `0.92`.

Exit codes are `0` for a completed run, `1` for an operational failure, and `2`
for review results when `--fail-on-review` is active.

## Regression gate

Run `npm run check` and `npm run demo`. A network or privacy fix gets a fixture
that fails without it. Inspect output must remain free of session values,
captured headers, request bodies, and query values.
