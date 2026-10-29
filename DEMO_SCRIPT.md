# Demo script

Pre-flight (1 min): server running with a real `QLOO_API_KEY` and `NODE_ENV=production`; open the app; the header should say "Qloo API key configured on server" and there must be **no** DEV banner.

## 30-second pitch
"You move from Chennai to Bengaluru. Maps tell you what's popular. TastePilot tells you what's *you*. It takes the artists and films you love, resolves them through Qloo, and finds places in your new city that connect to your taste — and shows the evidence for every one, including where it had to fall back."

## 2-minute demo
1. **(0:00) Hero.** Read the headline. "Your taste knows no borders." Point to *Try the sample scenario* and the note that it's made-up input.
2. **(0:10) Passport.** Click the sample. While it loads: "Specific favorites — Prateek Kuhad, Radiohead, Blade Runner 2049 — are matched in Qloo and used directly as my signals."
3. **(0:25) Translation.** Results appear (about 4 s). Open the first card: "Qloo's own description and rating; *evidence: signal-linked* means Qloo's explainability named one of my favorites." Point to the three badges: Qloo data / evidence / (app-derived).
4. **(0:50) Honesty.** Show the amber notice: "Heritage buildings: Qloo had no places with my taste signals in Bengaluru, so it fell back to the same category without signals — flagged *low confidence*, not passed off as a match."
5. **(1:05) Agent activity.** "Every call that really happened, with timings. Genres weren't seeded because I named favorites." (Skipped step with the reason.)
6. **(1:20) Map.** Press Tab to a node, Enter: "Radiohead → Qloo entity → places. Solid lines are Qloo explainability; dashed are category filters; the list below has the same data."
7. **(1:40) What-if.** Back on Translation, click × on *Japanese food*, **Update results**: "what changed" names the places removed.
8. **(1:50) Plan.** "Optional plan — labeled *Proposed, unverified*; ordered by relevance, no route optimization claimed."
9. **(2:00) Close.** "Qloo provides the taste signals and the evidence; the app never presents its own scores as Qloo's."

## Talking points on live evidence
- Activity tab: `qloo.search`, `qloo.tags`, `qloo.insights` rows with real ms.
- Compare tab → *Run signal comparison*: with-vs-without signals measured on the spot (about 8 s). Report the numbers shown; do not generalize them.

## If the API is slow or down
Do not fake it. Say so; the Activity tab shows the real error (e.g. `rate_limit` or `timeout`) and the app stays usable. Use the screenshots in `docs/screenshots/` (captured from a real live run on 2026-10-29) to walk through the same story and label them as screenshots. Do not switch to dev mode on stage: its fixtures are not Qloo data.
