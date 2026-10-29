# Browser journey (manual / tool-driven, not part of `npm test`)

`journey.mjs` drives the real app in a headless browser against a running server with a live Qloo key.
It is written for the `browser-automation` helper (Playwright-style `page` API) used during development:

    npm run build && QLOO_API_KEY=... NODE_ENV=production npm start &
    SHOT=docs/screenshots node <helper>/browser.mjs http://localhost:8787/ --script e2e/journey.mjs

It checks: sample scenario renders cards, the map and its list view have the same number of items, keyboard selection of a
map node works, no failed tool calls in the timeline, the plan is labeled "Proposed, unverified", the counterfactual diff
shows place names, and the mobile layout (390px) has no horizontal scroll.
