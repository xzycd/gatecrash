# Changelog

## Unreleased

### Judgement

Measured on a 180-route capture against a target with eight deliberate holes in
it: 188 results to review became 32, the eight real ones lead at high
confidence, and the run went from 540 requests to 128.

- Add a credential-free `control` session, sent for every route by default.
  When it receives the same body as the baseline and that body carries nothing
  session-specific, the route is `public` and there was no boundary to cross —
  which is what a health check, a feature-flag endpoint, and a shared config
  route are. `compare.control: false` turns it off. `control` is now a reserved
  profile name.
- Escalate rather than suppress when that same session receives a response with
  real data in it. It becomes a crossing on the finding at high confidence, and
  it can be the only crossing: a route where every configured session sees its
  own record and an unauthenticated request sees the baseline's used to produce
  no finding at all.
- Rank findings `high`, `medium`, and `low`, and reserve the box for `high`. A
  match on a response carrying under 16 bytes of non-empty scalar content is
  now `low`, with the byte count that decided it. `[]`,
  `{"items":[],"total":0}`, and `{"status":"ok"}` are byte-identical for every
  caller alive, and every one of them used to reach the operator as the loudest
  thing the tool can say.
- Group routes by their normalized pattern and send `sample.per_pattern`
  members of each family, defaulting to 3, spread across the family rather than
  taken from the front. A capture of a paginated list is two hundred rows of
  one endpoint, each costing a request per session. Set `sample.per_pattern: 0`
  to send all of them; what is held back is counted in the summary and named in
  `inspect`.
- Key findings by route instead of by route and session. One route open to four
  sessions was four blocks with the same path at the top of each.
- Add `--fail-on <high|medium|low>`. `--fail-on-review` exited 2 on every near
  match, and on a real application every authenticated endpoint produces one,
  so the gate could never pass. It is kept as an alias for `--fail-on low`.
- Stop cleanly on `SIGINT` and write a report covering the routes that were
  reached, marked `interrupted`, exiting 130. A run interrupted at minute
  fourteen of fifteen used to leave nothing behind.
- Say what a run costs before it starts. `inspect` now prints the request count
  and the time it takes at the configured rate, and the live line shows time
  remaining.

### Terminal

- Rebuild every view on a string renderer with explicit column arithmetic.
  Terminal and plain output are now one code path with the escapes left out,
  rather than two layouts that drift apart.
- Drop `react` and `ink`. Runtime dependencies go from five to three, and
  `node_modules` from 155 packages to 111.
- Add a five-row block wordmark with a left-to-right reveal, at the largest of
  four sizes that fits, and a plain line below forty columns.
- Add a severity rail, similarity gauges, evidence branches, and a single box
  reserved for a byte-identical match on a response carrying data specific to
  the baseline.
- Fold map rows by endpoint. Twenty rows of `/api/files/{int}` are one row
  marked `×20`, carrying the worst result any member produced.
- Count comparisons and routes on separate lines. One line read `180 routes ·
  188 review · 172 blocked`, mixing routes, comparisons, and skipped capture
  entries with nothing to say which was which.
- Count routes in the opening sentence and say routes. It counted exact
  findings and called them sessions, so a five-route run against two sessions
  opened by claiming five sessions had got through.
- Degrade colour (24-bit, 256, none), box drawing (Unicode, ASCII), and
  hyperlinks independently, so a terminal missing one still gets the others.
- Move progress to a single self-erasing line on stderr, drawn on a timer rather
  than from inside the work loop, so a run blocked on a slow route no longer
  looks like a run that died. `--format json` and `--format markdown` never see
  it.
- Give every outcome a mark distinct from every other mark in both glyph sets.
  `blocked` is now `✓`, because a door that held is good news.
- Hold every view inside the width it was given, at every width.

### Security

- Bound response fingerprinting in stack, heap, and time. Deeply nested JSON or
  HTML from a target used to overflow the stack and end the run; a body of
  nested tags used to cost ten seconds of CPU per response, once per profile,
  for every route.
- Stop recording a query part with no `=` as a query name. A bare token in a
  query string was being written verbatim into saved reports.
- Label `inspect` input with a basename. The full local path was printed and
  serialized into `--format json` output.
- Remove bidi marks, line and paragraph separators, zero-width characters, and
  unpaired surrogates from anything printed to a terminal, and cap its length.
  Only the bidi overrides were being removed before.
- Escape link and image syntax in saved Markdown. A crafted capture path could
  reach a reviewer as a working link.
- Treat `?` as a literal in `exclude.paths`. It was a regex quantifier, so an
  exclusion silently matched a different set of paths than it read as.
- Read files through a bounded read on the open descriptor rather than a `stat`
  on the path followed by an unbounded read of it.
- Cap a captured request body at 8 MB.
- Fix `gatecrash update` on Windows, where Node refuses to spawn a `.cmd` file
  without a shell. The command line now accepts only the locally generated,
  verified archive path and is asserted on in tests.
- Do not let a failed cleanup replace the real error when writing a report.
- Bound the labels and statuses read out of a saved report. A report is a file,
  and a file is something somebody can hand you; most of what `explain` prints
  is wrapped, but the method was not, so a four-thousand-character one was a row
  that ran off the screen.
- Put `SIGINT` back the way it was found once a run finishes. Node suppresses
  the default terminate-on-interrupt while a listener is registered, so the
  handler left behind meant Ctrl-C did nothing at all while a long report was
  printing.

### Brand

- Replace the README banner with the mark on its own, generated from the same
  glyph table the terminal draws from rather than redrawn by hand.

### Docs

- Add `docs/go-rewrite.md`: measurements behind the decision to stay on
  TypeScript and run the single-binary experiment first.

### Compatibility

- Report schema is now 3. Findings are keyed by route and carry `crossings`
  instead of a single `challenger` and `challengerStatus`, `confidence` gains
  `low`, and `summary` separates capture entries, routes, and comparisons.
  `gatecrash explain` still reads schema 1 and 2 reports; a single-challenger
  finding is read as one crossing.
- `compare.control` and `sample.per_pattern` are new configuration keys with
  defaults of `true` and `3`. Both change what a run sends, so a run repeated
  from an existing config sends one extra request per route and fewer members
  of each path family.
- `control` is a reserved profile name. A configuration defining one is now an
  error rather than a silently replaced reference.

## 0.6.0

- Add `gatecrash update` to install the latest stable release, or a specifically
  requested version, from GitHub.
- Verify GitHub release locations, archive size, and the published SHA-256
  checksum before invoking npm. Reject implicit downgrades.
- Add `gatecrash update --check` for a read-only update check.
- Install only the verified release archive, with package lifecycle scripts
  disabled and temporary files removed after the attempt.
- Add reproducible CLI dependency locking, release tag verification, and an
  OIDC-only staged npm publishing workflow with provenance and 2FA approval.
- Replace the decorative banner with a minimal snapshot of the real terminal
  access map.
- Exercise the real `gatecrash check` CLI end to end against a live loopback
  target with file-based capture and configuration inputs.

## 0.5.0

- Rename the project and command from Guestlist to Gatecrash.
- Replace the terminal surface with a branded access map, compact live stage
  rail, outcome glyphs, narrow-terminal tracks, and a useful empty invocation.
- Add `gatecrash inspect` to preview scope and replay count without resolving
  secrets or sending requests.
- Accept only representation headers from captures instead of trying to list
  every possible credential header.
- Reject embedded URL credentials, transport headers, raw cookie headers,
  control characters, and unsafe profile names.
- Cap capture, config, loaded report, profile-map, and replay-plan sizes. Reject
  unknown configuration settings instead of ignoring likely misspellings.
- Replace reports atomically with private file permissions and remove response
  content types from persisted metadata.
- Sanitize network errors before storage and terminal text before display.
- Use report-local route ordinals so public route and finding IDs contain no
  hash derived from a URL or request body.
- Pin GitHub Actions to reviewed commits and let Dependabot track action
  updates.
- Move default config and state paths to `gatecrash.yml` and `.gatecrash`.
- Change finding IDs from `GST-` to `GTC-` and increment the report schema to 2.
  The explain command still reads schema 1 reports.

## 0.1.1

- Parse HTML with `parse5` instead of filtering tags with regular expressions.
- Keep script, style, SVG, and template content out of visible-text comparison.

## 0.1.0

- Read browser HAR files, URL lists, and common crawler JSONL fields.
- Replay requests across configured profiles with exact-origin scope.
- Compare JSON, HTML, text, and binary responses deterministically.
- Render an inline responsive access map and plain CI output.
- Save private JSON or Markdown reports and explain findings by ID.
- Include a local lab with two deliberate authorization mistakes.
