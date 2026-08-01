# Product

<!-- impeccable:product-schema 1 -->

## Platform

CLI

## Users

Gatecrash is for application security testers, developers, and learners working
in an authorized lab or on a web application they have permission to test. The
primary job is to compare how the same captured request behaves under different
sessions without rebuilding each request by hand.

## Product Purpose

Gatecrash turns a HAR, URL list, or crawler JSONL into a small access map. It
replays eligible requests with named profiles, compares response fingerprints,
and gives the tester a short list of results worth checking against the intended
access policy.

Success means a new user can understand the workflow from the terminal, run the
built-in lab without setup, configure a real test without leaking credentials,
and move from a result to its evidence in one command.

## Positioning

Gatecrash sits between route discovery and manual authorization review. Its
distinct mechanism is a deterministic, privacy-conscious comparison of the same
request across explicit sessions. It reports evidence, not a vulnerability
verdict.

## Operating Context

The product is a Node.js command-line tool used beside a browser, intercepting
proxy, or crawler. Typical inputs are browser HAR exports, newline-delimited
URLs, and JSONL from tools such as Katana. It runs locally, saves sanitized
reports, supports CI output, and includes a loopback-only demonstration lab.

## Capabilities and Constraints

- One run uses one exact target origin and one baseline profile.
- Captured credentials are discarded. Profile credentials come from environment
  variables and stay in memory.
- Safe methods run by default. Other methods require explicit command-line
  approval.
- Redirects are observed but never followed.
- Reports omit headers, bodies, tokens, cookies, and query values.
- Comparison is deterministic and never infers the application's business
  policy.
- Login flows, session refresh, crawling, and exploit generation are outside the
  current product boundary.

## Brand Commitments

The product name is Gatecrash. The line is "Same request. Wrong session." The
name uses the venue-door meaning of gatecrashing: the tool checks whether a
session that should be outside can still get through. The voice is terse,
candid, technically literate, and careful about security claims. The v0.5 brief
asks for a memorable identity and a much clearer terminal experience while
keeping the workflow simple.

## Evidence on Hand

The repository contains a working local lab with two deliberate authorization
mistakes, capture and classification fixtures, an access-map renderer, and
published release automation. There are no customer claims, benchmarks, or
testimonials to present.

## Product Principles

1. Show the access boundary before showing implementation detail.
2. Make safe behavior the default and risky behavior explicit.
3. Keep evidence reproducible, sanitized, and easy to inspect.
4. Teach through real output and direct next actions.
5. Stay narrow enough that a tester can audit what the tool does.

## Accessibility & Inclusion

Meaning cannot depend on color alone. The interface must remain useful with
`NO_COLOR`, narrow terminal panes, redirected output, SSH sessions, and copied
scrollback. Animation must be brief and limited to active progress.
