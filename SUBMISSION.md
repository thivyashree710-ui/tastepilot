# TastePilot — Devpost submission text

## Tagline
Your taste travels with you.

## Elevator pitch (30 s)
When you move to a city you don't know, maps show you what's popular, not what's *you*. TastePilot takes the artists, films, genres and kinds of places you love, resolves them through Qloo's cultural-intelligence API, and finds places in your new city that connect to your taste — with the evidence for every match, and honest flags where the data is thin.

## Problem
Students, relocating professionals and travelers lose their cultural bearings in a new city. Popularity-ranked apps and LLMs answering from memory don't connect someone's taste across music, film, food and places, and they can't show where a suggestion came from.

## Target users and impact
People moving to, or spending time in, an unfamiliar city (the sample scenario is Chennai → Bengaluru). Impact is faster, more personal discovery of third places and cultural venues. We have not run user research and make no usage or outcome claims.

## What it does
- **Taste Passport**: source city (context), destination, named favorites, genres, place categories, atmosphere, budget, stop count, things to avoid, optional companions. A one-click sample scenario (clearly made-up input) demos the whole flow.
- **Taste Translation agent**: resolves favorites to Qloo entities, genres and place categories to Qloo tags, seeds a genre with representative entities only when you didn't name a favorite of that type, and asks Qloo Insights for destination places steered by those signals, with explainability.
- **Explainable cards**: Qloo's description, address, rating, price level, weekly schedule and website where Qloo supplies them; why it matched; constraint checks; evidence tier; low-confidence and fallback flags.
- **Taste Translation Map** (with an equivalent list), **what-if refinement** with a "what changed" diff, **proposed plan** (labeled unverified), **GroupTaste** (up to two companions), **Agent activity** timeline, **Compare** (Qloo with vs without your signals).

## How the agent works
A bounded workflow, not an open-ended loop: interpret → resolve (`/search`, `/v2/tags`) → retrieve (`/v2/insights` with `filter.tags`, `filter.location.query`, `signal.interests.entities`, `feature.explainability`) → evaluate constraints from retrieved fields → rank and de-duplicate → assemble a plan. Hard cap of 30 Qloo calls per run, at most one fallback per empty category, timeouts and bounded retries in the client. Every call is logged in the activity timeline with its measured time, including failures and fallbacks.

## Why Qloo is essential
The core signals are Qloo's: entity and tag resolution, location-filtered place retrieval, per-place affinity relative to your signals, and per-place explainability scores naming which of your signals drove the match. Without Qloo the app would have nothing but an LLM's recollection to rank by, and no evidence to show.

## What we learned from real data (and built around)
- Genre tags used as signals give every place the same affinity, so genres are seeded with entities; named favorites always take priority over seeds.
- `/search` on a genre word returns unrelated entities ("indie music" → a wedding company), so genres are resolved as tags.
- A category tag can be empty in a city while a sibling is not (`japanese_food` → 0, `japanese_restaurant` → 20 in Bengaluru), so there is one traced fallback, and fallback results are flagged *low confidence*.

## Distinctive features
Provenance everywhere (Qloo / your input / app-derived / LLM / dev fixture); evidence tiers; a map whose every edge is a real Qloo explainability link, a category filter, or a lookup, with a text equivalent; counterfactual re-runs with a diff; a deterministic with-vs-without-signals comparison that needs no LLM.

## Honest limitations
Weekly schedules are not live status; price levels are indicators; no travel times, bookings or reviews; plans are "Proposed, unverified". Result quality is Qloo's and varies by category and city. The signal comparison is one run. No LLM comparison was run and none is claimed. Atmosphere uses fixed keyword lists. Rate limiting is in-memory.

## Built with
TypeScript, React 19 + Vite, Express, Zod, Qloo API (`/search`, `/v2/tags`, `/v2/insights`), Docker/Render. Developed with AI-assisted coding (Claude Code); all code, tests and measurements in this repository were produced and run during the submission period.

## Measured (live Qloo, one run each, 2026-10-29)
See `TEST_REPORT.md`. Headline: sample scenario = 14–16 successful Qloo calls in about 3.5–5.3 s; with-vs-without-signals comparison: 5 of the top 8 places overlap, 7 of 8 personalized results have a Qloo explainability link to the user's signals.
