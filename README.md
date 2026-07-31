<div align="center">

<img src="docs/banner.svg" alt="Guestlist, an authorization mapper for captured web traffic" width="920">

**Same request. Different session.**

Guestlist replays captured web requests as several users and points out responses
that deserve a closer look.

[![ci](https://github.com/xzycd/guestlist/actions/workflows/ci.yml/badge.svg)](https://github.com/xzycd/guestlist/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-22.12%2B-5FA04E)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-MIT-B9A7FF)](LICENSE)

</div>

---

Most recon tools are good at finding routes. The awkward part comes next: take
a request that worked as one user, replay it as somebody else, and decide
whether the response crossed an access boundary.

Guestlist does that one job. It reads a browser HAR, a URL list, or JSONL from a
crawler. Each request is sent with the sessions in `guestlist.yml`. The result
is an access map with the HTTP status and body similarity for every profile.

It does not call a response vulnerable. Business rules live outside the HTTP
exchange, so Guestlist reports evidence and leaves the verdict to the tester.

## Try the built-in lab

```bash
npm install -g github:xzycd/guestlist
guestlist demo
```

The lab runs on localhost, contains two deliberate access-control mistakes, and
shuts down when the check finishes. Its result is useful for checking terminal
rendering too.

```text
guestlist check  http://127.0.0.1:64762
3 routes · 3 profiles · 215 ms

2 results to review:

GST-E9CA3C  GET /api/account/alice
  alice 200 -> bob 200 · exact body match
  bob received the same successful response as alice.

GST-9066EE  GET /api/member/export
  alice 200 -> anonymous 200 · exact body match
  anonymous received the same successful response as alice.

2 blocked · 2 changed · 2 skipped
```

That output comes from the current demo, apart from the port and timing.

## Use it on a lab or authorized target

Write a starter config:

```bash
guestlist init
```

```yaml
target:
  origin: https://app.example.test
  requests_per_second: 2
  concurrency: 4

profiles:
  admin:
    level: 100
    headers:
      Authorization: "Bearer ${ADMIN_TOKEN}"

  member:
    level: 10
    headers:
      Authorization: "Bearer ${MEMBER_TOKEN}"

  anonymous:
    level: 0

compare:
  baseline: admin
  against: [member, anonymous]
  similarity_threshold: 0.92

exclude:
  paths: [/health, /assets/**]
```

Export a HAR from the browser network panel, then run:

```bash
ADMIN_TOKEN=... MEMBER_TOKEN=... guestlist check session.har
```

Plain URL files work too:

```text
https://app.example.test/api/me
GET https://app.example.test/api/admin/users
HEAD https://app.example.test/downloads/report
```

JSONL can use `url`, `endpoint`, `request.url`, or `request.endpoint`. This makes
the output of crawlers such as Katana usable without a conversion script.

## Reading the access map

A challenger gets one of these outcomes for each route:

| Outcome | Meaning |
|---|---|
| `review` | Both profiles succeeded and the normalized bodies met the similarity threshold. |
| `blocked` | The challenger received a redirect, `401`, `403`, or `404`. |
| `changed` | Both profiles succeeded but returned meaningfully different bodies. |
| `inconclusive` | The baseline failed, or the challenger returned another status. |
| `error` | The request timed out or failed before a response arrived. |

JSON comparison ignores configured volatile fields such as request IDs and CSRF
tokens. HTML comparison uses visible text and tag structure. Text uses token
overlap. The same deterministic code runs in the terminal and in CI.

Inspect any result later:

```bash
guestlist explain GST-E9CA3C
guestlist explain GST-E9CA3C --report .guestlist/runs/2026-08-01T120000Z.json
```

## Safe defaults

Guestlist is meant for systems you own or have permission to test.

- A target has one exact origin. Captured requests to another origin are skipped.
- Captured authorization, cookies, proxy credentials, and API keys are discarded.
- Profile secrets come from environment variables and stay out of saved reports.
- Only `GET`, `HEAD`, and `OPTIONS` run by default.
- Redirects are recorded but never followed.
- Responses are capped at 1 MB unless the config says otherwise.
- Reports contain paths, status codes, sizes, and comparison results. They do not contain headers or bodies.

Allow another method only when its effect is understood:

```bash
guestlist check session.har --allow-method POST
```

## Output for scripts and CI

```bash
guestlist check session.har --format json --no-save
guestlist check session.har --format markdown --out report.md
guestlist check session.har --plain --fail-on-review
```

Exit codes are stable:

- `0` means the check completed.
- `1` means Guestlist could not complete the check.
- `2` means the check completed with review results and `--fail-on-review` was set.

Terminal output is inline and responsive. It does not use the alternate screen,
so scrollback, SSH sessions, narrow panes, and copied output continue to work.
When stdout is not a terminal, the default renderer switches to plain text.

## Current limits

One run has one baseline profile. Guestlist does not refresh sessions, execute a
login flow, or infer an application's intended policy. Stateful extraction and
multi-capture comparisons belong in later releases. The current version stays
small enough to audit and predictable enough to put in a lab workflow.

## Develop

```bash
git clone https://github.com/xzycd/guestlist.git
cd guestlist
npm install
npm run check
npm run demo
```

The test suite covers config parsing, HAR sanitization, scope enforcement,
fingerprints, classification, terminal rendering, the CLI process, and a full
run against the local lab. See [CONTRIBUTING.md](CONTRIBUTING.md) before changing
the report schema or network behavior.

## License

MIT. See [LICENSE](LICENSE).
