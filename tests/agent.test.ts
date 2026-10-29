import { describe, it, expect } from "vitest";
import { runAgent, MAX_QLOO_CALLS, diffResults, openAt, pickTag, type QlooLike } from "../server/agent.js";
import { parseRules, missingInfo } from "../server/parse.js";
import { QlooError } from "../server/qloo.js";
import type { Entity } from "../server/types.js";

const ent = (id: string, name: string, extra: Partial<Entity> = {}): Entity => ({ id, name, types: ["urn:entity:place"], tags: [], source: "qloo", ...extra });
const defTags: QlooLike["tags"] = async (q) => [{ name: q, id: `urn:tag:category:place:${q.replace(/\s+/g, "_")}` }, { name: q, id: `urn:tag:genre:music:${q.replace(/\s+/g, "_")}` }];
// non-place insights calls are genre seeding; place calls go to `insights`
const fake = (insights: (ids: string[], p: Parameters<QlooLike["insights"]>[0]) => Entity[], tags: QlooLike["tags"] = defTags): QlooLike => ({
  search: async (q) => [ent(`sig:${q}`, q, { types: ["urn:entity:artist"] })],
  tags,
  insights: async (p) => (p.type === "urn:entity:place" ? insights([...(p.entities ?? []), ...(p.signalTags ?? [])], p) : [ent(`seed:${p.tags?.[0]}`, "Seed", { types: [p.type] })]),
});
const SCENARIO = "We are three friends planning a Saturday evening in Chennai. One likes indie music and quiet cafes, another likes science-fiction films and Japanese food, and the third likes architecture and design. We have a shared budget and want a plan that everyone can enjoy.";

describe("parser", () => {
  it("parses the acceptance scenario into 3 people", () => {
    const b = parseRules(SCENARIO);
    expect(b.location).toBe("Chennai");
    expect(b.when?.toLowerCase()).toBe("saturday evening");
    expect(b.budget?.toLowerCase()).toContain("shared budget");
    expect(b.people.map((p) => p.interests.map((i) => i.label))).toEqual([
      ["indie music", "quiet cafes"], ["science-fiction films", "Japanese food"], ["architecture", "design"]]);
  });
  it("single person + dislikes", () => {
    const b = parseRules("I like jazz and Italian food in Mumbai, avoid crowded places.");
    expect(b.people).toHaveLength(1);
    expect(b.people[0].dislikes).toContain("crowded places");
    expect(b.location).toBe("Mumbai");
  });
  it("asks for missing info", () => {
    expect(missingInfo(parseRules("something fun"))).toEqual(expect.arrayContaining(["Which city or area should the plan be in?"]));
  });
});

describe("agent", () => {
  it("multi-person: ranks shared candidate first with transparent score, plan is unverified", async () => {
    const q = fake((ids) => ids.some((i) => i.includes("indie")) ? [ent("S", "Shared", { affinity: 0.8 }), ent("X", "OnlyA", { affinity: 0.9 })] : [ent("S", "Shared", { affinity: 0.6 })]);
    const r = await runAgent(parseRules("One likes indie music. Another likes jazz. in Chennai"), q, "live");
    expect(r.candidates[0].entity.id).toBe("S");
    expect(r.candidates[0].coverage).toBe(1);
    expect(r.candidates[0].groupScore).toBeCloseTo(0.7);
    expect(r.candidates.find((c) => c.entity.id === "X")?.coverage).toBe(0.5);
    expect(r.plan.verified).toBe(false);
    expect(r.trace.some((t) => t.tool === "qloo.tags")).toBe(true);
  });
  it("never invents affinity when Qloo omits it", async () => {
    const r = await runAgent(parseRules("I like jazz in Chennai"), fake(() => [ent("A", "NoAff")]), "live");
    expect(r.candidates[0].groupScore).toBeUndefined();
    expect(r.candidates[0].perPerson["You"]).toBeUndefined();
  });
  it("dislike excludes matching candidates", async () => {
    const r = await runAgent(parseRules("I like jazz in Chennai, avoid sushi"), fake(() => [ent("A", "Sushi Bar"), ent("B", "Cafe")]), "live");
    expect(r.candidates.find((c) => c.entity.id === "A")?.excluded).toBeTruthy();
    expect(r.plan.stops.map((s) => s.entityId)).toEqual(["B"]);
  });
  it("flags conflicts between people", async () => {
    const r = await runAgent(parseRules("One likes jazz and avoid japanese food. Another likes Japanese food in Chennai"), fake(() => [ent("A", "A")]), "live");
    expect(r.overlaps.conflicts.length).toBeGreaterThan(0);
  });
  it("no results -> honest warning, no fabricated stops", async () => {
    const r = await runAgent(parseRules("I like jazz in Chennai"), fake(() => []), "live");
    expect(r.plan.stops).toEqual([]);
    expect(r.warnings.join()).toMatch(/No suitable/);
  });
  it("unresolvable interest is reported and not used", async () => {
    const r = await runAgent(parseRules("I like jazz in Chennai"), fake(() => [ent("A", "A")], async () => []), "live");
    expect(r.warnings.join()).toMatch(/Could not use: jazz/);
    expect(r.candidates).toEqual([]);
    expect(r.trace.filter((t) => t.tool === "qloo.insights")).toEqual([]);
  });
  it("API failure is recorded in trace, not hidden", async () => {
    const q: QlooLike = { search: async () => [], tags: async () => { throw new QlooError("bad key", "auth", 401); }, insights: async () => [] };
    const r = await runAgent(parseRules("I like jazz in Chennai"), q, "live");
    expect(r.trace.find((t) => t.status === "error")?.detail).toContain("auth");
    expect(r.warnings.join()).toMatch(/rejected the API key/);
  });
  it("iteration limit bounds tool calls", async () => {
    let calls = 0;
    const q: QlooLike = { search: async (s) => (calls++, [ent(`s${s}`, s)]), tags: async (t) => (calls++, defTags(t)), insights: async () => (calls++, []) };
    const many = "One likes jazz, indie music, hip hop, classical music, anime, Italian food, thai food. Another likes cafes, architecture, design, bookshops, thrillers. Third likes korean food.";
    const r0 = await runAgent(parseRules(many), q, "live", 8);
    expect(calls).toBeLessThanOrEqual(8);
    expect(MAX_QLOO_CALLS).toBeLessThanOrEqual(30);
    expect(r0.trace.some((t) => t.status === "skipped")).toBe(true);
    expect(r0.warnings.join()).toMatch(/limit/);
  });
  it("changed preference produces a diff", async () => {
    const q = fake((ids) => (ids.some((i) => i.includes("jazz")) ? [ent("A", "Jazz Club")] : [ent("B", "Cafe")]));
    const r1 = await runAgent(parseRules("I like jazz in Chennai"), q, "live");
    const r2 = await runAgent(parseRules("I like anime in Chennai"), q, "live");
    expect(diffResults(r1.candidates.map((c) => ({ id: c.entity.id, name: c.entity.name })), r2)).toMatchObject({ added: ["Cafe"], removed: ["Jazz Club"] });
  });
});

describe("evaluation helpers", () => {
  const hrs = { saturday: [{ opens: "T12:00:00", closes: "T23:00:00", closed: false }], sunday: [{ opens: "T18:00:00", closes: "T01:00:00", closed: false }] };
  it("openAt checks Qloo weekly hours, incl. past midnight", () => {
    expect(openAt(hrs, "Saturday evening")).toBe(true);
    expect(openAt(hrs, "Saturday morning")).toBe(false);
    expect(openAt(hrs, "Sunday night")).toBe(true);
    expect(openAt(undefined, "Saturday evening")).toBeUndefined();
    expect(openAt(hrs, "tonight")).toBeUndefined(); // no day/part => cannot tell
  });
  it("pickTag prefers place-category tags", () => {
    expect(pickTag([{ name: "x", id: "urn:tag:keyword:qloo:cafe" }, { name: "x", id: "urn:tag:category:place:cafe" }])?.id).toBe("urn:tag:category:place:cafe");
    expect(pickTag([])).toBeUndefined();
  });
  it("excludes places closed at the requested time and flags budget by Qloo price level", async () => {
    const q = fake(() => [ent("A", "Shut", { hours: { saturday: [{ closed: true }] } }), ent("B", "Pricey", { priceLevel: 4 }), ent("C", "Cheap", { priceLevel: 1 })]);
    const r = await runAgent(parseRules("I like cafes on Saturday evening in Chennai, low budget"), q, "live");
    expect(r.candidates.find((c) => c.entity.id === "A")?.excluded).toMatch(/Not scheduled open/);
    expect(r.candidates.find((c) => c.entity.id === "B")?.constraints.find((k) => k.label === "Budget")?.status).toBe("fail");
    expect(r.candidates.find((c) => c.entity.id === "C")?.constraints.find((k) => k.label === "Budget")?.status).toBe("pass");
  });
  it("plan gives each interest its own stop", async () => {
    const q = fake((_ids, p) => (p.tags?.[0]?.includes("japanese") ? [ent("J", "Sushi")] : [ent("C", "Cafe")]));
    const r = await runAgent(parseRules("One likes cafes. Another likes Japanese food. in Chennai"), q, "live");
    expect(r.plan.stops.map((s) => s.entityId).sort()).toEqual(["C", "J"]);
  });
});
