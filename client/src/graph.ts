import type { AgentResult, Entity, Source } from "../../server/types.js";

export type NodeKind = "interest" | "signal" | "place";
export interface GNode { id: string; label: string; col: 0 | 1 | 2; kind: NodeKind; role: string; source: Source; info: string }
export interface GEdge { from: string; to: string; kind: "explain" | "category" | "resolve"; source: Source; score?: number }
export interface Graph { nodes: GNode[]; edges: GEdge[] }

const kindLabel = { favorite: "favorite you named", genre: "genre", place: "place category" } as const;
const short = (id: string) => id.split(":").slice(-2).join(":");

/**
 * Build the Taste Translation Map from an agent result. Every edge comes from either
 * Qloo explainability ("explain"), a Qloo tag/entity lookup ("resolve"), or a category filter the place was returned under ("category").
 * Nothing is invented: edges whose endpoints are not displayed are dropped.
 */
export function buildGraph(r: AgentResult, maxPlaces = 10, linksPerPlace = 2): Graph {
  const nodes = new Map<string, GNode>();
  const add = (n: GNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const sig = (e: Entity, info: string, role: string) => add({ id: e.id, label: e.name, col: 1, kind: "signal", role, source: e.source, info });

  for (const x of r.resolved) {
    const i = x.interest, iid = `interest:${i.person}:${i.label}`;
    const k = i.kind ?? (i.type === "urn:entity:place" ? "place" : i.tagQuery ? "genre" : "favorite");
    add({ id: iid, label: i.label, col: 0, kind: "interest", role: `your ${kindLabel[k]}`, source: "user", info: `Your input (${kindLabel[k]})${r.brief.people.length > 1 ? ` for ${i.person}` : ""}. ${x.entity ? "" : "Qloo returned no matching entity or tag, so it did not influence results."}` });
    if (!x.entity) continue;
    if (k === "favorite") sig(x.entity, `Qloo entity matched to your favorite “${i.label}” (${x.entity.types[0]?.replace("urn:entity:", "") ?? "entity"}). Used directly as a taste signal.`, "matched favorite");
    else if (k === "genre" && x.seeds?.length) for (const s of x.seeds) sig(s, `Representative Qloo entity for the genre “${i.label}”. Selected by this app, not by you.`, "app-selected seed");
    else if (k === "genre") sig(x.entity, `Qloo genre tag for “${i.label}” (${short(x.entity.id)}). Not used as a signal: ${r.resolved.some((y) => y.interest.person === i.person && (y.interest.kind ?? "favorite") === "favorite") ? "you named a favorite of this type" : "no representative entities were found"}.`, "genre tag");
    else sig(x.entity, `Qloo category tag for “${i.label}” (${short(x.entity.id)}), used as a filter on ${r.brief.location ?? "the destination"}.${x.fallback ? ` No places for this tag; fell back to ${x.fallback.used}.` : ""}`, "category tag");
  }

  const places = r.candidates.filter((c) => !c.excluded).slice(0, maxPlaces);
  for (const c of places) add({ id: c.entity.id, label: c.entity.name, col: 2, kind: "place", role: c.via[0] ?? "place", source: c.entity.source, info: `${c.why.join(" · ")} · evidence: ${c.evidence}${c.lowConfidence ? " · low confidence" : ""}` });

  const edges: GEdge[] = [];
  const have = (id: string) => nodes.has(id);
  for (const e of r.edges) if ((e.kind === "resolve" || e.kind === "category") && have(e.from) && have(e.to)) edges.push({ from: e.from, to: e.to, kind: e.kind, source: e.source });
  const byPlace = new Map<string, typeof r.edges>();
  for (const e of r.edges) if (e.kind === "explain" && have(e.from) && have(e.to)) (byPlace.get(e.to) ?? byPlace.set(e.to, []).get(e.to)!).push(e);
  for (const list of byPlace.values()) for (const e of [...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, linksPerPlace)) edges.push({ from: e.from, to: e.to, kind: "explain", source: e.source, score: e.score });
  // drop signal nodes nothing connects to, except those explaining why they are unused
  return { nodes: [...nodes.values()], edges };
}

/** The accessible list view: derived from the same graph, so list and map cannot disagree. */
export function graphRows(g: Graph) {
  const label = new Map(g.nodes.map((n) => [n.id, n.label]));
  return g.nodes.map((n) => ({
    node: n,
    links: g.edges.filter((e) => e.to === n.id || e.from === n.id).map((e) => ({ kind: e.kind, other: label.get(e.from === n.id ? e.to : e.from) ?? "", direction: e.from === n.id ? "to" : "from", score: e.score })),
  }));
}
