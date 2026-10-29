import type { QlooLike } from "../server/agent.js";
import type { Entity } from "../server/types.js";

export const ent = (id: string, name: string, extra: Partial<Entity> = {}): Entity => ({ id, name, types: ["urn:entity:place"], tags: [], source: "qloo", ...extra });

/** Configurable fake Qloo. place insights are routed by (tag) so each category can return different places. */
export function mkQloo(o: {
  search?: QlooLike["search"];
  tags?: QlooLike["tags"];
  places?: (p: Parameters<QlooLike["insights"]>[0]) => Entity[];
  seeds?: (p: Parameters<QlooLike["insights"]>[0]) => Entity[];
  log?: string[];
} = {}): QlooLike {
  return {
    search: async (q, t, n) => { o.log?.push(`search:${q}`); return o.search ? o.search(q, t, n) : [ent(`fav:${q}`, q, { types: ["urn:entity:artist"] })]; },
    tags: async (q, n) => {
      o.log?.push(`tags:${q}`);
      if (o.tags) return o.tags(q, n);
      const k = q.replace(/\s+/g, "_");
      return [{ name: q, id: `urn:tag:genre:music:${k}` }, { name: q, id: `urn:tag:category:place:${k}` }];
    },
    insights: async (p) => {
      o.log?.push(`insights:${p.type.replace("urn:entity:", "")}:${p.tags?.[0] ?? "-"}:${(p.entities ?? []).length}`);
      if (p.type === "urn:entity:place") return o.places ? o.places(p) : [ent(`p:${p.tags?.[0]}`, `Place for ${p.tags?.[0]}`, { affinity: 0.5 })];
      return o.seeds ? o.seeds(p) : [ent(`seed:${p.tags?.[0]}`, "Seed One", { types: [p.type] })];
    },
  };
}
