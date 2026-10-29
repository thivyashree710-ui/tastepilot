import type { Entity, QlooType } from "./types.js";
import type { InsightsParams } from "./qloo.js";

/**
 * DEV MODE ONLY. Synthetic fixtures so the UI and agent can be exercised without a key.
 * Everything here is labelled "[DEV FIXTURE]" and has source "dev-fixture"; none of it is Qloo data.
 */
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const POOL = [
  ["Quiet reading cafe", ["cafe", "quiet", "indie"]],
  ["Ramen counter", ["japanese", "casual"]],
  ["Design museum garden", ["architecture", "design", "quiet"]],
  ["Indie live-music room", ["indie", "music", "crowded"]],
  ["Retro cinema bar", ["science-fiction", "film", "crowded"]],
  ["Sushi courtyard", ["japanese", "design"]],
  ["Brutalist gallery cafe", ["architecture", "cafe", "quiet"]],
  ["Vinyl and coffee shop", ["indie", "cafe"]],
] as const;

export class DevQloo {
  async search(query: string, type?: QlooType): Promise<Entity[]> {
    return [{ id: `dev:${query}`, name: `[DEV FIXTURE] ${query}`, types: [type ?? "urn:entity:place"], tags: [], source: "dev-fixture" }];
  }
  async tags(q: string) { return [{ name: q, id: `urn:tag:category:place:dev_${q.replace(/\s+/g, "_")}` }]; }
  async insights(p: InsightsParams): Promise<Entity[]> {
    const sig = (p.entities ?? []).join("|").toLowerCase();
    return POOL.map(([name, tags], i) => {
      const overlap = tags.filter((t) => sig.includes(t.split("-")[0])).length;
      return {
        id: `dev:venue-${i}`, name: `[DEV FIXTURE] ${name}`, types: [p.type], tags: [...tags], city: p.location,
        affinity: Math.min(0.99, 0.3 + overlap * 0.25 + (hash(sig + i) % 10) / 100),
        explain: (p.entities ?? []).filter((e) => tags.some((t) => e.toLowerCase().includes(t.split("-")[0]))).map((id) => ({ id, score: 0.5 })),
        description: "Synthetic dev fixture. Not a real venue.", source: "dev-fixture" as const,
      };
    }).sort((a, b) => b.affinity! - a.affinity!).slice(0, p.take ?? 10);
  }
}
