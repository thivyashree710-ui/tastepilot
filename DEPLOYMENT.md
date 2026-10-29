# Deployment (Render, Docker)

Status: **not deployed from this repo yet.** The Docker image was built and run locally with production settings and a live key (see `TEST_REPORT.md`).

## Steps
1. Push the repo to GitHub as public `tastepilot` (see `SUBMISSION_CHECKLIST.md`).
2. Render → New → **Blueprint** → select the repo. `render.yaml` defines a Docker web service with health check `/api/health`.
3. In the Render dashboard set the secret **`QLOO_API_KEY`** (never in the repo). Leave `ALLOW_DEV_MODE=0`, `NODE_ENV=production`. `ANTHROPIC_API_KEY`/`LLM_MODEL` are optional.
4. Deploy, then run the smoke tests below against the public URL.

Free-tier note: Render free services sleep when idle; the first request can take ~30–60 s. Open the URL shortly before judging or use an uptime pinger on `/api/health`. The hackathon requires the demo to remain available and free through the end of judging (Nov 5, 2026, 11:45 pm ET).

## Environment
| Variable | Required | Notes |
|---|---|---|
| `QLOO_API_KEY` | yes | server-side only; hackathon keys work only on `https://hackathon.api.qloo.com` and are deactivated after the hackathon |
| `QLOO_BASE_URL` | no | defaults to the hackathon host |
| `NODE_ENV` | set `production` | production forces dev fixtures off even if `ALLOW_DEV_MODE=1` |
| `ALLOW_DEV_MODE` | no | `0` for public deployments |
| `PORT` | no | Render injects it; default 8787 |
| `ANTHROPIC_API_KEY`, `LLM_MODEL` | no | only for `/api/compare` and the text planner parser |

## Smoke tests
```bash
URL=https://<your-service>.onrender.com
curl -s $URL/api/health                      # {"ok":true}
curl -s $URL/api/status                      # {"qloo":"configured","llm":"missing","devMode":false}
curl -s -X POST $URL/api/translate -H 'content-type: application/json' \
  -d '{"passport":{"from":"Chennai","to":"Bengaluru","favorites":["Radiohead"],"places":["Cafés"],"stops":2}}' \
  | python3 -c "import sys,json;j=json.load(sys.stdin);print(j['mode'],len(j['candidates']),j['plan']['stops'][0]['title'])"   # live N <place>
```
Then open the URL in a **clean/private browser window**, click *Try the sample scenario*, and confirm: no DEV banner, cards with Qloo images, Map tab works, Activity shows no failed calls.

## Security checklist
Key only as a Render secret; CSP/nosniff/frame-deny headers set; per-IP POST limiter (20/min); request body ≤ 20 KB; inputs validated (Zod); logs contain only Qloo status and path, never keys or query text; container runs as non-root `node`.

## Troubleshooting
- `503 Qloo is not configured…`: `QLOO_API_KEY` missing.
- Trace shows `auth: …401`: key invalid/expired; `rate_limit`: slow down or ask in the hackathon Discord `#api-help`; `timeout`: retry.
- Blank page behind a path prefix: the app expects to be served from `/`.
- Rotate the key if it was ever pasted in a public place (it was shared in a chat during development): request a new one and update the Render secret.
