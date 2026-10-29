import { describe, it, expect } from "vitest";
import { QlooClient, QlooError } from "../server/qloo.js";

// Representative (hand-written) fixtures: the per-entity schema is only loosely documented, so these are assumptions.
const insightsBody = { success: true, results: { entities: [
  { entity_id: "P1", name: "Cafe One", types: ["urn:entity:place"], properties: { image: { url: "https://x/y.jpg" }, geocode: { city: "Chennai" }, business_rating: 4.4 },
    tags: [{ name: "quiet" }], query: { affinity: 0.82, explainability: { signals: [{ entity_id: "A1", score: 0.6 }] } } },
  { entity_id: "P2", name: "Bare Place" },
  { name: "no id" },
], duration: 12 } };
const json = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: h });
const mk = (impl: (u: URL, i: RequestInit) => Promise<Response>, retries = 2, timeoutMs = 50) =>
  new QlooClient({ apiKey: "k", fetchImpl: ((u: URL, i: RequestInit) => impl(u, i)) as any, sleep: async () => {}, retries, timeoutMs });

describe("QlooClient", () => {
  it("sends key header and documented insights params; normalizes entities", async () => {
    let seen: URL | undefined; let hdr: any;
    const c = mk(async (u, i) => { seen = u; hdr = i.headers; return json(insightsBody); });
    const r = await c.insights({ type: "urn:entity:place", entities: ["A1", "A2"], location: "Chennai" });
    expect(hdr["X-Api-Key"]).toBe("k");
    expect(seen!.pathname).toBe("/v2/insights");
    expect(seen!.searchParams.get("filter.type")).toBe("urn:entity:place");
    expect(seen!.searchParams.get("signal.interests.entities")).toBe("A1,A2");
    expect(seen!.searchParams.get("filter.location.query")).toBe("Chennai");
    expect(r).toHaveLength(2); // entity without id dropped
    expect(r[0]).toMatchObject({ id: "P1", affinity: 0.82, city: "Chennai", image: "https://x/y.jpg", tags: ["quiet"], explain: [{ id: "A1", score: 0.6 }] });
    expect(r[1].affinity).toBeUndefined(); // optional fields missing, nothing invented
  });
  it("tags() hits /v2/tags and insights sends signal.interests.tags", async () => {
    let seen: URL | undefined;
    const c = mk(async (u) => { seen = u; return json({ results: { tags: [{ name: "Indie", id: "urn:tag:genre:music:indie" }, { name: "bad", id: "x" }] } }); });
    expect(await c.tags("indie")).toEqual([{ name: "Indie", id: "urn:tag:genre:music:indie" }]);
    expect(seen!.pathname).toBe("/v2/tags"); expect(seen!.searchParams.get("filter.query")).toBe("indie");
    const c2 = mk(async (u) => { seen = u; return json(insightsBody); });
    await c2.insights({ type: "urn:entity:place", signalTags: ["urn:tag:genre:music:indie"], tags: ["urn:tag:category:place:cafe"] });
    expect(seen!.searchParams.get("signal.interests.tags")).toBe("urn:tag:genre:music:indie");
    expect(seen!.searchParams.get("filter.tags")).toBe("urn:tag:category:place:cafe");
    expect(seen!.searchParams.has("signal.interests.entities")).toBe(false);
  });
  it("normalizes live-shaped place fields (price, hours, subtype, tag explainability)", () => {
    const [e] = QlooClient.normalize([{ entity_id: "P", name: "Cafe", subtype: "urn:entity:place", disambiguation: "1 Main St", properties: { price_level: 3, is_closed: false, short_description: "Nice", website: "https://ok.example", hours: { friday: [{ opens: "T09:00:00", closes: "T21:00:00", closed: false }] } }, query: { affinity: 0.5, explainability: { "signal.interests.entities": [{ entity_id: "E", score: 0.5 }] } } }]);
    expect(e).toMatchObject({ types: ["urn:entity:place"], priceLevel: 3, isClosed: false, description: "Nice", address: "1 Main St", website: "https://ok.example", explain: [{ id: "E", score: 0.5 }] });
    expect(e.hours?.friday).toHaveLength(1);
    expect(QlooClient.normalize([{ entity_id: "Q", name: "x", properties: { website: "javascript:alert(1)" } }])[0].website).toBeUndefined();
  });
  it("an unset/empty baseUrl falls back to the hackathon host instead of breaking", async () => {
    for (const baseUrl of [undefined, ""]) {
      let seen: URL | undefined;
      const c = new QlooClient({ apiKey: "k", baseUrl, fetchImpl: (async (u: URL) => { seen = u; return json({ results: [] }); }) as any });
      await c.search("x");
      expect(seen!.origin).toBe("https://hackathon.api.qloo.com");
    }
  });
  it("search returns entities and handles empty results", async () => {
    expect(await mk(async () => json({ results: [{ entity_id: "A1", name: "Band" }] })).search("indie")).toHaveLength(1);
    expect(await mk(async () => json({ results: { entities: [] } })).search("zzz")).toEqual([]);
  });
  it("invalid credentials -> auth error, no retry", async () => {
    let n = 0;
    await expect(mk(async () => (n++, json({}, 401))).insights({ type: "urn:entity:place" })).rejects.toMatchObject({ kind: "auth" });
    expect(n).toBe(1);
  });
  it("403 -> unsupported", async () => {
    await expect(mk(async () => json({}, 403)).insights({ type: "urn:entity:place" })).rejects.toMatchObject({ kind: "unsupported" });
  });
  it("rate limit retries then succeeds; exhausted -> rate_limit", async () => {
    let n = 0;
    const ok = await mk(async () => (++n < 3 ? json({}, 429, { "retry-after": "1" }) : json(insightsBody))).insights({ type: "urn:entity:place" });
    expect(ok).toHaveLength(2); expect(n).toBe(3);
    await expect(mk(async () => json({}, 429)).insights({ type: "urn:entity:place" })).rejects.toMatchObject({ kind: "rate_limit" });
  });
  it("5xx retried", async () => {
    let n = 0;
    await mk(async () => (++n < 2 ? json({}, 503) : json(insightsBody))).insights({ type: "urn:entity:place" });
    expect(n).toBe(2);
  });
  it("timeout -> timeout error", async () => {
    const c = mk((_u, i) => new Promise((_r, rej) => i.signal!.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))), 1);
    await expect(c.insights({ type: "urn:entity:place" })).rejects.toMatchObject({ kind: "timeout" });
  });
  it("malformed body -> malformed", async () => {
    await expect(mk(async () => json({ nope: 1 })).insights({ type: "urn:entity:place" })).rejects.toBeInstanceOf(QlooError);
    await expect(mk(async () => new Response("<html>", { status: 200 })).search("x")).rejects.toMatchObject({ kind: "malformed" });
  });
});
