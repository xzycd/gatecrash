# Changelog

## Unreleased

### Terminal

- Rebuild every view on a string renderer with explicit column arithmetic.
  Terminal and plain output are now one code path with the escapes left out,
  rather than two layouts that drift apart.
- Drop `react` and `ink`. Runtime dependencies go from five to three, and
  `node_modules` from 155 packages to 111.
- Add a five-row block wordmark with a left-to-right reveal, at the largest of
  four sizes that fits, and a plain line below forty columns.
- Add a severity rail, similarity gauges, evidence branches, and a single box
  reserved for the byte-identical match.
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

### Docs

- Add `docs/go-rewrite.md`: measurements behind the decision to stay on
  TypeScript and run the single-binary experiment first.

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
