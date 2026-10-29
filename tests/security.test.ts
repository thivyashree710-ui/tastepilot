import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp, depsFromEnv } from "../server/app.js";
import { QlooClient } from "../server/qloo.js";
import { redact } from "../server/redact.js";

const KEY = "hack_" + "0123456789abcdef".repeat(3); // obviously fake, built at runtime
const body = { passport: { to: "Bengaluru", favorites: ["Radiohead"], places: ["Cafés"] } };

describe("secrets", () => {
  it("redact() removes env secrets and key-shaped strings", () => {
    expect(redact(`oops ${KEY} sk-abcdefghijklmnopqrstuvwx`)).not.toMatch(/hack_|sk-abc/);
    expect(redact("token=SECRETVALUE1", { QLOO_API_KEY: "SECRETVALUE1" } as any)).toBe("token=[redacted]");
  });
  it("Qloo client logs only status/path and never the key; network errors do not echo the key", async () => {
    const logs: string[] = [];
    const c = new QlooClient({ apiKey: KEY, retries: 0, log: (l) => logs.push(l), sleep: async () => {}, fetchImpl: (async () => { throw new Error(`connect failed with header ${KEY}`); }) as any });
    const err = await c.search("x").catch((e) => e);
    expect(String(err.message)).not.toContain(KEY);
    const ok = new QlooClient({ apiKey: KEY, log: (l) => logs.push(l), fetchImpl: (async () => new Response(JSON.stringify({ results: [] }))) as any });
    await ok.search("private query text");
    expect(logs.join("\n")).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain("private query text");
  });
  it("API responses for a failing upstream never contain the key", async () => {
    const qloo = new QlooClient({ apiKey: KEY, retries: 0, sleep: async () => {}, fetchImpl: (async () => { throw new Error(KEY); }) as any });
    const res = await request(createApp({ qloo, allowDev: false })).post("/api/translate").send(body);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(res.status).toBe(200); // run degrades gracefully; failures are in the trace
    expect(res.body.trace.some((t: any) => t.status === "error")).toBe(true);
  });
});

describe("production mode", () => {
  it("fixtures cannot be enabled when NODE_ENV=production", () => {
    expect(depsFromEnv({ NODE_ENV: "production", ALLOW_DEV_MODE: "1" } as any).allowDev).toBe(false);
    expect(depsFromEnv({ ALLOW_DEV_MODE: "1" } as any).allowDev).toBe(true);
  });
  it("without a key and without dev mode, translate refuses instead of showing fixtures", async () => {
    const res = await request(createApp({ allowDev: false })).post("/api/translate").send(body);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/DEV FIXTURE/);
  });
  it("dev mode results are labeled dev-fixture; comparison is disabled in dev", async () => {
    const app = createApp({ allowDev: true });
    const r = (await request(app).post("/api/translate").send(body)).body;
    expect(r.mode).toBe("dev");
    expect(r.candidates.every((c: any) => c.entity.source === "dev-fixture")).toBe(true);
    expect((await request(app).post("/api/compare-signals").send(body)).status).toBe(503);
  });
});

describe("API hardening", () => {
  const app = createApp({ allowDev: true });
  it("health, security headers, no x-powered-by", async () => {
    const r = await request(app).get("/api/health");
    expect(r.body).toEqual({ ok: true });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
  it("validates the passport (400 with a useful message) and bad JSON", async () => {
    const r = await request(app).post("/api/translate").send({ passport: { to: "Pune" } });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/at least one/i);
    expect((await request(app).post("/api/translate").set("content-type", "application/json").send("{bad")).status).toBe(400);
    expect((await request(app).post("/api/translate").send({ passport: { ...body.passport, stops: 99 } })).status).toBe(400);
  });
  it("rate limits repeated POSTs", async () => {
    const a = createApp({ allowDev: true }); let last = 0;
    for (let i = 0; i < 22; i++) last = (await request(a).post("/api/parse").send({ text: "I like jazz in Pune" })).status;
    expect(last).toBe(429);
  });
  it("shows the (documented) previous-result diff", async () => {
    const r = await request(app).post("/api/translate").send({ ...body, previous: [{ id: "gone", name: "Old Place" }] });
    expect(r.body.diff.removed).toEqual(["Old Place"]);
  });
});
