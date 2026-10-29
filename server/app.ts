import express from "express";
import { z } from "zod";
import { QlooClient } from "./qloo.js";
import { DevQloo } from "./dev.js";
import { runAgent, diffResults, type QlooLike } from "./agent.js";
import { parseRequest, MAX_PROMPT } from "./parse.js";
import { llmFromEnv, llmJson, type LlmConfig } from "./llm.js";
import { PassportSchema, passportToBrief } from "./passport.js";
import { redact } from "./redact.js";
import type { AgentResult } from "./types.js";

export interface Deps { qloo?: QlooLike; llm?: LlmConfig; allowDev: boolean }

export function depsFromEnv(env = process.env): Deps {
  return {
    qloo: env.QLOO_API_KEY ? new QlooClient({ apiKey: env.QLOO_API_KEY, baseUrl: env.QLOO_BASE_URL, log: (l) => console.log(redact(l)) }) : undefined,
    // fixtures can never be enabled in production, even by mistake
    llm: llmFromEnv(env), allowDev: env.ALLOW_DEV_MODE === "1" && env.NODE_ENV !== "production",
  };
}

const Interest = z.object({ label: z.string().max(60), tagQuery: z.string().max(40).optional(), type: z.string().startsWith("urn:entity:"), person: z.string().max(30) });
const BriefSchema = z.object({
  location: z.string().max(60).optional(), when: z.string().max(40).optional(), budget: z.string().max(60).optional(),
  constraints: z.array(z.string().max(40)).max(10),
  people: z.array(z.object({ name: z.string().max(30), interests: z.array(Interest).max(8), dislikes: z.array(z.string().max(40)).max(10) })).min(1).max(3),
  parsedBy: z.enum(["llm", "rules"]),
});

export function createApp(d: Deps) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https://images.qloo.com data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: "20kb" }));
  // small in-memory limiter to protect the shared Qloo quota (per IP, per minute)
  const hits = new Map<string, { n: number; t: number }>();
  app.use("/api", (req, res, next) => {
    if (req.method !== "POST") return next();
    const now = Date.now(), h = hits.get(req.ip ?? "?");
    if (!h || now - h.t > 60000) { hits.set(req.ip ?? "?", { n: 1, t: now }); return next(); }
    if (++h.n > 20) return res.status(429).json({ error: "Too many requests. Please wait a minute." });
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  const pick = (): { q: QlooLike; mode: "live" | "dev" } | undefined =>
    d.qloo ? { q: d.qloo, mode: "live" } : d.allowDev ? { q: new DevQloo(), mode: "dev" } : undefined;

  app.get("/api/status", (_req, res) => res.json({ qloo: d.qloo ? "configured" : "missing", llm: d.llm ? "configured" : "missing", devMode: !d.qloo && d.allowDev }));

  app.post("/api/parse", async (req, res) => {
    const p = z.object({ text: z.string().min(3).max(MAX_PROMPT) }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: `Provide a request of 3-${MAX_PROMPT} characters.` });
    res.json(await parseRequest(p.data.text, d.llm));
  });

  const run = (b: Parameters<typeof runAgent>[0]) => { const s = pick(); return s ? runAgent(b, s.q, s.mode) : undefined; };

  app.post("/api/translate", async (req, res) => {
    const p = z.object({ passport: PassportSchema, previous: z.array(z.object({ id: z.string().max(80), name: z.string().max(200) })).max(100).optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues.map((i) => i.message).join("; ").slice(0, 300) });
    const job = run(passportToBrief(p.data.passport));
    if (!job) return res.status(503).json({ error: "Qloo is not configured on the server (QLOO_API_KEY missing) and dev mode is off." });
    try { const r = await job; res.json({ ...r, diff: p.data.previous ? diffResults(p.data.previous, r) : undefined }); }
    catch { res.status(500).json({ error: "The agent failed unexpectedly." }); }
  });

  // Deterministic comparison, no LLM: the same Qloo categories with vs without the user's taste signals.
  app.post("/api/compare-signals", async (req, res) => {
    const p = z.object({ passport: PassportSchema }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: "Invalid passport." });
    const s = pick();
    if (!s) return res.status(503).json({ error: "Qloo is not configured." });
    if (s.mode === "dev") return res.status(503).json({ error: "Comparison is disabled in dev mode: fixtures are not Qloo data." });
    try {
      const brief = passportToBrief(p.data.passport);
      const baseBrief = { ...brief, people: brief.people.map((x) => ({ ...x, interests: x.interests.filter((i) => i.kind === "place") })) };
      if (!baseBrief.people.some((x) => x.interests.length)) return res.status(400).json({ error: "Add at least one place category to compare against a signal-free baseline." });
      const [withSig, without] = await Promise.all([runAgent(brief, s.q, "live"), runAgent(baseBrief, s.q, "live")]);
      const N = 8, top = (r: AgentResult) => r.candidates.filter((c) => !c.excluded).slice(0, N);
      const a = top(withSig), b = top(without), bIds = new Set(b.map((c) => c.entity.id));
      res.json({
        kind: "Qloo with your taste signals vs Qloo with the same categories and no signals (not an LLM)",
        topN: N,
        personalized: a.map((c) => ({ name: c.entity.name, evidence: c.evidence })),
        baseline: b.map((c) => ({ name: c.entity.name })),
        overlap: a.filter((c) => bIds.has(c.entity.id)).length,
        signalLinked: a.filter((c) => c.evidence === "signal-linked").length,
        definitions: { overlap: "places present in both top-N lists", signalLinked: "personalized results whose Qloo explainability names one of your signals" },
        caveat: "One run. It shows how much your signals change Qloo's results, not whether the results are better.",
      });
    } catch { res.status(502).json({ error: "Comparison failed (provider error)." }); }
  });

  app.post("/api/plan", async (req, res) => {
    const p = z.object({ brief: BriefSchema, previous: z.array(z.object({ id: z.string().max(80), name: z.string().max(200) })).max(100).optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: "Invalid brief." });
    const s = pick();
    if (!s) return res.status(503).json({ error: "Qloo is not configured on the server (QLOO_API_KEY missing) and dev mode is off." });
    try {
      const r = await runAgent(p.data.brief as any, s.q, s.mode);
      res.json({ ...r, diff: p.data.previous ? diffResults(p.data.previous, r) : undefined });
    } catch { res.status(500).json({ error: "The agent failed unexpectedly." }); }
  });

  // LLM-only baseline vs Qloo agent, same request. Metrics are computed from actual outputs only.
  app.post("/api/compare", async (req, res) => {
    const p = z.object({ text: z.string().min(3).max(MAX_PROMPT) }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: "Invalid request." });
    if (!d.llm) return res.status(503).json({ error: "Comparison needs an LLM key (ANTHROPIC_API_KEY + LLM_MODEL)." });
    if (!d.qloo) return res.status(503).json({ error: "Comparison needs a live Qloo key; dev fixtures are not used for comparisons." });
    try {
      const t0 = Date.now();
      const base = await llmJson(d.llm, "Recommend exactly 6 specific venues/entities for this plan. Return {\"names\":[string]}.", p.data.text, z.object({ names: z.array(z.string()).min(1).max(10) }));
      const baseMs = Date.now() - t0;
      const resolved = await Promise.all(base.names.map((n) => d.qloo!.search(n, "urn:entity:place", 1).then((r) => r.length > 0, () => false)));
      const unique = new Set(base.names.map((n) => n.trim().toLowerCase()));
      const t1 = Date.now();
      const brief = await parseRequest(p.data.text, d.llm);
      const agent = await runAgent(brief, d.qloo, "live");
      const kept = agent.candidates.filter((c) => !c.excluded);
      res.json({
        baseline: { names: base.names, latencyMs: baseMs, entityResolutionRate: resolved.filter(Boolean).length / resolved.length, duplicateRate: 1 - unique.size / base.names.length },
        agent: { names: kept.slice(0, 6).map((c) => c.entity.name), latencyMs: Date.now() - t1, entityResolutionRate: kept.length ? 1 : 0, note: "Agent entities come from Qloo results by construction, so resolution is 1 when any are returned." },
        definitions: { entityResolutionRate: "share of names that a Qloo place search returned a match for (not proof the venue exists)", duplicateRate: "1 - unique names / names" },
      });
    } catch { res.status(502).json({ error: "Comparison failed (provider error)." }); }
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(redact(String(err?.message ?? err)).slice(0, 200));
    res.status(err?.status === 400 || err?.type === "entity.parse.failed" ? 400 : 500).json({ error: err?.type === "entity.parse.failed" ? "Invalid JSON." : "Unexpected server error." });
  });
  return app;
}
