# Project decisions

This file records behavior that future edits should preserve.

## Product boundary

Guestlist is an authorization mapper. It replays captured requests with named
profiles and compares responses. It does not crawl a browser, generate exploit
payloads, infer business policy, or declare a vulnerability.

## Network rules

- Every request must match `target.origin` exactly.
- `GET`, `HEAD`, and `OPTIONS` are the only default methods.
- An unsafe method runs only when the user names it with `--allow-method`.
- Redirect mode stays `manual` so a replay cannot leave scope.
- Captured credentials and hop-by-hop headers are removed before profile headers are applied.
- A network change needs tests for scope, secrets, and unsafe methods.

## Report privacy

Reports may contain origins, paths without query values, query names, profile
names, status codes, sizes, timings, and comparison results. Reports must not
contain request headers, response headers, cookies, tokens, request bodies,
response bodies, or query values. Saved files use mode `0600` where supported.

Schema changes increment `schemaVersion` and include a compatibility note in
the changelog.

## Terminal behavior

The interactive UI is inline. Do not use the alternate screen or clear the
user's scrollback. Widths below 76 columns use stacked route cards. Non-TTY
output is plain text. JSON stdout contains JSON only.

Color supports the labels but never carries meaning by itself. Keep route
status, finding IDs, and next commands readable with `NO_COLOR=1`.

## Classification

Comparison is deterministic. JSON uses structure and token overlap after
configured volatile keys are replaced. HTML uses tag structure and visible
text. A result is called `review`, not `vulnerable`. The default similarity
threshold is `0.92`.

Exit codes are `0` for a completed run, `1` for an operational failure, and `2`
for review results when `--fail-on-review` is active.

## Regression gate

Run `npm run check` and `npm run demo`. A bug fix gets a fixture or an
integration assertion that fails without the fix.
