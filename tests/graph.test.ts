import { describe, it, expect } from "vitest";
import { runAgent } from "../server/agent.js";
import { PassportSchema, passportToBrief } from "../server/passport.js";
import { buildGraph, graphRows } from "../client/src/graph.js";
import { ent, mkQloo } from "./helpers.js";

const brief = passportToBrief(PassportSchema.parse({ from: "Chennai", to: "Bengaluru", favorites: ["Radiohead", "Nobody Known"], genres: ["science fiction"], places: ["Cafés", "Bars"] }));
const places = (p: any) => [1, 2, 3].map((i) => ent(`${p.tags[0]}-${i}`, `${p.tags[0].split(":").pop()} ${i}`, { affinity: 0.6, explain: [{ id: "fav:Radiohead", score: 0.2 + i / 10 }, { id: "ghost", score: 0.9 }] }));
const mk = () => runAgent(brief, mkQloo({ places, search: async (q) => (q === "Nobody Known" ? [] : [ent(`fav:${q}`, q, { types: ["urn:entity:artist"] })]) }), "live");

describe("Taste Translation Map data", () => {
  it("every edge endpoint is a displayed node, and the list view covers every node", async () => {
    const r = await mk(); const g = buildGraph(r);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
    const rows = graphRows(g);
    expect(rows.map((x) => x.node.id).sort()).toEqual([...ids].sort());
    const listed = rows.reduce((a, x) => a + x.links.length, 0);
    expect(listed).toBe(g.edges.length * 2); // each edge appears from both endpoints in the list
  });
  it("never invents edges: explain edges exist in the agent result with the same score; unknown signals are dropped", async () => {
    const r = await mk(); const g = buildGraph(r);
    const explain = g.edges.filter((e) => e.kind === "explain");
    expect(explain.length).toBeGreaterThan(0);
    for (const e of explain) expect(r.edges.some((x) => x.kind === "explain" && x.from === e.from && x.to === e.to && x.score === e.score)).toBe(true);
    expect(explain.some((e) => e.from === "ghost")).toBe(false); // "ghost" is not a displayed signal
  });
  it("keeps only the strongest explainability links per place", async () => {
    const r = await mk(); const g = buildGraph(r, 10, 1);
    const per = new Map<string, number>();
    for (const e of g.edges.filter((x) => x.kind === "explain")) per.set(e.to, (per.get(e.to) ?? 0) + 1);
    expect(Math.max(...per.values())).toBe(1);
  });
  it("labels provenance: user input, matched favorite, genre tag, category tag, and unmatched inputs", async () => {
    const g = buildGraph(await mk());
    const by = (l: string) => g.nodes.filter((n) => n.label === l);
    expect(by("Radiohead").map((n) => n.role).sort()).toEqual(["matched favorite", "your favorite you named"]);
    expect(by("Radiohead").find((n) => n.col === 0)?.source).toBe("user");
    expect(by("Nobody Known")).toHaveLength(1); // unmatched: input shown, no Qloo node
    expect(by("Nobody Known")[0].info).toMatch(/no matching entity/i);
    expect(g.nodes.filter((n) => n.role === "category tag").length).toBe(2);
    expect(g.nodes.filter((n) => n.role === "genre tag" || n.role === "app-selected seed").length).toBeGreaterThan(0);
  });
  it("shows an empty graph for a run with no inputs resolved", async () => {
    const r = await runAgent(brief, mkQloo({ search: async () => [], tags: async () => [] }), "live");
    const g = buildGraph(r);
    expect(g.nodes.every((n) => n.col === 0)).toBe(true);
    expect(g.edges).toEqual([]);
  });
});
