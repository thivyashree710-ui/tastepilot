# Test report

Run on 2026-10-29 against the final state of this repository.

| Check | Command | Result |
|---|---|---|
| Unit / mocked tests | `npm test` | **72 passed, 0 failed** (7 files) |
| Live Qloo integration tests | `npm run test:live` (real key) | **5 passed, 0 failed** |
| Type check (server, tests, client) | `npm run typecheck` | **clean** (exit 0) |
| Production build | `npm run build` | **succeeds** (Vite + tsc; `dist/` has server only, no tests) |
| Docker image | `docker build` + run with prod settings and a live key | **builds; runs as non-root; live translate returned 22 places, 0 failed calls; no key in logs or image filesystem** |
| Browser journey | `e2e/journey.mjs` against the production server, live Qloo | **6/6 assertions passed**, 0 console errors, 0 failed requests |

## What the mocked tests cover (72)
- **Qloo client**: header and documented params, `/v2/tags`, `signal.interests.tags`, normalization of live-shaped fields (price level, hours, subtype, tag explainability), unsafe `website` rejected, empty results, 401 (no retry), 403, 429 with retry and exhaustion, 5xx retry, timeout, malformed body, missing optional fields, unset `baseUrl` default.
- **Passport**: validation (destination, at least one taste input, limits, enums, companion cap, trimming); mapping to interest kinds; cross-city (destination → location filter, source kept as context).
- **Translation agent**: favorites used directly and seeds skipped (with trace reason); seeds labeled app-selected with type following the tag family; favorite picks artist over person; genre picker ignores non-genre tags; unmatched favorite reported; fallback (alternative tag; signal-free retry; exactly one retry; original category preserved; flagged low confidence); evidence tiers; no fabricated affinity/score; atmosphere nudges but never excludes; near-duplicate collapse and category interleaving; provenance of sources; plan size, "Proposed, unverified" and no-route-optimization notes; budget skipping; tool-call limit; rate-limit errors in the trace; GroupTaste coverage ranking.
- **Map data**: every edge endpoint is a displayed node; list covers every node and edge; explain edges are a subset of the agent's real edges with identical scores; per-place link cap; provenance labels; empty graph.
- **Security/API**: redaction; key never in client logs, error text, or API responses; production forces fixtures off; no-key refusal; dev results labeled and comparison disabled in dev; headers; validation errors and bad JSON; rate limiting; diff names.

## What the live tests cover (5; real API, real key)
Search resolves *Radiohead* to an artist; tags resolve `urn:tag:genre:music:indie` and `urn:tag:category:place:cafe`; Insights returns Bengaluru places with numeric Qloo affinity and explainability naming the signal; the full Chennai → Bengaluru passport runs with no failed calls, 4 plan stops, every result sourced from Qloo, every explainability edge pointing at a real signal; `/api/translate` and `/api/compare-signals` work through the HTTP API without leaking the key.

## Measured observations (live Qloo, single runs, 2026-10-29; not benchmarks)
- Sample passport (3 favorites, 2 genres, 4 place categories): 14–16 successful Qloo calls, 3.4–5.3 s end to end, 0 errors; "Heritage buildings" needed the signal-free fallback (1 place in Bengaluru).
- `/api/compare-signals` on the sample: **5 of the top 8** places appear both with and without the user's signals (so signals changed 3 of 8), and **7 of 8** personalized results carry a Qloo explainability link to a user signal. This shows how much signals change Qloo's list, not that the result is better.

## Not covered / honest gaps
- **No LLM comparison was run** (no LLM key); the LLM parser and `POST /api/compare` are untested against a real provider.
- **No jsdom/component tests**: UI behaviour is verified by the browser journey (a tool-driven script, not part of `npm test`) and by map-data tests on the pure `graph.ts` module. Accessibility checks were limited to keyboard operation of the map, semantic roles/labels, and no horizontal scroll at 390 px; no automated contrast audit or screen-reader testing.
- The browser journey ran on one viewport pair (1280 and 390 px) in one headless browser.
- Live tests depend on Qloo's data and quota and can change over time.
- Dev fixtures (`DevQloo`) are exercised only in API tests.
- No load testing; the rate limiter is in-memory and per IP.
- Public deployment has **not** been tested (not deployed).
