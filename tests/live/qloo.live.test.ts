// LIVE integration tests: these make real requests to Qloo with QLOO_API_KEY and are skipped without it.
// They are the only tests that exercise the real API; everything under tests/*.test.ts uses mocks.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { QlooClient } from "../../server/qloo.js";
import { runAgent } from "../../server/agent.js";
import { PassportSchema, passportToBrief } from "../../server/passport.js";
import { createApp } from "../../server/app.js";

const key = process.env.QLOO_API_KEY;
const d = describe.skipIf(!key);
const client = () => new QlooClient({ apiKey: key!, baseUrl: process.env.QLOO_BASE_URL });
const sample = { from: "Chennai", to: "Bengaluru", favorites: ["Prateek Kuhad", "Radiohead", "Blade Runner 2049"], genres: ["indie music", "science fiction"], places: ["Cafés", "Japanese food", "Heritage buildings", "Art galleries"], atmosphere: ["quiet", "creative"], budget: "mid", stops: 4 };

d("live Qloo API", () => {
  it("search resolves a named favorite to an artist entity", async () => {
    const r = await client().search("Radiohead", undefined, 5);
    expect(r.some((e) => e.name === "Radiohead" && e.types[0] === "urn:entity:artist")).toBe(true);
    expect(r[0].id).toMatch(/^[0-9A-F-]{36}$/i);
  });
  it("tags resolves genre and place-category URNs", async () => {
    const t = await client().tags("indie music", 8);
    expect(t.some((x) => x.id === "urn:tag:genre:music:indie")).toBe(true);
    expect((await client().tags("cafe", 8)).some((x) => x.id === "urn:tag:category:place:cafe")).toBe(true);
  });
  it("insights returns Bengaluru places with Qloo affinity and explainability when given a signal", async () => {
    const [fav] = await client().search("Radiohead", "urn:entity:artist", 1);
    const r = await client().insights({ type: "urn:entity:place", entities: [fav.id], tags: ["urn:tag:category:place:cafe"], location: "Bengaluru", take: 5 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => e.source === "qloo" && typeof e.affinity === "number")).toBe(true);
    expect(r.some((e) => e.explain?.some((x) => x.id === fav.id))).toBe(true);
  });
  it("full Chennai → Bengaluru translation: results, no failed calls, plan, qloo provenance", async () => {
    const r = await runAgent(passportToBrief(PassportSchema.parse(sample)), client(), "live");
    expect(r.trace.filter((t) => t.status === "error")).toEqual([]);
    expect(r.candidates.filter((c) => !c.excluded).length).toBeGreaterThan(5);
    expect(r.plan.stops).toHaveLength(4);
    expect(r.plan.verified).toBe(false);
    expect(r.candidates.every((c) => c.entity.source === "qloo")).toBe(true);
    const signalIds = new Set(r.resolved.flatMap((x) => [x.entity?.id, ...(x.seeds ?? []).map((s) => s.id)]).filter(Boolean));
    expect(r.edges.filter((e) => e.kind === "explain").every((e) => signalIds.has(e.from))).toBe(true);
  });
  it("API: translate and the deterministic signal comparison work with the real key", async () => {
    const app = createApp({ qloo: client(), allowDev: false });
    const t = await request(app).post("/api/translate").send({ passport: sample });
    expect(t.status).toBe(200); expect(t.body.mode).toBe("live");
    const c = await request(app).post("/api/compare-signals").send({ passport: sample });
    expect(c.status).toBe(200);
    expect(c.body.personalized).toHaveLength(8);
    expect(c.body.overlap).toBeGreaterThanOrEqual(0); expect(c.body.overlap).toBeLessThanOrEqual(8);
    expect(JSON.stringify(c.body)).not.toContain(key!);
  });
});
