# How comparison works

Gatecrash first establishes that the baseline received a successful response.
It then compares every configured challenger.

## Response normalization

JSON objects have stable key ordering. Configured volatile keys keep their
location and type but use the value `<volatile>`. Arrays preserve order because
an ordered API response can carry meaning.

HTML drops scripts, styles, SVG content, comments, and tags before comparing
visible text. Tag names remain as a small structural signal. Plain text is
collapsed to normalized whitespace. Binary bodies use a SHA-256 digest.

The body cap applies before normalization. A truncated response is marked in
the report and cannot count as an exact match. Two successful empty responses
can still become a medium-confidence review because the status itself may be
the authorization signal.

## Outcomes

`review` requires successful baseline and challenger responses. The challenger
must have an equal or lower configured level, and the body must be exact or meet
the threshold.

`blocked` covers redirects and the common denial statuses `401`, `403`, and
`404`. A successful response with a lower match becomes `changed`. Network
errors never become review results.

Profile levels are a sorting and comparison hint. Two equal profiles are useful
for horizontal checks such as Alice's object replayed as Bob. Levels do not
model roles that cannot be placed in one hierarchy.
