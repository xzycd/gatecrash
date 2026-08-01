# Report schema

Gatecrash v0.5 writes JSON with `schemaVersion: 2`.

The top-level fields are:

- `run`: run ID, start time, duration, input label, and target origin.
- `config`: profile names and levels, baseline, allowed methods, and threshold.
- `summary`: captured, replayed, skipped, and classified counts.
- `routes`: sanitized route identities, response metadata, and comparisons.
- `findings`: review results with stable IDs and evidence.
- `skipped`: requests that were duplicated, excluded, unsafe, or out of scope.

Route IDs are report-local ordinals, so they contain no hash of a URL or request
body. Finding IDs start with `GTC-` and are derived from that ordinal plus the
baseline and challenger names. Repeating the same ordered capture produces the
same IDs even when the run ID and timing change.

Schema 2 removes response content types from saved output because they are
response headers. `gatecrash explain` can still read schema 1 reports and their
older `GST-` finding IDs.

Reports omit raw exchanges. Use the original browser or proxy capture when
manual verification needs headers or bodies.
