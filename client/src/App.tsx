import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentResult, Candidate, Entity, Source } from "../../server/types.js";
import { buildGraph, graphRows, type GNode } from "./graph";

type Result = AgentResult;
type Tab = "translation" | "map" | "plan" | "group" | "activity" | "compare";
interface Taste { favorites: string[]; genres: string[]; places: string[] }
interface Companion extends Taste { name: string }
interface Passport extends Taste { from: string; to: string; atmosphere: string[]; budget: "any" | "low" | "mid"; stops: number; avoid: string[]; companions: Companion[] }
interface Status { qloo: string; llm: string; devMode: boolean }

const ATMOSPHERES = ["quiet", "energetic", "creative", "social", "alternative", "adventurous"];
const PRESETS = ["Cafés", "Japanese food", "Heritage buildings", "Museums", "Art galleries", "Bookstores", "Live music venues", "Bars", "Bakeries", "Parks", "Italian food", "South Indian food", "Movie theaters"];
const EMPTY: Passport = { from: "", to: "", favorites: [], genres: [], places: [], atmosphere: [], budget: "any", stops: 3, avoid: [], companions: [] };
// Sample input, clearly not a real user's data.
const SAMPLE: Passport = { from: "Chennai", to: "Bengaluru", favorites: ["Prateek Kuhad", "Radiohead", "Blade Runner 2049"], genres: ["indie music", "science fiction"], places: ["Cafés", "Japanese food", "Heritage buildings", "Art galleries"], atmosphere: ["quiet", "creative"], budget: "mid", stops: 4, avoid: [], companions: [] };

const SRC: Record<Source, string> = { qloo: "Qloo data", llm: "LLM-generated", derived: "App-derived", "dev-fixture": "DEV FIXTURE (not Qloo)", user: "Your input" };
const Badge = ({ s, children }: { s: Source; children?: React.ReactNode }) => <span className={`badge b-${s}`}>{children ?? SRC[s]}</span>;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}
const clean = (p: Passport) => ({ ...p, from: p.from.trim() || undefined, companions: p.companions.filter((c) => c.name.trim() && c.favorites.length + c.genres.length + c.places.length > 0) });
const valid = (p: Passport) => p.to.trim().length > 0 && p.favorites.length + p.genres.length + p.places.length > 0;

export default function App() {
  const [p, setP] = useState<Passport>(EMPTY);
  const [res, setRes] = useState<Result>();
  const [tab, setTab] = useState<Tab>("translation");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [status, setStatus] = useState<Status>();
  const formRef = useRef<HTMLElement>(null);
  useEffect(() => { api<Status>("/api/status").then(setStatus).catch(() => setErr("Cannot reach the TastePilot server.")); }, []);

  const run = async (next: Passport, prev?: Result) => {
    setBusy(true); setErr(undefined);
    try {
      const r = await api<Result>("/api/translate", { passport: clean(next), previous: prev?.candidates.filter((c) => !c.excluded).map((c) => ({ id: c.entity.id, name: c.entity.name })) });
      setRes(r); setTab("translation");
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 50);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const cta = () => { if (valid(p)) run(p); else { setErr("Add a destination city and at least one favorite, genre or place category."); formRef.current?.scrollIntoView({ behavior: "smooth" }); } };
  const sample = () => { setP(SAMPLE); run(SAMPLE); };

  return <>
    <header className="top"><div className="wrap row between">
      <a className="brand" href="#top">Taste<b>Pilot</b></a>
      <span className="mute small" role="status">{!status ? "Checking server…" : status.qloo === "configured" ? "Qloo API key configured on server" : status.devMode ? "Dev mode: no Qloo key" : "Qloo not configured"}</span>
    </div></header>
    <main id="top" className="wrap">
      {status?.devMode && <div className="notice warn" role="status"><b>Dev mode.</b> No Qloo key is set, so results are synthetic fixtures labeled “DEV FIXTURE”. None of it is Qloo data.</div>}
      {status && !status.devMode && status.qloo !== "configured" && <div className="notice warn" role="alert">The server has no Qloo API key, so it cannot translate taste yet.</div>}

      <section className="hero">
        <p className="eyebrow">Taste Translation</p>
        <h1>Your taste travels <em>with you.</em></h1>
        <p className="lede">Discover the culture, places, and experiences that feel like you—even in a city you've never known.</p>
        <div className="row gap">
          <button className="primary" onClick={cta} disabled={busy}>{busy ? "Translating…" : "Translate My Taste"}</button>
          <button className="ghost" onClick={sample} disabled={busy}>Try the sample scenario</button>
        </div>
        <p className="mute small">The sample is made-up input (Chennai → Bengaluru), not a real person's data. Results come from live Qloo calls.</p>
      </section>

      {err && <div className="notice err" role="alert">{err} <button className="link" onClick={() => setErr(undefined)}>Dismiss</button></div>}

      <PassportForm ref={formRef} p={p} setP={setP} busy={busy} onSubmit={() => run(p, res)} hasResult={!!res} />

      <div id="results" tabIndex={-1}>
        {busy && !res && <p className="mute" role="status">Resolving your taste with Qloo…</p>}
        {res && <>
          <ResultHeader r={res} />
          <nav aria-label="Results sections" className="tabs">{([["translation", "Translation"], ["map", "Map"], ["plan", "Plan"], ["group", "GroupTaste"], ["activity", "Agent activity"], ["compare", "Compare"]] as [Tab, string][]).map(([k, l]) =>
            <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>{l}</button>)}</nav>
          {tab === "translation" && <Translation r={res} p={p} setP={setP} run={() => run(p, res)} busy={busy} />}
          {tab === "map" && <MapView r={res} />}
          {tab === "plan" && <Plan r={res} p={p} setP={setP} run={() => run(p, res)} busy={busy} />}
          {tab === "group" && <Group r={res} />}
          {tab === "activity" && <Activity r={res} />}
          {tab === "compare" && <Compare p={p} status={status} />}
        </>}
      </div>
    </main>
    <footer className="wrap mute small">TastePilot is a hackathon project built on Qloo. Nothing you enter is stored; requests are processed in memory. Plans are proposals: opening status, availability and travel times are not verified.</footer>
  </>;
}

/* ---------- Passport ---------- */
function ChipInput({ label, hint, values, onChange, max }: { label: string; hint: string; values: string[]; onChange: (v: string[]) => void; max: number }) {
  const [t, setT] = useState("");
  const add = () => { const v = t.trim(); if (v && values.length < max && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]); setT(""); };
  const id = useMemo(() => `ci-${label.replace(/\W/g, "")}`, [label]);
  return <div className="field"><label htmlFor={id}>{label}</label>
    <div className="chips">{values.map((v) => <span key={v} className="chip">{v}<button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button></span>)}</div>
    <div className="row gap"><input id={id} value={t} maxLength={60} placeholder={hint} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
      <button className="ghost" onClick={add} disabled={!t.trim() || values.length >= max}>Add</button></div></div>;
}
function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) { return <button type="button" className={`pill ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick}>{label}</button>; }
const toggle = (a: string[], v: string) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);

const PassportForm = ({ p, setP, busy, onSubmit, hasResult, ref }: { p: Passport; setP: (p: Passport) => void; busy: boolean; onSubmit: () => void; hasResult: boolean; ref: React.Ref<HTMLElement> }) => {
  const set = (patch: Partial<Passport>) => setP({ ...p, ...patch });
  return <section ref={ref} className="passport" aria-labelledby="pp-h">
    <h2 id="pp-h">Your Taste Passport</h2>
    <div className="route" aria-live="polite"><span>{p.from || "Where you know"}</span><i aria-hidden="true">⟶</i><span>{p.to || "Where you're going"}</span></div>
    <div className="two">
      <div className="field"><label htmlFor="from">City you know <span className="mute">(optional context)</span></label><input id="from" value={p.from} maxLength={60} onChange={(e) => set({ from: e.target.value })} placeholder="Chennai" /></div>
      <div className="field"><label htmlFor="to">City you're moving to or visiting</label><input id="to" value={p.to} maxLength={60} onChange={(e) => set({ to: e.target.value })} placeholder="Bengaluru" /></div>
    </div>
    <ChipInput label="Specific favorites" hint="An artist, film, show or brand, then Enter" values={p.favorites} onChange={(favorites) => set({ favorites })} max={8} />
    <p className="mute small">Named favorites are matched in Qloo and used directly as your taste signals. Check the match on the Map tab.</p>
    <ChipInput label="Broader genres" hint="e.g. indie music, science fiction" values={p.genres} onChange={(genres) => set({ genres })} max={6} />
    <div className="field"><span className="lbl" id="plc">Places you love</span>
      <div className="chips" role="group" aria-labelledby="plc">{PRESETS.map((x) => <Toggle key={x} on={p.places.includes(x)} label={x} onClick={() => set({ places: toggle(p.places, x) })} />)}</div>
      <ChipInput label="Other place categories" hint="e.g. vegetarian restaurant" values={p.places.filter((x) => !PRESETS.includes(x))} onChange={(o) => set({ places: [...p.places.filter((x) => PRESETS.includes(x)), ...o] })} max={4} /></div>
    <div className="field"><span className="lbl" id="atm">Atmosphere</span><div className="chips" role="group" aria-labelledby="atm">{ATMOSPHERES.map((a) => <Toggle key={a} on={p.atmosphere.includes(a)} label={a} onClick={() => set({ atmosphere: toggle(p.atmosphere, a) })} />)}</div>
      <p className="mute small">Matched against keywords in Qloo's own text. It nudges ordering; it never excludes a place.</p></div>
    <div className="two">
      <div className="field"><label htmlFor="bud">Budget</label><select id="bud" value={p.budget} onChange={(e) => set({ budget: e.target.value as Passport["budget"] })}><option value="any">No preference</option><option value="low">Low (Qloo price level ≤ 2)</option><option value="mid">Mid (price level ≤ 3)</option></select></div>
      <div className="field"><label htmlFor="stops">Stops in the plan</label><select id="stops" value={p.stops} onChange={(e) => set({ stops: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select></div>
    </div>
    <ChipInput label="Things to avoid" hint="e.g. crowded, sushi" values={p.avoid} onChange={(avoid) => set({ avoid })} max={6} />
    <details className="field"><summary>Planning with friends? Add up to two companions</summary>
      {p.companions.map((c, i) => <div key={i} className="companion"><div className="row between"><b>Companion {i + 1}</b><button className="link" onClick={() => set({ companions: p.companions.filter((_, j) => j !== i) })}>Remove</button></div>
        <div className="field"><label htmlFor={`cn${i}`}>Name</label><input id={`cn${i}`} value={c.name} maxLength={30} onChange={(e) => set({ companions: p.companions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></div>
        <ChipInput label={`${c.name || "Companion"}'s favorites`} hint="Artist, film, show…" values={c.favorites} onChange={(favorites) => set({ companions: p.companions.map((x, j) => (j === i ? { ...x, favorites } : x)) })} max={8} />
        <div className="field"><span className="lbl">{c.name || "Companion"}'s places</span><div className="chips">{PRESETS.map((x) => <Toggle key={x} on={c.places.includes(x)} label={x} onClick={() => set({ companions: p.companions.map((y, j) => (j === i ? { ...y, places: toggle(y.places, x) } : y)) })} />)}</div></div></div>)}
      {p.companions.length < 2 && <button className="ghost" onClick={() => set({ companions: [...p.companions, { name: `Friend ${p.companions.length + 1}`, favorites: [], genres: [], places: [] }] })}>Add a companion</button>}
      <p className="mute small">Companions are just extra taste profiles for this one run. No accounts, matching or sharing.</p></details>
    <button className="primary" disabled={busy || !valid(p)} onClick={onSubmit}>{busy ? "Translating…" : hasResult ? "Re-translate with changes" : "Translate My Taste"}</button>
    {!valid(p) && <p className="mute small">Add a destination and at least one favorite, genre or place category.</p>}
  </section>;
};

/* ---------- Results ---------- */
function ResultHeader({ r }: { r: Result }) {
  const ok = r.trace.filter((t) => t.tool && t.status === "ok").length, bad = r.trace.filter((t) => t.status === "error").length;
  const fb = r.candidates.some((c) => c.fallback);
  return <div className="rhead"><h2>{r.brief.from ? `${r.brief.from} → ` : ""}{r.brief.location}</h2>
    <p className="mute small">{r.mode === "live" ? "Live Qloo" : "DEV FIXTURES"} · {ok} successful tool calls{bad ? ` · ${bad} failed` : ""}{fb ? " · fallback used" : ""} · {r.candidates.filter((c) => !c.excluded).length} places kept</p>
    {r.warnings.map((w) => <div key={w} className="notice warn" role="status">{w}</div>)}</div>;
}

function Refine({ p, setP, run, busy, r }: { p: Passport; setP: (p: Passport) => void; run: () => void; busy: boolean; r: Result }) {
  const remove = (k: keyof Taste, v: string) => setP({ ...p, [k]: p[k].filter((x) => x !== v) });
  return <div className="refine"><b>What if…</b> <span className="mute small">change something and re-translate</span>
    <div className="chips">{(["favorites", "genres", "places"] as (keyof Taste)[]).flatMap((k) => p[k].map((v) => <span key={k + v} className="chip">{v}<button aria-label={`Drop ${v}`} onClick={() => remove(k, v)}>×</button></span>))}</div>
    <div className="chips" role="group" aria-label="Atmosphere">{ATMOSPHERES.map((a) => <Toggle key={a} on={p.atmosphere.includes(a)} label={a} onClick={() => setP({ ...p, atmosphere: toggle(p.atmosphere, a) })} />)}
      <select aria-label="Budget" value={p.budget} onChange={(e) => setP({ ...p, budget: e.target.value as Passport["budget"] })}><option value="any">Any budget</option><option value="low">Low budget</option><option value="mid">Mid budget</option></select>
      <button className="primary small" disabled={busy} onClick={run}>{busy ? "Updating…" : "Update results"}</button></div>
    {r.diff && <p className="diff"><b>What changed:</b> added {r.diff.added.slice(0, 5).join(", ") || "none"}{r.diff.added.length > 5 ? "…" : ""}; removed {r.diff.removed.slice(0, 5).join(", ") || "none"}{r.diff.removed.length > 5 ? "…" : ""}; {r.diff.kept} unchanged.</p>}</div>;
}

const DAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const fmt = (s?: string) => s?.replace(/^T(\d\d:\d\d).*/, "$1") ?? "?";

function Card({ c }: { c: Candidate }) {
  const e = c.entity;
  const aff = Object.entries(c.perPerson).filter(([, v]) => v !== undefined);
  return <article className="card">
    <div className="row between"><span className="cat">{c.via[0]}</span><span className="mute small">#{c.rank}</span></div>
    <h3>{e.name}</h3>
    {e.image && e.source === "qloo" && <img src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    <div className="chips"><Badge s={e.source} /><span className={`badge ev-${c.evidence}`} title="App-derived label for how strongly Qloo's response ties this place to your signals">evidence: {c.evidence}</span>{c.lowConfidence && <span className="badge low">low confidence</span>}{c.fallback && <span className="badge low">fallback tag</span>}</div>
    <p className="facts">{[e.address, e.rating !== undefined ? `Qloo rating ${e.rating.toFixed(1)}` : "", e.priceLevel !== undefined ? `Price level ${e.priceLevel}/4 (indicator)` : ""].filter(Boolean).join(" · ")}</p>
    {e.description && <p>{e.description}</p>}
    <p className="why-h">Why it may match you</p>
    <ul className="why">{c.why.map((w) => <li key={w}>{w}</li>)}</ul>
    {aff.length > 0 && <p className="mute small">Qloo affinity (relative to your signals): {aff.map(([n, v]) => `${n} ${v!.toFixed(2)}`).join(" · ")}{c.groupAffinity !== undefined ? ` · group ${c.groupAffinity.toFixed(2)}` : ""}</p>}
    <details><summary>Constraints and uncertainty</summary><ul className="cons">{c.constraints.map((k, i) => <li key={i}><span className={`st st-${k.status}`}>{k.status}</span> <b>{k.label}</b>: {k.note}</li>)}</ul></details>
    {e.hours && <details><summary>Weekly schedule (Qloo; not live status)</summary><ul className="cons">{DAY.filter((d) => e.hours![d]).map((d) => <li key={d}><b>{d.slice(0, 3)}</b> {e.hours![d].map((s) => (s.closed ? "closed" : `${fmt(s.opens)}–${fmt(s.closes)}`)).join(", ")}</li>)}</ul></details>}
    {e.website && /^https?:\/\//.test(e.website) && <p><a href={e.website} target="_blank" rel="noopener noreferrer">Official website ↗</a></p>}
  </article>;
}

function Translation({ r, p, setP, run, busy }: { r: Result; p: Passport; setP: (p: Passport) => void; run: () => void; busy: boolean }) {
  const kept = r.candidates.filter((c) => !c.excluded);
  const [cat, setCat] = useState("all");
  const cats = [...new Set(kept.map((c) => c.via[0]))];
  const [all, setAll] = useState(false);
  const filtered = kept.filter((c) => cat === "all" || c.via[0] === cat);
  const shown = all ? filtered : filtered.slice(0, 12);
  const dropped = r.candidates.filter((c) => c.excluded);
  return <section aria-labelledby="tr-h"><h3 id="tr-h" className="sr">Translated recommendations</h3>
    <Refine p={p} setP={setP} run={run} busy={busy} r={r} />
    <p className="legend small"><Badge s="qloo" /> returned by Qloo · <Badge s="user" /> what you entered · <Badge s="derived" /> computed by this app · <Badge s="llm">LLM-generated: none used</Badge></p>
    <div className="chips" role="group" aria-label="Filter by category"><Toggle on={cat === "all"} label="All" onClick={() => setCat("all")} />{cats.map((c) => <Toggle key={c} on={cat === c} label={c} onClick={() => setCat(c)} />)}</div>
    {!kept.length ? <div className="empty"><p><b>No recommendations came back.</b></p><p>Try another spelling of the city, broader place categories, or fewer things to avoid.</p></div> :
      <><div className="grid">{shown.map((c) => <Card key={c.entity.id} c={c} />)}</div>{filtered.length > 12 && <p className="mt"><button className="ghost" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${filtered.length}`}</button></p>}</>}
    {dropped.length > 0 && <details className="mt"><summary>{dropped.length} not shown</summary><ul>{dropped.map((c) => <li key={c.entity.id}>{c.entity.name}: {c.excluded}</li>)}</ul></details>}
    <details className="mt"><summary>How results are ranked</summary><p className="small">Order = (1) coverage across people, (2) evidence tier, (3) Qloo affinity rounded to 2 decimals, (4) atmosphere keyword matches, (5) Qloo's own result order. Near-duplicate branches are collapsed and categories are interleaved for variety. Tiers and atmosphere matches are computed by this app; affinity values are Qloo's. Atmosphere keywords: quiet = quiet/tranquil/peaceful/calm/serene; creative = creative/artsy/artistic/studio; alternative = alternative/indie/quirky/eclectic/bohemian; and similar short lists.</p></details>
  </section>;
}

/* ---------- Map ---------- */
function MapView({ r }: { r: Result }) {
  const g = useMemo(() => buildGraph(r), [r]);
  const [sel, setSel] = useState<string>();
  const cols: GNode[][] = [[], [], []]; g.nodes.forEach((n) => cols[n.col].push(n));
  const H = Math.max(...cols.map((c) => c.length), 1) * 34 + 40, W = 860, X = [10, 330, 600];
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, ci) => c.forEach((n, i) => pos.set(n.id, { x: X[ci], y: 36 + i * (H - 50) / Math.max(c.length, 1) })));
  const sn = g.nodes.find((n) => n.id === sel);
  const rows = graphRows(g);
  const fill = (n: GNode) => (n.kind === "place" ? "var(--qloo)" : n.kind === "interest" ? "var(--user)" : n.role === "app-selected seed" ? "var(--derived)" : "var(--ink)");
  if (!g.nodes.length) return <div className="empty"><p>Nothing to map yet.</p></div>;
  return <section aria-labelledby="map-h"><h3 id="map-h">Taste Translation Map</h3>
    <p className="small">Left: what you told us. Middle: what Qloo resolved it to. Right: places in {r.brief.location}. <b>Solid green</b> lines are Qloo explainability (the strongest 2 per place). <b>Dashed amber</b> lines mean the place was returned under that category filter (app-derived). <b>Dotted blue</b> lines are lookups of your input in Qloo.</p>
    <div className="two wide"><div className="mapbox"><svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Taste translation graph. The same information is listed below as text." width="100%">
      {g.edges.map((e, i) => { const a = pos.get(e.from)!, b = pos.get(e.to)!, x1 = a.x + 190, x2 = b.x, dx = Math.max((x2 - x1) / 2, 40); const hot = !sel || e.from === sel || e.to === sel; return <path key={i} d={`M${x1},${a.y + 13} C${x1 + dx},${a.y + 13} ${x2 - dx},${b.y + 13} ${x2},${b.y + 13}`} fill="none" stroke={e.kind === "explain" ? "var(--qloo)" : e.kind === "category" ? "var(--derived)" : "var(--user)"} strokeWidth={e.kind === "explain" ? 1.2 + (e.score ?? 0.3) * 3 : 1.2} opacity={hot ? (e.kind === "explain" ? 0.75 : 0.5) : 0.07} strokeDasharray={e.kind === "category" ? "5 4" : e.kind === "resolve" ? "1.5 3" : undefined} />; })}
      {g.nodes.map((n) => { const q = pos.get(n.id)!; return <g key={n.id} className={`node ${sel === n.id ? "sel" : ""}`} tabIndex={0} role="button" aria-pressed={sel === n.id} aria-label={`${n.role}: ${n.label}`} onClick={() => setSel(n.id === sel ? undefined : n.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(n.id === sel ? undefined : n.id); } }} transform={`translate(${q.x},${q.y})`}>
        <rect width="190" height="26" rx="3" fill="var(--card)" stroke={fill(n)} strokeWidth="1.5" /><rect width="5" height="26" fill={fill(n)} /><text x="12" y="17">{n.label.length > 27 ? n.label.slice(0, 26) + "…" : n.label}</text></g>; })}
      {["You said", "Qloo resolved", `In ${r.brief.location ?? "destination"}`].map((t, i) => <text key={t} x={X[i]} y="14" className="colh">{t}</text>)}
    </svg></div>
    <div className="detail" aria-live="polite">{sn ? <><h4>{sn.label}</h4><div className="chips"><Badge s={sn.source} /><span className="badge">{sn.role}</span></div><p>{sn.info}</p></> : <p className="mute">Select a node (click, or Tab then Enter) to see its source and why it is here.</p>}</div></div>
    <h4>The same information as a list</h4>
    <table className="tbl"><thead><tr><th>Column</th><th>Item</th><th>Source</th><th>Connections</th></tr></thead><tbody>{rows.map(({ node, links }) => <tr key={node.id}><td>{["You said", "Qloo resolved", "Destination"][node.col]}</td><td><b>{node.label}</b><div className="mute small">{node.role}</div></td><td>{SRC[node.source]}</td><td>{links.length ? links.map((l, i) => <div key={i} className="small">{l.direction === "from" ? "←" : "→"} {l.other} <span className="mute">({l.kind === "explain" ? `Qloo explainability${l.score !== undefined ? ` ${l.score.toFixed(2)}` : ""}` : l.kind === "category" ? "returned under category filter" : "Qloo lookup"})</span></div>) : <span className="mute small">none shown</span>}</td></tr>)}</tbody></table>
  </section>;
}

/* ---------- Plan / Group / Activity / Compare ---------- */
function Plan({ r, p, setP, run, busy }: { r: Result; p: Passport; setP: (p: Passport) => void; run: () => void; busy: boolean }) {
  return <section aria-labelledby="pl-h"><h3 id="pl-h">Optional exploration plan <span className="badge low">Proposed, unverified</span></h3>
    <div className="row gap"><label htmlFor="ns">Stops</label><select id="ns" value={p.stops} onChange={(e) => setP({ ...p, stops: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select>
      <select aria-label="Budget" value={p.budget} onChange={(e) => setP({ ...p, budget: e.target.value as Passport["budget"] })}><option value="any">Any budget</option><option value="low">Low budget</option><option value="mid">Mid budget</option></select>
      <button className="ghost" onClick={run} disabled={busy}>Rebuild plan</button></div>
    {!r.plan.stops.length ? <div className="empty"><p>No plan could be assembled from the results.</p></div> :
      <ol className="plan">{r.plan.stops.map((s) => <li key={s.entityId}><b>{s.title}</b> <span className="mute">· about {s.minutes} min</span><div className="small mute">{s.reason}</div></li>)}</ol>}
    {r.plan.alternatives.length > 0 && <p><b>Alternatives:</b> {r.plan.alternatives.join(", ")}</p>}
    <ul className="small mute">{r.plan.notes.map((n) => <li key={n}>{n}</li>)}</ul></section>;
}

function Group({ r }: { r: Result }) {
  const names = r.brief.people.map((x) => x.name);
  if (names.length < 2) return <div className="empty"><p><b>GroupTaste compares several people's tastes.</b></p><p>Add a companion in the Passport (“Planning with friends?”) and re-translate to see shared interests, conflicts and trade-offs.</p></div>;
  const L = ({ items, empty }: { items: string[]; empty: string }) => items.length ? <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul> : <p className="mute">{empty}</p>;
  return <section><h3>GroupTaste</h3>
    <p className="small">Ranking is app-derived, not a Qloo score: coverage (people whose own Qloo query returned the place), then evidence tier, then group affinity, which is Qloo's affinity when everyone's signals are combined in one query. Affinities are relative per person and not calibrated across people.</p>
    <h4>Overlaps</h4><L items={r.overlaps.shared} empty="No shared interests or all-person places." /><h4>Conflicts</h4><L items={r.overlaps.conflicts} empty="None detected." /><h4>Trade-offs</h4><L items={r.overlaps.tradeoffs} empty="None among the top results." />
    <table className="tbl"><thead><tr><th>#</th><th>Place</th>{names.map((n) => <th key={n}>{n}</th>)}<th>Coverage</th><th>Group affinity (Qloo)</th></tr></thead><tbody>{r.candidates.filter((c) => !c.excluded).slice(0, 12).map((c) => <tr key={c.entity.id}><td>{c.rank}</td><td>{c.entity.name}</td>{names.map((n) => <td key={n}>{n in c.perPerson ? (c.perPerson[n] === undefined ? "listed" : c.perPerson[n]!.toFixed(2)) : "–"}</td>)}<td>{Math.round(c.coverage * 100)}%</td><td>{c.groupAffinity?.toFixed(2) ?? "n/a"}</td></tr>)}</tbody></table></section>;
}

function Activity({ r }: { r: Result }) {
  const icon = { ok: "✓", error: "✕", skipped: "–" } as const;
  return <section aria-labelledby="ac-h"><h3 id="ac-h">Agent activity</h3><p className="small mute">Only steps that actually ran, with measured time. This is an action log, not the model's reasoning.</p>
    <ol className="timeline">{r.trace.map((t, i) => <li key={i} className={`t-${t.status}`}><span className="ti" aria-label={t.status}>{icon[t.status]}</span><div><b>{t.step}</b>{t.tool && <span className="mute small"> · {t.tool}</span>}{t.ms !== undefined && <span className="mute small"> · {t.ms} ms</span>}<div className="small">{t.detail}</div></div></li>)}</ol></section>;
}

function Compare({ p, status }: { p: Passport; status?: Status }) {
  const [out, setOut] = useState<any>(); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  return <section aria-labelledby="cp-h"><h3 id="cp-h">Compare</h3>
    <div className="card"><h4>Your taste signals vs. none <Badge s="derived">measured, no LLM</Badge></h4>
      <p className="small">Runs the same place categories in the same city through Qloo twice: once with your favorites as signals, once without. It shows how much your taste changes the list. It does not claim the result is better.</p>
      <button className="ghost" disabled={busy || !valid(p)} onClick={async () => { setBusy(true); setErr(undefined); try { setOut(await api("/api/compare-signals", { passport: clean(p) })); } catch (e) { setErr((e as Error).message); } setBusy(false); }}>{busy ? "Running…" : "Run signal comparison"}</button>
      {err && <div className="notice err" role="alert">{err}</div>}
      {out && <div className="two mt"><div><h5>With your signals</h5><ol className="small">{out.personalized.map((x: any) => <li key={x.name}>{x.name} <span className="mute">({x.evidence})</span></li>)}</ol></div><div><h5>Same categories, no signals</h5><ol className="small">{out.baseline.map((x: any) => <li key={x.name}>{x.name}</li>)}</ol></div>
        <p className="small"><b>{out.overlap}</b> of the top {out.topN} places appear in both lists; <b>{out.signalLinked}</b> personalized results have a Qloo explainability link to your signals. {out.caveat}</p></div>}</div>
    <div className="card mt"><h4>LLM-only baseline <span className="badge low">{status?.llm === "configured" ? "available" : "unavailable"}</span></h4>
      <p className="small">{status?.llm === "configured" ? "An LLM key is configured, but this UI does not run the LLM comparison; use POST /api/compare. No results are reported here." : "No LLM key is configured on this server, so no LLM comparison was run and none is claimed. The app does not need an LLM."}</p></div></section>;
}
