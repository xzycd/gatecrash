# Report schema

Guestlist writes JSON with `schemaVersion: 1`.

The top-level fields are:

- `run`: run ID, start time, duration, input label, and target origin.
- `config`: profile names and levels, baseline, allowed methods, and threshold.
- `summary`: captured, replayed, skipped, and classified counts.
- `routes`: sanitized route identities, response metadata, and comparisons.
- `findings`: review results with stable IDs and evidence.
- `skipped`: requests that were duplicated, excluded, unsafe, or out of scope.

Finding IDs are deterministic for a method, sanitized path, baseline, and
challenger. Repeating the same comparison produces the same ID even when the
run ID and timing change.

Reports intentionally omit raw exchanges. Use the original browser or proxy
capture when manual verification needs headers or bodies.
