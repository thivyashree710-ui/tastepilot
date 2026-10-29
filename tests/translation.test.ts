import { describe, it, expect } from "vitest";
import { runAgent, pickFavorite, pickGenre, nameKey } from "../server/agent.js";
import { PassportSchema, passportToBrief } from "../server/passport.js";
import { QlooError } from "../server/qloo.js";
import { ent, mkQloo } from "./helpers.js";

const brief = (o: object) => passportToBrief(PassportSchema.parse({ from: "Chennai", to: "Bengaluru", ...o }));

describe("favorites vs. genre seeds", () => {
  it("uses a named favorite directly and skips generic seeds of the same type (trace says why)", async () => {
    const log: string[] = [];
    const r = await runAgent(brief({ favorites: ["Radiohead"], genres: ["indie music"], places: ["Cafés"] }), mkQloo({ log }), "live");
    expect(log.some((l) => l.startsWith("insights:artist"))).toBe(false); // no seed call
    expect(r.trace.find((t) => t.step.startsWith('Seed genre "indie music"'))).toMatchObject({ status: "skipped" });
    expect(r.resolved.find((x) => x.interest.label === "Radiohead")?.entity?.role).toBe("user-favorite");
    expect(log).toContain("insights:place:urn:tag:category:place:cafe:1"); // one signal = the favorite
  });
  it("seeds a genre when no favorite of that type exists, and labels seeds as app-selected", async () => {
    const r = await runAgent(brief({ genres: ["indie music"], places: ["Cafés"] }), mkQloo(), "live");
    const g = r.resolved.find((x) => x.interest.kind === "genre")!;
    expect(g.seeds?.[0]).toMatchObject({ role: "seed", name: "Seed One" });
    expect(g.entity?.role).toBe("tag");
  });
  it("seed entity type follows the tag family (music -> artist), never a guessed type", async () => {
    const log: string[] = [];
    await runAgent(brief({ genres: ["indie music"], places: ["Cafés"] }), mkQloo({ log }), "live");
    expect(log.find((l) => l.startsWith("insights:") && !l.startsWith("insights:place"))).toMatch(/^insights:artist:/);
  });
  it("pickFavorite prefers artist over person; pickGenre ignores non-genre tags", () => {
    expect(pickFavorite([ent("1", "A", { types: ["urn:entity:person"] }), ent("2", "A", { types: ["urn:entity:artist"] })])?.id).toBe("2");
    expect(pickGenre([{ name: "x", id: "urn:tag:keyword:qloo:indie_music" }, { name: "x", id: "urn:tag:category:place:music_school" }])).toBeUndefined();
    expect(pickGenre([{ name: "x", id: "urn:tag:keyword:qloo:x" }, { name: "i", id: "urn:tag:genre:music:indie" }])?.id).toBe("urn:tag:genre:music:indie");
  });
  it("unmatched favorite is reported and contributes no signal", async () => {
    const log: string[] = [];
    const r = await runAgent(brief({ favorites: ["Zzzz Nobody"], places: ["Cafés"] }), mkQloo({ log, search: async () => [] }), "live");
    expect(r.warnings.join()).toMatch(/Could not use: Zzzz Nobody/);
    expect(log).toContain("insights:place:urn:tag:category:place:cafe:0");
  });
});

describe("empty-category fallback", () => {
  const places = (empty: (tag?: string) => boolean) => (p: any) => (empty(p.tags?.[0]) ? [] : [ent(`p:${p.tags?.[0]}`, `Place ${p.tags?.[0]?.split(":").pop()}`, { affinity: p.entities?.length ? 0.6 : 0 })]);
  it("retries once with an alternative category tag and records it (trace, warning, candidate)", async () => {
    const tags = async (q: string) => [{ name: q, id: "urn:tag:category:place:japanese_food" }, { name: q, id: "urn:tag:category:place:japanese_restaurant" }];
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Japanese food"] }), mkQloo({ tags, places: places((t) => !!t?.endsWith("japanese_food")) }), "live");
    expect(r.trace.filter((t) => t.step.startsWith("Fallback")).length).toBe(1);
    expect(r.warnings.join()).toMatch(/Fallback/);
    const c = r.candidates[0];
    expect(c.fallback).toEqual({ requested: "japanese_food", used: "japanese_restaurant" });
    expect(c.lowConfidence).toBe(true);
    expect(c.via[0]).toBe("Japanese food"); // original requested category preserved
    expect(c.why.join()).toMatch(/Fallback: requested japanese_food/);
  });
  it("with no alternative tag, retries once without signals: no affinity, category-only evidence", async () => {
    const tags = async (q: string) => [{ name: q, id: "urn:tag:category:place:heritage_building" }];
    const log: string[] = [];
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Heritage buildings"] }), mkQloo({ log, tags, places: (p) => (p.entities?.length ? [] : [ent("H", "Old Palace", { affinity: 0 })]) }), "live");
    const c = r.candidates[0];
    expect(c.evidence).toBe("category-only");
    expect(c.perPerson["You"]).toBeUndefined(); // Qloo's 0 without signals is not reported as an affinity
    expect(c.groupScore).toBeUndefined();
    expect(c.lowConfidence).toBe(true);
    expect(log.filter((l) => l.startsWith("insights:place")).length).toBe(2); // original + exactly one fallback
  });
  it("does not retry more than once when the fallback is also empty", async () => {
    const log: string[] = [];
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés"] }), mkQloo({ log, places: () => [] }), "live");
    expect(log.filter((l) => l.startsWith("insights:place")).length).toBe(2);
    expect(r.warnings.join()).toMatch(/No places found|No suitable/);
    expect(r.plan.stops).toEqual([]);
  });
});

describe("ranking, diversity and honesty", () => {
  it("collapses near-duplicate branches and interleaves categories", async () => {
    const places = (p: any) => p.tags[0].endsWith("cafe")
      ? [ent("c1", "Dolci - Cunningham Road", { affinity: 0.9 }), ent("c2", "Dolci, Indiranagar", { affinity: 0.89 }), ent("c3", "Mud Koffee", { affinity: 0.88 })]
      : [ent("b1", "Book Nook", { affinity: 0.5 })];
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés", "Bookstores"] }), mkQloo({ places, tags: async (q) => [{ name: q, id: `urn:tag:category:place:${q.split(" ").pop()}` }] }), "live");
    const kept = r.candidates.filter((c) => !c.excluded).map((c) => c.entity.name);
    expect(kept).toEqual(["Dolci - Cunningham Road", "Book Nook", "Mud Koffee"]); // interleaved, duplicate collapsed
    expect(r.candidates.find((c) => c.entity.id === "c2")?.excluded).toMatch(/near-duplicate/);
    expect(nameKey("Dolci - Cunningham Road")).toBe(nameKey("Dolci, Indiranagar"));
  });
  it("evidence tiers: explainability link > affinity only > category only", async () => {
    const places = () => [ent("a", "Linked", { affinity: 0.6, explain: [{ id: "fav:Radiohead", score: 0.5 }] }), ent("b", "Ranked", { affinity: 0.7 })];
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés"] }), mkQloo({ places }), "live");
    expect(Object.fromEntries(r.candidates.map((c) => [c.entity.name, c.evidence]))).toEqual({ Linked: "signal-linked", Ranked: "signal-ranked" });
    expect(r.candidates[0].entity.name).toBe("Linked"); // tier beats a higher raw affinity
    expect(r.candidates[0].why.join()).toContain("Radiohead (your favorite)");
  });
  it("never fabricates affinity: with no signals nothing has a score", async () => {
    const r = await runAgent(brief({ places: ["Cafés"] }), mkQloo({ places: () => [ent("a", "A", { affinity: 0 })] }), "live");
    expect(r.candidates[0].perPerson["You"]).toBeUndefined();
    expect(r.candidates[0].groupScore).toBeUndefined();
    expect(r.candidates[0].groupAffinity).toBeUndefined();
  });
  it("atmosphere is an app-derived nudge, never an exclusion", async () => {
    const places = () => [ent("a", "Loud Place", { affinity: 0.7, description: "lively bar" }), ent("b", "Calm Place", { affinity: 0.7, description: "a tranquil courtyard" })];
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés"], atmosphere: ["quiet"] }), mkQloo({ places }), "live");
    expect(r.candidates.map((c) => c.entity.name)).toEqual(["Calm Place", "Loud Place"]);
    expect(r.candidates[0].atmosphere).toEqual(["quiet"]);
    expect(r.candidates.every((c) => !c.excluded)).toBe(true);
  });
  it("provenance: results carry the source of the client that produced them", async () => {
    const live = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés"] }), mkQloo(), "live");
    expect(live.candidates.every((c) => c.entity.source === "qloo" && c.entity.role === "result")).toBe(true);
    const dev = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés"] }), mkQloo({ places: () => [ent("d", "D", { source: "dev-fixture" })] }), "dev");
    expect(dev.mode).toBe("dev"); expect(dev.candidates.every((c) => c.entity.source === "dev-fixture")).toBe(true);
  });
});

describe("plan", () => {
  it("respects the stop count, is labeled unverified, and claims no route optimization", async () => {
    const places = (p: any) => [1, 2, 3].map((i) => ent(`${p.tags[0]}${i}`, `${p.tags[0].split(":").pop()} ${i}`, { affinity: 0.6 }));
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés", "Bars"], stops: 2 }), mkQloo({ places }), "live");
    expect(r.plan.stops).toHaveLength(2);
    expect(r.plan.verified).toBe(false);
    expect(r.plan.notes.join()).toMatch(/Proposed, unverified/);
    expect(r.plan.notes.join()).toMatch(/No route.*optimization was performed/);
  });
  it("skips places that fail a stated budget", async () => {
    const places = () => [ent("x", "Pricey", { priceLevel: 4, affinity: 0.9 }), ent("y", "Fine", { priceLevel: 2, affinity: 0.5 })];
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés"], budget: "low", stops: 2 }), mkQloo({ places }), "live");
    expect(r.plan.stops.map((s) => s.title)).toEqual(["Fine"]);
    expect(r.candidates.find((c) => c.entity.name === "Pricey")?.constraints.find((k) => k.label === "Budget")?.note).toMatch(/indicator, not a verified cost/);
  });
});

describe("limits and failures", () => {
  it("tool-call limit bounds a Taste Translation run and says so", async () => {
    const log: string[] = [];
    const r = await runAgent(brief({ favorites: ["a", "b", "c"], genres: ["g1", "g2"], places: ["Cafés", "Bars", "Parks"] }), mkQloo({ log }), "live", 6);
    expect(log.length).toBeLessThanOrEqual(6);
    expect(r.warnings.join()).toMatch(/limit/);
    expect(r.trace.some((t) => t.status === "skipped")).toBe(true);
  });
  it("rate-limit / timeout errors appear in the trace and never crash the run", async () => {
    const q = mkQloo({ places: () => { throw new QlooError("Qloo rate limit reached (429).", "rate_limit", 429); } });
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés"] }), q, "live");
    expect(r.trace.find((t) => t.status === "error")?.detail).toContain("rate_limit");
    expect(r.plan.stops).toEqual([]);
  });
  it("GroupTaste: a place returned for both people outranks single-person places", async () => {
    const places = (p: any) => (p.entities.includes("fav:Radiohead") ? [ent("only", "OnlyYou", { affinity: 0.95 }), ent("both", "Both", { affinity: 0.6 })] : [ent("both", "Both", { affinity: 0.6 })]);
    const r = await runAgent(brief({ favorites: ["Radiohead"], places: ["Cafés"], companions: [{ name: "Asha", favorites: ["Muse"], places: ["Cafés"] }] }), mkQloo({ places }), "live");
    expect(r.candidates[0].entity.name).toBe("Both");
    expect(r.candidates[0].coverage).toBe(1);
    expect(r.candidates.find((c) => c.entity.name === "OnlyYou")?.coverage).toBe(0.5);
  });
});
