import { QlooError, type InsightsParams } from "./qloo.js";
import { missingInfo } from "./parse.js";
import type { AgentResult, Brief, Candidate, Edge, Entity, Evidence, Interest, InterestKind, PlanStop, QlooType, TraceStep } from "./types.js";

export interface QlooLike {
  search(q: string, type?: QlooType, limit?: number): Promise<Entity[]>;
  tags(q: string, take?: number): Promise<{ name: string; id: string }[]>;
  insights(p: InsightsParams): Promise<Entity[]>;
}

export const MAX_QLOO_CALLS = 30; // hard bound on tool calls per run
const MAX_INTERESTS = 14;
type Tag = { name: string; id: string };

export const kindOf = (i: Interest): InterestKind => i.kind ?? (i.type === "urn:entity:place" ? "place" : i.tagQuery ? "genre" : "favorite");
const errText = (e: unknown) => (e instanceof QlooError ? `${e.kind}: ${e.message}` : (e as Error)?.message ?? "unknown error");

/** Most specific place-category tag for a text query. */
export function pickTag(tags: Tag[]): Tag | undefined {
  for (const prefix of ["urn:tag:category:place:", "urn:tag:cuisine:", "urn:tag:genre:place", "urn:tag:"]) {
    const t = tags.find((x) => x.id.startsWith(prefix));
    if (t) return t;
  }
  return undefined;
}

/** Genre tags only (music/media). Never falls back to unrelated tag families. */
export function pickGenre(tags: Tag[]): Tag | undefined {
  for (const prefix of ["urn:tag:genre:music:", "urn:tag:genre:media:", "urn:tag:subgenre:"]) {
    const t = tags.find((x) => x.id.startsWith(prefix));
    if (t) return t;
  }
  return undefined;
}

const seedType = (tag: string, fallback: QlooType): QlooType => (tag.includes(":music:") ? "urn:entity:artist" : tag.includes(":media:") ? "urn:entity:movie" : fallback);

const TYPE_ORDER = ["artist", "movie", "tv_show", "brand", "place", "book", "podcast", "video_game", "destination", "person"];
/** /search without a type can put a person before the artist; prefer cultural-signal types. */
export function pickFavorite(results: Entity[]): Entity | undefined {
  const rank = (e: Entity) => { const i = TYPE_ORDER.indexOf((e.types[0] ?? "").replace("urn:entity:", "")); return i < 0 ? 99 : i; };
  return [...results].sort((a, b) => rank(a) - rank(b))[0];
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const PART: Record<string, number> = { morning: 10, afternoon: 15, evening: 19, night: 21.5 };
const toHour = (s?: string) => { const m = s?.match(/T(\d\d):(\d\d)/); return m ? Number(m[1]) + Number(m[2]) / 60 : undefined; };

/** Is the entity scheduled open at the requested day/part-of-day per Qloo's WEEKLY schedule? undefined = cannot tell. Not a live status. */
export function openAt(hours: Entity["hours"], when?: string): boolean | undefined {
  if (!hours || !when) return undefined;
  const day = DAYS.find((d) => when.toLowerCase().includes(d));
  const part = Object.keys(PART).find((p) => when.toLowerCase().includes(p));
  if (!day || !part) return undefined;
  const slots = hours[day];
  if (!Array.isArray(slots)) return undefined;
  const h = PART[part];
  return slots.some((s) => {
    if (s.closed) return false;
    const o = toHour(s.opens), c = toHour(s.closes);
    if (o === undefined || c === undefined) return false;
    return c <= o ? h >= o || h <= c : h >= o && h <= c;
  });
}

export const budgetCap = (b?: string): number | undefined => (b && /\b(low|tight|cheap)\b/i.test(b) ? 2 : b && /\b(mid|moderate)\b/i.test(b) ? 3 : undefined);

/** Fixed keyword lists, disclosed in the UI: atmosphere is matched against Qloo-returned tags/description text only. */
export const ATMOSPHERE_WORDS: Record<string, string[]> = {
  quiet: ["quiet", "tranquil", "peaceful", "calm", "serene"],
  energetic: ["lively", "vibrant", "energetic", "buzzing"],
  creative: ["creative", "artsy", "artistic", "art gallery", "studio"],
  social: ["social", "friendly", "communal", "group"],
  alternative: ["alternative", "indie", "quirky", "eclectic", "bohemian"],
  adventurous: ["unique", "unusual", "experimental", "adventurous"],
};

/** Collapse branches/duplicates: "Dolci - Cunningham Road" and "Dolci, Indiranagar" share a key. */
export const nameKey = (n: string) => n.toLowerCase().replace(/\(.*?\)/g, "").split(/\s[-–|@]\s|,/)[0].replace(/[^a-z0-9 ]/g, "").trim();

/** Bounded workflow: resolve -> retrieve -> evaluate -> rank -> plan. No loops beyond maxCalls and one fallback per category. */
export async function runAgent(brief: Brief, qloo: QlooLike, mode: "live" | "dev", maxCalls = MAX_QLOO_CALLS): Promise<AgentResult> {
  const trace: TraceStep[] = [];
  const warnings: string[] = [];
  let calls = 0;
  const timed = async <T>(step: string, tool: string, fn: () => Promise<T>, detail: (r: T) => string): Promise<T | undefined> => {
    if (calls >= maxCalls) {
      trace.push({ step, tool, status: "skipped", detail: `Iteration limit (${maxCalls} tool calls) reached` });
      if (!warnings.some((w) => w.includes("limit"))) warnings.push(`Tool-call limit of ${maxCalls} reached; results are partial.`);
      return undefined;
    }
    calls++;
    const t0 = Date.now();
    try {
      const r = await fn();
      trace.push({ step, tool, status: "ok", ms: Date.now() - t0, detail: detail(r) });
      return r;
    } catch (e) {
      trace.push({ step, tool, status: "error", ms: Date.now() - t0, detail: errText(e) });
      if (e instanceof QlooError && e.kind === "auth") warnings.push("Qloo rejected the API key; remaining calls will likely fail.");
      return undefined;
    }
  };
  const src = mode === "live" ? "qloo" as const : "dev-fixture" as const;

  const questions = missingInfo(brief);
  trace.push({ step: "Request interpreted", status: "ok", detail: `${brief.people.length} person(s), ${brief.from ? `${brief.from} → ` : ""}${brief.location ?? "no destination"}; parsed by ${brief.parsedBy}; ${questions.length} open question(s)` });

  // 1. resolve each interest by kind
  const all: Interest[] = brief.people.flatMap((p) => p.interests).slice(0, MAX_INTERESTS);
  const resolved: AgentResult["resolved"] = [];
  const tagFor = new Map<Interest, Tag>();
  const options = new Map<Interest, Tag[]>();
  const favFor = new Map<Interest, Entity>();
  await Promise.all(all.map(async (i) => {
    const k = kindOf(i);
    if (k === "favorite") {
      const r = await timed(`Resolve favorite "${i.label}"`, "qloo.search", () => qloo.search(i.label, i.kind ? undefined : i.type, 5), (x) => { const p = pickFavorite(x); return `${x.length} result(s)${p ? `: ${p.name} (${p.types[0]?.replace("urn:entity:", "")})` : ""}`; });
      const pick = r && pickFavorite(r);
      if (pick) favFor.set(i, { ...pick, role: "user-favorite" });
      return;
    }
    const pickFn = k === "place" ? pickTag : pickGenre;
    const t = await timed(`Resolve ${k === "place" ? "category" : "genre"} "${i.label}"`, "qloo.tags", () => qloo.tags(i.tagQuery ?? i.label, 8), (x) => `${x.length} tag(s)${pickFn(x) ? `: ${pickFn(x)!.id}` : ""}`);
    if (t) { options.set(i, t); const pick = pickFn(t); if (pick) tagFor.set(i, pick); }
  }));
  for (const i of all) {
    if (kindOf(i) === "favorite") resolved.push({ interest: i, entity: favFor.get(i) });
    else { const t = tagFor.get(i); resolved.push({ interest: i, entity: t ? { id: t.id, name: t.name, types: ["tag"], tags: [], role: "tag", source: src } : undefined }); }
  }

  // Genre tags give a constant affinity in Qloo, so a genre is seeded with representative entities (app-selected, never "the user's favorite").
  // User-provided favorites take priority: no seeds are added for a genre when the same person named a favorite of that type.
  await Promise.all(resolved.filter((r) => r.entity && kindOf(r.interest) === "genre").map(async (r) => {
    const st = seedType(r.entity!.id, r.interest.type);
    if (!r.entity!.id.includes(":music:") && !r.entity!.id.includes(":media:")) return;
    const named = resolved.find((x) => x.interest.person === r.interest.person && kindOf(x.interest) === "favorite" && x.entity?.types[0] === st);
    if (named) { trace.push({ step: `Seed genre "${r.interest.label}"`, tool: "qloo.insights", status: "skipped", detail: `Not needed: you named ${named.entity!.name} (${st.replace("urn:entity:", "")}), which is used directly` }); return; }
    const seed = (tag: string) => timed(`Seed genre "${r.interest.label}" (${tag.split(":").slice(-2).join(":")})`, "qloo.insights", () => qloo.insights({ type: st, tags: [tag], take: 4 }), (x) => `${x.length} entity(ies): ${x.map((e) => e.name).join(", ")}`);
    let seeds = await seed(r.entity!.id);
    if (seeds && !seeds.length) { // one bounded fallback: another genre-like tag for the same phrase, same entity type
      const alt = (options.get(r.interest) ?? []).find((t) => t.id !== r.entity!.id && /^urn:tag:(genre|subgenre):/.test(t.id));
      if (alt) seeds = await seed(alt.id);
    }
    if (seeds?.length) r.seeds = seeds.map((e) => ({ ...e, role: "seed" as const }));
  }));
  const covered = (r: AgentResult["resolved"][number]) => resolved.some((x) => x.interest.person === r.interest.person && kindOf(x.interest) === "favorite" && x.entity?.types[0] === seedType(r.entity?.id ?? "", r.interest.type));
  const unresolved = resolved.filter((r) => !r.entity || (kindOf(r.interest) === "genre" && !r.seeds?.length && !covered(r)));
  if (unresolved.length) warnings.push(`Could not use: ${unresolved.map((r) => r.interest.label).join(", ")}. ${unresolved.some((r) => r.entity) ? "A genre tag was found but no representative entities, so it did not influence results." : "Qloo returned no matching entity or tag, so these did not influence results."}`);

  // 2. retrieve: each person's place categories, steered by their own signals (favorites + seeds)
  const byId = new Map<string, Candidate>();
  const positions = new Map<string, number>();
  const linkedIds = new Set<string>(), rankedIds = new Set<string>();
  const edges: Edge[] = [];
  const signalsFor = (name: string): Entity[] => resolved.filter((r) => r.interest.person === name && r.entity && kindOf(r.interest) !== "place")
    .flatMap((r) => (kindOf(r.interest) === "genre" ? r.seeds ?? [] : [r.entity!]));
  const signalName = new Map<string, string>();
  for (const r of resolved) { if (kindOf(r.interest) === "favorite" && r.entity) signalName.set(r.entity.id, `${r.entity.name} (your favorite)`); for (const s of r.seeds ?? []) signalName.set(s.id, `${s.name} (app-selected seed for "${r.interest.label}")`); }
  const personHits = new Set<string>();
  const ingest = (person: string, ents: Entity[], sigIds: string[], via: string, fallback?: Candidate["fallback"]) => {
    ents.forEach((e, pos) => {
      let c = byId.get(e.id);
      if (!c) { c = { entity: { ...e, role: "result" }, perPerson: {}, coverage: 0, rank: 0, why: [], constraints: [], via: [], evidence: "category-only", atmosphere: [], lowConfidence: false }; byId.set(e.id, c); }
      const aff = sigIds.length ? e.affinity : undefined; // Qloo reports 0 when there are no signals: not an affinity
      if (aff !== undefined || !(person in c.perPerson)) c.perPerson[person] = aff;
      if (aff !== undefined) rankedIds.add(e.id);
      if (!c.via.includes(via)) c.via.push(via);
      if (fallback && !c.fallback) c.fallback = fallback;
      positions.set(e.id, Math.min(positions.get(e.id) ?? 99, pos));
      const linked = (e.explain ?? []).filter((x) => sigIds.includes(x.id));
      for (const x of linked) { edges.push({ from: x.id, to: e.id, kind: "explain", source: e.source, score: x.score }); linkedIds.add(e.id); }
    });
  };
  const loc = brief.location;
  for (const p of brief.people) {
    const sigEnts = signalsFor(p.name);
    const sig = sigEnts.map((s) => s.id);
    const myPlaces = p.interests.filter((i) => kindOf(i) === "place" && tagFor.has(i));
    const jobs: { label: string; tag?: string; interest?: Interest }[] = myPlaces.map((i) => ({ label: i.label, tag: tagFor.get(i)!.id, interest: i }));
    if (!jobs.length && sig.length) jobs.push({ label: "taste signals" });
    for (const j of jobs) {
      const query = (tag?: string) => qloo.insights({ type: "urn:entity:place", entities: sig, location: loc, tags: tag ? [tag] : undefined, take: 12 });
      let r = await timed(`Insights: ${p.name} / ${j.label}`, "qloo.insights", () => query(j.tag), (x) => `${x.length} place(s)`);
      let fallback: Candidate["fallback"];
      let usedSig = sig;
      if (r && r.length === 0 && j.interest) { // one bounded fallback per category: next-best category tag, else the same tag without taste signals
        const alt = (options.get(j.interest) ?? []).find((t) => t.id !== j.tag && t.id.startsWith("urn:tag:category:place:"));
        const requested = j.tag!.split(":").pop()!;
        if (alt) {
          r = await timed(`Fallback ${p.name} / ${j.label}: ${requested} → ${alt.id.split(":").pop()}`, "qloo.insights", () => query(alt.id), (x) => `${x.length} place(s)`);
          if (r?.length) fallback = { requested, used: alt.id.split(":").pop()! };
        } else if (sig.length) {
          r = await timed(`Fallback ${p.name} / ${j.label}: ${requested} without taste signals`, "qloo.insights", () => qloo.insights({ type: "urn:entity:place", location: loc, tags: [j.tag!], take: 12 }), (x) => `${x.length} place(s)`);
          if (r?.length) { fallback = { requested, used: `${requested} (no taste signals)` }; usedSig = []; }
        }
        if (fallback) {
          const rr = resolved.find((x) => x.interest === j.interest); if (rr) rr.fallback = fallback;
          warnings.push(`"${j.label}": no places for the tag ${requested} in ${loc ?? "this area"} with your taste signals. Fallback: ${usedSig.length ? fallback.used : `the same tag without your signals (ranked by Qloo's default order, not your taste)`}. Not an exact match.`);
        } else warnings.push(`No places found for "${j.label}" in ${loc ?? "this area"}.`);
      }
      if (r?.length) { ingest(p.name, r, usedSig, j.label, fallback); personHits.add(p.name); }
    }
  }
  // map edges: input -> its resolved signals; input -> places returned for that category
  for (const r of resolved) {
    if (!r.entity) continue;
    if (kindOf(r.interest) === "genre") for (const s of r.seeds ?? []) edges.push({ from: `interest:${r.interest.person}:${r.interest.label}`, to: s.id, kind: "resolve", source: s.source });
    else edges.push({ from: `interest:${r.interest.person}:${r.interest.label}`, to: r.entity.id, kind: "resolve", source: r.entity.source });
  }
  for (const c of byId.values()) for (const v of c.via) for (const r of resolved) if (r.interest.label === v && r.entity && kindOf(r.interest) === "place") edges.push({ from: r.entity.id, to: c.entity.id, kind: "category", source: "derived" });

  // 2b. group affinity: re-query each distinct category with ALL people's signals together (Qloo-computed)
  const unionEnts = [...new Map(brief.people.flatMap((p) => signalsFor(p.name)).map((e) => [e.id, e])).values()];
  if (brief.people.length > 1 && unionEnts.length > 1) {
    const distinct = [...new Set([...tagFor.entries()].filter(([i]) => kindOf(i) === "place").map(([, t]) => t.id))].slice(0, 4);
    for (const tag of distinct) {
      const r = await timed(`Group affinity for ${tag.split(":").pop()}`, "qloo.insights", () => qloo.insights({ type: "urn:entity:place", entities: unionEnts.map((e) => e.id), location: loc, tags: [tag], take: 20 }), (x) => `${x.length} place(s)`);
      for (const e of r ?? []) { const c = byId.get(e.id); if (c && typeof e.affinity === "number") c.groupAffinity = e.affinity; }
    }
  }

  // 3. evaluate against constraints using only retrieved fields
  const dislikes = [...new Set([...brief.people.flatMap((p) => p.dislikes), ...brief.constraints.filter((c) => c === "crowded")])];
  const cap = budgetCap(brief.budget);
  const atmos = brief.atmosphere ?? [];
  const cands = [...byId.values()];
  for (const c of cands) {
    const e = c.entity;
    const present = Object.keys(c.perPerson);
    c.coverage = personHits.size ? present.length / personHits.size : 0;
    const aff = Object.values(c.perPerson).filter((v): v is number => typeof v === "number");
    if (aff.length && aff.length === present.length) c.groupScore = (aff.reduce((a, b) => a + b, 0) / aff.length) * c.coverage;
    c.evidence = linkedIds.has(e.id) ? "signal-linked" : rankedIds.has(e.id) ? "signal-ranked" : "category-only";
    c.lowConfidence = c.evidence === "category-only" || !!c.fallback;
    const hay = `${e.name} ${e.tags.join(" ")} ${e.description ?? ""}`.toLowerCase();
    c.atmosphere = atmos.filter((a) => (ATMOSPHERE_WORDS[a] ?? [a]).some((w) => hay.includes(w)));
    for (const d of dislikes) {
      const hit = hay.includes(d);
      c.constraints.push({ label: `Avoids "${d}"`, status: hit ? "fail" : "unknown", note: hit ? "Matched in retrieved name/tags/description" : "Not found in retrieved text; absence is not proof" });
      if (hit) c.excluded = `Excluded: matches "${d}"`;
    }
    if (e.isClosed) { c.excluded ??= "Marked closed in Qloo data"; c.constraints.push({ label: "Operating", status: "fail", note: "Qloo is_closed = true" }); }
    for (const a of atmos) c.constraints.push({ label: `Atmosphere: ${a}`, status: c.atmosphere.includes(a) ? "pass" : "unknown", note: c.atmosphere.includes(a) ? "Keyword found in Qloo tags/description (app-derived match)" : "No matching keyword in retrieved text; not evidence against" });
    c.constraints.push(e.priceLevel === undefined
      ? { label: "Budget", status: "unknown", note: "No price level in Qloo data" }
      : cap !== undefined ? { label: "Budget", status: e.priceLevel <= cap ? "pass" : "fail", note: `Qloo price level ${e.priceLevel}/4 vs "${brief.budget}" (level ≤ ${cap}); a level is an indicator, not a verified cost` }
      : { label: "Price level", status: "unknown", note: `Qloo price level ${e.priceLevel}/4 (indicator, not a verified cost)` });
    const open = openAt(e.hours, brief.when);
    if (brief.when) c.constraints.push({ label: `Scheduled open ${brief.when}`, status: open === undefined ? "unknown" : open ? "pass" : "fail", note: open === undefined ? "Hours or time not available" : "Per Qloo's weekly schedule; not a live open/closed status" });
    if (open === false) c.excluded ??= `Not scheduled open at ${brief.when} per Qloo weekly hours`;
    c.constraints.push({ label: "Location", status: loc && e.city ? (e.city.toLowerCase() === loc.toLowerCase() ? "pass" : "fail") : "unknown", note: e.city ? `Entity city: ${e.city}` : "Filtered by Qloo location query" });
    c.why.push(`Returned by ${e.source === "qloo" ? "Qloo Insights" : "the dev fixture"} for ${present.join(", ")} in ${loc ?? "the area"} (${c.via.join(", ")})`);
    const linkedNames = (e.explain ?? []).map((x) => signalName.get(x.id)).filter(Boolean) as string[];
    if (linkedNames.length) c.why.push(`Taste link (Qloo explainability): ${linkedNames.join("; ")}`);
    else if (c.evidence === "category-only") c.why.push("Category match only: Qloo returned it for the category, with no taste signal linked");
    if (c.atmosphere.length) c.why.push(`Atmosphere keywords found in Qloo text: ${c.atmosphere.join(", ")} (app-derived)`);
    if (c.fallback) c.why.push(`Fallback: requested ${c.fallback.requested}, no results, so ${c.fallback.used} was used`);
    if (c.groupAffinity !== undefined) c.why.push(`Group affinity ${c.groupAffinity.toFixed(2)} with everyone's signals combined (Qloo)`);
  }

  // 4. rank (documented): coverage, evidence tier, Qloo affinity (2 dp), atmosphere matches, Qloo order; then collapse duplicates and interleave categories
  const tier: Record<Evidence, number> = { "signal-linked": 2, "signal-ranked": 1, "category-only": 0 };
  const score = (c: Candidate) => Math.round((c.groupAffinity ?? c.groupScore ?? 0) * 100);
  const sorted = cands.filter((c) => !c.excluded).sort((a, b) =>
    b.coverage - a.coverage || tier[b.evidence] - tier[a.evidence] || score(b) - score(a) || b.atmosphere.length - a.atmosphere.length || positions.get(a.entity.id)! - positions.get(b.entity.id)!);
  const seen = new Set<string>(); let collapsed = 0;
  const unique = sorted.filter((c) => { const k = nameKey(c.entity.name); if (seen.has(k)) { collapsed++; c.excluded = "Collapsed: near-duplicate of a higher-ranked result"; return false; } seen.add(k); return true; });
  const groups = new Map<string, Candidate[]>();
  for (const c of unique) (groups.get(c.via[0]) ?? groups.set(c.via[0], []).get(c.via[0])!).push(c);
  const live: Candidate[] = [];
  for (let i = 0; live.length < unique.length; i++) for (const g of groups.values()) if (g[i]) live.push(g[i]);
  live.forEach((c, i) => (c.rank = i + 1));
  const excluded = cands.filter((c) => c.excluded);
  trace.push({ step: "Candidates ranked", status: "ok", detail: `${live.length} kept (${collapsed} near-duplicates collapsed), ${excluded.length - collapsed} excluded by constraints; interleaved across ${groups.size} categor${groups.size === 1 ? "y" : "ies"}` });
  if (!live.length) warnings.push("No suitable recommendations were found. Try a nearby city spelling, other categories or fewer constraints.");

  // 5. overlaps & trade-offs (derived)
  const shared: string[] = []; const conflicts: string[] = []; const tradeoffs: string[] = [];
  const labelPeople = new Map<string, Set<string>>();
  for (const i of all) { const k = i.label.toLowerCase(); (labelPeople.get(k) ?? labelPeople.set(k, new Set()).get(k)!).add(i.person); }
  for (const [l, s] of labelPeople) if (s.size > 1) shared.push(`${l} (${[...s].join(", ")})`);
  for (const c of live.filter((c) => c.coverage === 1 && personHits.size > 1)) shared.push(`${c.entity.name} suits everyone`);
  for (const p of brief.people) for (const d of p.dislikes) for (const i of all) if (i.person !== p.name && (i.label.toLowerCase().includes(d) || d.includes(i.label.toLowerCase()))) conflicts.push(`${p.name} avoids "${d}" but ${i.person} likes ${i.label}`);
  if (personHits.size > 1) for (const p of brief.people) if (!live.slice(0, 5).some((c) => p.name in c.perPerson)) tradeoffs.push(`${p.name} has no place in the top 5; the plan includes a stop for their interests separately`);
  for (const c of live.slice(0, 5)) if (c.coverage < 1 && personHits.size > 1) tradeoffs.push(`${c.entity.name} was retrieved only for ${Object.keys(c.perPerson).join(", ")}`);

  // 6. plan (deterministic): top diversified results that do not fail the budget; ordered by rank, NOT route-optimized
  const n = Math.min(Math.max(brief.stops ?? 3, 1), 6);
  const eligible = live.filter((c) => !c.constraints.some((k) => k.label === "Budget" && k.status === "fail"));
  const picked = eligible.slice(0, n);
  const mins = [90, 75, 60, 60, 45, 45];
  const stops: PlanStop[] = picked.map((c, i) => ({
    order: i + 1, title: c.entity.name, category: c.via[0] ?? "place", minutes: mins[i], entityId: c.entity.id,
    reason: `Rank ${c.rank}: top remaining result for "${c.via[0]}" · evidence: ${c.evidence}${c.fallback ? " · fallback tag" : ""}`,
  }));
  trace.push({ step: "Plan assembled", status: stops.length ? "ok" : "skipped", detail: `${stops.length} stop(s), proposed only` });

  return {
    mode, brief, questions, resolved, candidates: [...live, ...excluded], edges: dedupeEdges(edges), overlaps: { shared, conflicts, tradeoffs },
    plan: {
      verified: false, stops, alternatives: eligible.filter((c) => !picked.includes(c)).slice(0, 3).map((c) => c.entity.name),
      notes: [
        "Proposed, unverified: stops are ordered by relevance rank and category variety. No route, distance or travel-time optimization was performed.",
        "Hours are Qloo's weekly schedule, not live status; availability, reservations, prices and ticketing were not checked.",
        `Time split is a fixed ${mins.slice(0, stops.length).join("/")} minute heuristic.`,
      ],
    },
    trace, warnings,
  };
}

function dedupeEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  return edges.filter((e) => { const k = `${e.from}>${e.to}>${e.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function diffResults(before: { id: string; name: string }[], after: AgentResult) {
  const now = after.candidates.filter((c) => !c.excluded).map((c) => ({ id: c.entity.id, name: c.entity.name }));
  const beforeIds = new Set(before.map((b) => b.id)), nowIds = new Set(now.map((n) => n.id));
  return { added: now.filter((n) => !beforeIds.has(n.id)).map((n) => n.name), removed: before.filter((b) => !nowIds.has(b.id)).map((b) => b.name), kept: now.filter((n) => beforeIds.has(n.id)).length };
}
