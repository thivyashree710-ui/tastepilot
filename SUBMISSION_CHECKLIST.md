# Submission checklist

Legend: ✅ done and verified · ⏳ pending (needs your account or action) · ❓ unverified

## Official rules (source: the Official Rules text pasted by the team from qloo.devpost.com/rules; my tool got HTTP 403 from Devpost, so I could not re-fetch the live page)
- **Deadline**: Oct 30, 2026, **11:45 pm Eastern** (EDT, UTC−4) = **Oct 31, 2026, 09:15 AM IST**. Judging Nov 2–5; winners ~Nov 5.
- **Eligibility**: individuals of age of majority, teams, or organizations; not residents of sanctioned jurisdictions (Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea, …); not Qloo/Devpost staff or related. India is not excluded in the text. Each entrant must confirm their own eligibility.
- **Required**: a working app integrating the Qloo API that is an agentic tool; **link to a functional demo**; **public repo (GitHub/GitLab/Bitbucket) with an open-source license visible in the About section**; **text description**. Demo must be free and unrestricted for judging through Nov 5.
- **Judging (4 equal criteria)**: Technological Implementation (how thoroughly/skillfully Qloo is used), Design (complete product), Potential Impact, Quality of the Idea (non-obvious use of Qloo). Stage 1 is pass/fail on theme fit and applying Qloo.
- **Pre-existing code**: allowed only if significantly updated with Qloo during the period; this project was built in the period. No sponsor funding.
- ❓ The rules text contains **no AI-assistance disclosure requirement**; the live Devpost form may ask. The submission text discloses Claude Code assistance anyway.
- ❓ The live **submission form fields** (e.g. whether a demo video is required) are unverified; open the form and check.

## Publishing audit (2026-10-29, executed, not assumed)
- **GitHub** (superseded: the repo was later created and pushed by the team; see Status below). Earlier audit: no `gh`/`glab` installed; no `GH_*`/`GITHUB_*` token in the environment; `ssh -T git@github.com` → *Permission denied (publickey)* (this machine's key is not registered with GitHub); no git remote configured. A public repo could not be created or pushed. I did not read stored credential files.
- **Render / hosting**: no Render, Fly, Railway, Vercel or Netlify CLI or token present. Nothing deployed.
- **Devpost**: `qloo.devpost.com` returns a Cloudflare "verifying you are not a bot" challenge to both fetch and the headless browser, so the live rules page and submission form were not read; the rules above are the text you pasted. I did not try to bypass the challenge. Nothing was submitted, and no terms were accepted or attestations made.
- **Key rotation**: not verified (no key-management interface). The key shared in chat must be treated as compromised; it is only in the git-ignored `.env`, never in the repo, history, image or bundle.

## Product and code
- ✅ Working Qloo integration verified live (`/search`, `/v2/tags`, `/v2/insights`); 5 live tests pass
- ✅ Agentic workflow, bounded, with truthful activity trace
- ✅ Taste Passport, Translation, Map (+ list), Plan, GroupTaste, Compare (no-LLM comparison), what-if diff
- ✅ 72 mocked tests, typecheck, production build, Docker build and run, browser journey (7/7)
- ✅ MIT `LICENSE`; `.env.example` placeholders only; `.gitignore` excludes `.env`
- ✅ Docs: `README.md`, `SUBMISSION.md`, `DEMO_SCRIPT.md`, `DEPLOYMENT.md`, `TEST_REPORT.md`
- ✅ Genuine screenshots in `docs/screenshots/` (from the live run, redesigned UI)
- ✅ Local git repository initialised with an initial commit; secret scan clean (key only in ignored `.env`)

## Final audit (commit ff84e4b + docs alignment)
- ✅ **GitHub repo** https://github.com/thivyashree710-ui/tastepilot: public, MIT detected by GitHub's license API, default branch `main`, remote head matched the latest local commit when checked; no `.env` tracked; secret scan clean (key only in the git-ignored `.env`).
- ✅ **Docs aligned** with the "Cultural Atlas" redesign (`README.md`, `SUBMISSION.md`, `DEMO_SCRIPT.md`): hero route, numbered Passport, lead discovery + mosaic, atlas map, before/after what-if.
- ✅ **Final checks on this tree**: 72/72 mocked tests, typecheck clean, production build OK. Live Qloo tests and the browser journey (7/7) were last run on the same application code before the docs-only edits; they were not re-run in this audit.
- ❓ **Render**: no Render CLI or credentials in this environment, so deployment status is **unknown**. `render.yaml` exists in the repo, but I have not seen a service, a URL, or a successful deploy, and I am not claiming the demo is live or that it runs the new design.
- ⏳ Not re-verifiable here: the live Devpost page and form (Cloudflare bot challenge); rules text is from the copy the team pasted.

## Remaining steps, in order
1. **Rotate the Qloo key** (it was pasted in chat): request a new hackathon key, update it in Render's environment as the secret `QLOO_API_KEY`. Never commit it.
2. **Get a public demo URL.** In Render: New → Blueprint → select `thivyashree710-ui/tastepilot` (reads `render.yaml`; `ALLOW_DEV_MODE=0`, `NODE_ENV=production`). If a service already exists, open its **Events/Deploys** tab and confirm the latest deploy is `ff84e4b` or newer and *Live*, with auto-deploy on for `main`.
3. **Test the real URL in a clean/private window** (free tier may take 30–60 s to wake): `<URL>/api/health` → `{"ok":true}`; `<URL>/api/status` → `qloo: configured`, `devMode: false`; click *Try the sample scenario*; confirm no DEV banner, real Qloo images, Map tab works, Agent activity has no failed calls, and the page shows the new obsidian hero. Smoke-test commands are in `DEPLOYMENT.md`.
4. **Put the verified URL in the repo** (README Status line, this checklist, and the repo's GitHub "About → Website" field) and push.
5. **Devpost form** (rules require): functional demo link ✔ after step 3, **public repo URL** `https://github.com/thivyashree710-ui/tastepilot`, **text description** from `SUBMISSION.md`. Add screenshots from `docs/screenshots/`. Record a ~2-minute video from `DEMO_SCRIPT.md` **if the form asks for one** (unverified). Check any extra fields the live form shows (e.g. AI-assistance disclosure; the pasted rules do not require one, and `SUBMISSION.md` discloses Claude Code assistance anyway).
6. **Accept the Devpost terms/eligibility yourself** (not done on your behalf) and **submit before Oct 31, 2026 09:15 AM IST** (Oct 30, 11:45 pm ET). Confirm the submission confirmation page/email.
7. **Keep the demo up and the Qloo key valid** through Nov 5, 11:45 pm ET.

## Status
- Public repo URL: **https://github.com/thivyashree710-ui/tastepilot** (public, MIT)
- Public demo URL: **none verified**
- Devpost submission: **not submitted**
