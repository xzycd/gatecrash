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
- The `control` session sends the route's own captured headers and nothing
  else: no profile headers, no cookies, no credential of any kind. It obeys
  every rule the configured profiles do — same origin check, same method
  allowlist, same rate gate, same response cap. `control` is a reserved profile
  name so a configuration cannot shadow it.
- Capture files stop at 100 MB or 100,000 entries, and a single captured request
  body stops at 8 MB. A run stops before network work when its route and profile
  plan exceeds 100,000 replays.
- Files are read through a bounded read on an open descriptor. A size taken from
  a path does not describe the file that is then read from it.
- Unknown config keys are errors. The profile count stops at 64 and each
  profile header or cookie map stops at 128 entries.
- A network change needs tests for scope, secrets, headers, and unsafe methods.

## Report privacy

Reports may contain origins, paths without query values, query names, profile
names, status codes, sizes, timings, body kinds, and comparison results. Reports
must not contain request headers, response headers, cookies, tokens, request
bodies, response bodies, or query values.

A query part with no `=` is a value, not a name. It is recorded only when it
still reads as a name after identifier normalization, so a bare token in a query
string never becomes a "query name" and survives into a saved report.

`inspect` labels its input with a basename for the same reason `check` does.
Neither may put a local directory path into terminal or JSON output.

The input label is a basename, not a local directory path. Route IDs are
report-local ordinals. Finding IDs derive from those ordinals and profile names,
never from URL values or request bodies.

Saved files are replaced atomically and use mode `0600` where supported. Schema
changes increment `schemaVersion` and include a compatibility note in the
changelog.

## Self-update rules

- `gatecrash update` reads stable releases only from the public
  `xzycd/gatecrash` GitHub repository. Drafts, prereleases, non-semantic tags,
  unexpected page URLs, and unexpected asset URLs are rejected.
- A release must contain the npm archive name produced by `npm pack` and a
  `SHA256SUMS` file. Both downloads are size-capped, and the archive checksum
  must match before npm starts.
- npm installs only the verified local archive, with lifecycle scripts disabled.
  Temporary archives are private and removed after the install attempt. On
  Windows, the required command interpreter receives only fixed arguments and a
  validated, locally generated archive path.
- `--check` performs no download or installation. Downgrades require a specific
  version and `--force`; a development build newer than GitHub's latest release
  is left unchanged.

## npm publishing rules

- `@xzycd/gatecrash` is a public scoped package. Release tags must exactly match
  the package and source versions before packaging starts.
- Published CLI dependencies use `npm-shrinkwrap.json` so global installations
  resolve the reviewed dependency graph.
- Normal npm releases use GitHub Actions trusted publishing with OIDC and
  provenance. The workflow receives no long-lived npm token.
- The trusted publisher may stage a package but cannot make it public. A
  maintainer reviews and approves each staged release with 2FA.
- GitHub releases remain drafts until the matching npm version is public, so
  the updater never advertises a version that npm cannot install.
- Release jobs do not share npm's OIDC permission with the third-party GitHub
  release action.

## Terminal behavior

The UI builds strings and counts columns. There is no component tree and no
layout engine. Plain output is the same code path with an `Ink` that has no
colour and no links, which is what keeps terminal and plain output from drifting
apart.

Three capabilities degrade independently: colour from 24-bit to the 256 palette
to none, box drawing to ASCII when the terminal cannot promise UTF-8, and
hyperlinks to plain text. A terminal missing one still gets the best of the
others.

The live line is a single line on stderr, drawn on a timer rather than from
inside the work loop, and erased when the run ends. Progress redrawn from the
work loop freezes whenever the run blocks, which looks exactly like a run that
died. It is inline: no alternate screen, no clear-screen sequence, and the
completed report stays in scrollback. It is never drawn in front of `--format
json` or `--format markdown`.

Wide terminals use profile columns. Narrow terminals use stacked route tracks.
Non-TTY output is plain text. JSON stdout contains JSON only.

A map row is one endpoint, not one route. Routes sharing a normalized pattern
fold into a single row carrying the worst result any member produced, marked
`×N`, so folding a family can only promote a result up the page and never bury
one. A family of one shows its concrete path.

Counts on one line share one denominator and say which. The summary is two
lines because comparisons and routes are different things being counted, and
`180 routes · 188 review` is a number that makes a reader stop trusting the
page.

No view may exceed the width it was given, at any width. The subject in a header
and the aside in a footer are what give way; the label, the counts, and the next
command are not.

Colour supports labels but never carries meaning by itself. Every outcome mark
is distinct from every other in both the Unicode and ASCII sets. Keep route
status, finding IDs, outcome glyphs, and next commands readable with
`NO_COLOR=1`.

Untrusted text reaches a terminal only through `terminalText`, which removes
control, bidi, and zero-width characters. A path from a capture can otherwise
repaint the screen or reorder what it appears to say.

## Brand system

The name is Gatecrash and the command is `gatecrash`. The line is "Same request.
Wrong session." The mark is a request diamond crossing a split gate. Keep the
full mark for welcome and first-run moments, then use the compact `◆╾┫` mark
during work.

The full mark is a five-row block wordmark with the gate beside it, drawn at the
largest of four sizes that fits and replaced by a plain line below forty
columns. Block letters that run past the edge do not degrade, they shred.

A severity rail down the left is what makes a block read as one result. A box is
used exactly once, for a byte-identical match on a response that carries data
specific to the baseline, which is the one result that is not a judgement call.
If everything is boxed then nothing is.

Lime is the brand and never means a severity. The severity ramp runs red, ember,
straw, grey, green, and nothing on it is fully saturated.

Avoid generic security imagery, glow effects, and nested boxes.

## Hostile responses

A target chooses the shape of everything Gatecrash parses, so fingerprinting is
bounded in stack, heap, and time before it is bounded in anything else.

- Document walks carry an explicit stack. A recursive visitor is a crash any
  target can trigger by nesting its markup.
- JSON rebuilding stops at 128 levels and folds what is below into one marker.
- HTML is handed to the parser only when the body holds at most 20,000 `<`
  characters. Tree construction is quadratic in nesting depth, so this is a
  bound on time, not on correctness; a body past it is compared as text.
- Structure and token sets stop at 20,000 entries.

Both sides of a comparison are fingerprinted by the same code under the same
limits, so a bounded fingerprint still compares deterministically against
another bounded fingerprint. A limit may change a score. It may never change the
procedure that produces a verdict.

## Classification

Comparison is deterministic. JSON uses structure and token overlap after
configured volatile keys are replaced. HTML uses tag structure and visible
text. A result is called `review`, not `vulnerable`. The default similarity
threshold is `0.92`.

Refusing to judge severity is not the same as refusing to judge relevance. The
tool ranks and explains; it still never says `vulnerable`. Three rules do the
ranking, and each exists because the version without it flagged everything:

- **A baseline response has to be able to prove something.** A body carrying
  fewer than 16 bytes of non-empty scalar content is not discriminating: `[]`,
  `{}`, and `{"items":[],"total":0}` are byte-identical for every caller alive,
  so an identical copy reaching a second session is evidence of nothing. Such a
  match is reported at `low` confidence with the byte count that decided it,
  never suppressed.
- **A credential-free control session runs every route by default.** It is the
  reference the challengers are measured against, not one of the sessions being
  judged, so it produces no comparison of its own and gets no column in the
  access map. When it receives the same body as the baseline and that body is
  not discriminating, the route is `public` and there was no boundary to cross.
- **The same observation escalates when the body has something in it.** A
  control session receiving a discriminating baseline response is the strongest
  statement the tool can make, so it becomes a crossing on the finding at
  `high` confidence, and it can be the only crossing there is. Suppressing it
  as "public" would hide the missing-authentication bug the demo lab ships to
  demonstrate.

Confidence is `high` for an exact match on a discriminating response, `medium`
for a near match on one, and `low` when the baseline could not discriminate.
Only `high` gets the box.

Findings are keyed by route, not by route and session. One route open to four
sessions is one finding naming four crossings.

A capture is mostly the same endpoint with a different identifier in it, so
routes are grouped by their normalized pattern and `sample.per_pattern` members
of each family are sent, defaulting to 3 and disabled with `0`. Picks are
spread across the family rather than taken from the front. Held-back routes are
recorded as skipped with reason `sampled`, counted in the summary, and named in
`inspect`; sampling is never silent.

Exit codes are `0` for a completed run, `1` for an operational failure, `2` for
findings at or above `--fail-on`, and `130` for a run the operator interrupted.
`--fail-on-review` is kept as an alias for `--fail-on low`; on its own it
failed on every near match, and on a real application every authenticated
endpoint produces one.

`SIGINT` stops the run at a request boundary and writes a report covering what
came back. A route missing any response is left out entirely rather than
compared against a gap, and `run.interrupted` says the report is partial.

## Regression gate

Run `npm run check` and `npm run demo`. A network or privacy fix gets a fixture
that fails without it. A change to what the tool is willing to call a finding
gets one too, and it asserts on the tier rather than only on the count: the
classifier that flagged everything also passed every test that only counted. A fix for a hostile response gets one that fails without
it too, and asserts on the bound rather than only on the absence of a crash.
Inspect output must remain free of session values, captured headers, request
bodies, query values, and local directory paths.

Every view is rendered at a range of widths and asserted not to overflow any of
them. A layout constant that happens to be right at a hundred columns is a bug
at sixty.
