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

## Product and code
- ✅ Working Qloo integration verified live (`/search`, `/v2/tags`, `/v2/insights`); 5 live tests pass
- ✅ Agentic workflow, bounded, with truthful activity trace
- ✅ Taste Passport, Translation, Map (+ list), Plan, GroupTaste, Compare (no-LLM comparison), what-if diff
- ✅ 72 mocked tests, typecheck, production build, Docker build and run, browser journey (6/6)
- ✅ MIT `LICENSE`; `.env.example` placeholders only; `.gitignore` excludes `.env`
- ✅ Docs: `README.md`, `SUBMISSION.md`, `DEMO_SCRIPT.md`, `DEPLOYMENT.md`, `TEST_REPORT.md`
- ✅ Genuine screenshots in `docs/screenshots/` (from the live run)
- ✅ Local git repository initialised with an initial commit; secret scan clean (key only in ignored `.env`)

## Needs you (I cannot do these: no GitHub/Render access in this environment)
1. ⏳ **Rotate the Qloo key** if there is any chance it is public (it was pasted in a chat). Then update `.env` and the Render secret.
2. ⏳ **Create the public GitHub repo `tastepilot` and push**: `gh` is not installed here. With a GitHub account: create an empty public repo named `tastepilot` (no README/license), then
   `git remote add origin https://github.com/<you>/tastepilot.git && git push -u origin main`. GitHub will detect the MIT license and show it in the About section; confirm it does.
3. ⏳ **Deploy on Render** from the repo (Blueprint → `render.yaml`), set `QLOO_API_KEY` as a secret, then run the smoke tests in `DEPLOYMENT.md` from a clean browser window.
4. ⏳ **Record a short demo video** if the Devpost form asks for one (follow `DEMO_SCRIPT.md`; do not invent anything not on screen).
5. ⏳ **Fill the Devpost submission** with `SUBMISSION.md`, the repo URL, the demo URL, screenshots; submit **before 09:15 AM IST Oct 31** (aim for earlier).
6. ⏳ Keep the demo up through **Nov 5, 11:45 pm ET**.

## Status
- Public repo URL: **none yet**
- Public demo URL: **none yet**
- Devpost submission: **not submitted**
