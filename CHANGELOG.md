# Changelog

## 0.6.0

- Add `gatecrash update` to install the latest stable release, or a specifically
  requested version, from GitHub.
- Verify GitHub release locations, archive size, and the published SHA-256
  checksum before invoking npm. Reject implicit downgrades.
- Add `gatecrash update --check` for a read-only update check.
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
