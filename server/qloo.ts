import { z } from "zod";
import type { Entity, QlooType } from "./types.js";

export type QlooErrorKind = "auth" | "rate_limit" | "timeout" | "malformed" | "http" | "unsupported" | "network";
export class QlooError extends Error {
  constructor(message: string, public kind: QlooErrorKind, public status?: number) {
    super(message);
  }
}

export interface QlooOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

// Per-entity fields are not fully documented, so validation is deliberately lenient:
// we require an id and name, and accept optional fields only when they have the expected shape.
const RawEntity = z.object({
  entity_id: z.string().optional(),
  id: z.string().optional(),
  name: z.string().min(1),
  types: z.array(z.string()).optional(),
  subtype: z.string().optional(),
  properties: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.any()).optional(),
  query: z.object({ affinity: z.number().optional(), explainability: z.any().optional() }).passthrough().optional(),
}).passthrough();

export interface InsightsParams {
  type: QlooType;
  entities?: string[];
  signalTags?: string[];
  location?: string;
  tags?: string[];
  take?: number;
}

export class QlooClient {
  private o: Required<Omit<QlooOptions, "fetchImpl" | "sleep" | "log">> & Pick<QlooOptions, "fetchImpl" | "sleep" | "log">;
  constructor(opts: QlooOptions) {
    // an unset env var arrives as undefined/"" and must not override the default
    this.o = { timeoutMs: 10000, retries: 2, ...opts, baseUrl: opts.baseUrl || "https://hackathon.api.qloo.com" };
  }

  private async request(path: string, params: Record<string, string | number | boolean | undefined>): Promise<any> {
    const url = new URL(path, this.o.baseUrl);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const f = this.o.fetchImpl ?? fetch;
    const sleep = this.o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let last: QlooError | undefined;
    for (let attempt = 0; attempt <= this.o.retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
      try {
        const res = await f(url, { headers: { "X-Api-Key": this.o.apiKey, Accept: "application/json" }, signal: ctl.signal });
        clearTimeout(timer);
        this.o.log?.(`qloo ${path} -> ${res.status} (attempt ${attempt + 1})`); // never logs key or query values
        if (res.status === 401) throw new QlooError("Qloo rejected the API key (401).", "auth", 401);
        if (res.status === 403) throw new QlooError("Qloo returned 403: the key is invalid or the entity type/parameter is unsupported.", "unsupported", 403);
        if (res.status === 429) {
          last = new QlooError("Qloo rate limit reached (429).", "rate_limit", 429);
          const ra = Number(res.headers.get("retry-after"));
          if (attempt < this.o.retries) { await sleep(Math.min((ra > 0 ? ra * 1000 : 500 * 2 ** attempt), 5000)); continue; }
          throw last;
        }
        if (res.status >= 500) {
          last = new QlooError(`Qloo server error (${res.status}).`, "http", res.status);
          if (attempt < this.o.retries) { await sleep(300 * 2 ** attempt); continue; }
          throw last;
        }
        if (!res.ok) throw new QlooError(`Qloo returned HTTP ${res.status}.`, "http", res.status);
        try { return await res.json(); } catch { throw new QlooError("Qloo returned a non-JSON body.", "malformed", res.status); }
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof QlooError) {
          if (e.kind === "rate_limit" || e.kind === "http") throw e;
          throw e;
        }
        const aborted = (e as Error)?.name === "AbortError";
        last = new QlooError(aborted ? `Qloo request timed out after ${this.o.timeoutMs}ms.` : "Network error contacting Qloo.", aborted ? "timeout" : "network");
        if (attempt < this.o.retries) { await sleep(300 * 2 ** attempt); continue; }
        throw last;
      }
    }
    throw last ?? new QlooError("Unknown Qloo failure.", "http");
  }

  static normalize(raw: unknown): Entity[] {
    const arr = Array.isArray(raw) ? raw : [];
    const out: Entity[] = [];
    for (const r of arr) {
      const p = RawEntity.safeParse(r);
      if (!p.success) continue;
      const e = p.data;
      const id = e.entity_id ?? e.id;
      if (!id) continue;
      const props: any = e.properties ?? {};
      const tags = (e.tags ?? []).map((t: any) => (typeof t === "string" ? t : t?.name ?? t?.id)).filter(Boolean) as string[];
      const exp = e.query?.explainability;
      out.push({
        id, name: e.name,
        types: e.types ?? (e.subtype ? [e.subtype] : []),
        image: typeof props.image === "string" ? props.image : typeof props.image?.url === "string" ? props.image.url : undefined,
        description: typeof props.short_description === "string" ? props.short_description : typeof props.description === "string" ? props.description : undefined,
        priceLevel: typeof props.price_level === "number" ? props.price_level : undefined,
        hours: props.hours && typeof props.hours === "object" ? props.hours : undefined,
        isClosed: typeof props.is_closed === "boolean" ? props.is_closed : undefined,
        website: typeof props.website === "string" && /^https?:\/\//.test(props.website) ? props.website : undefined,
        address: typeof (e as any).disambiguation === "string" ? (e as any).disambiguation : typeof props.address === "string" ? props.address : undefined,
        affinity: typeof e.query?.affinity === "number" ? e.query.affinity : undefined,
        tags,
        city: typeof props.geocode?.city === "string" ? props.geocode.city : undefined,
        rating: typeof props.business_rating === "number" ? props.business_rating : undefined,
        explain: extractExplain(exp),
        source: "qloo",
      });
    }
    return out;
  }

  /** Entity lookup by name. NOTE: path/params follow Qloo's /search; accepted `types` values differ from insights filter.type. */
  async search(query: string, type?: QlooType, limit = 3): Promise<Entity[]> {
    const j = await this.request("/search", { query, types: type, take: limit, limit });
    const list = j?.results?.entities ?? j?.results ?? j?.entities ?? (Array.isArray(j) ? j : undefined);
    if (!Array.isArray(list)) throw new QlooError("Search response did not contain an entity list.", "malformed");
    return QlooClient.normalize(list).slice(0, limit);
  }

  /** Resolve a text query to tag URNs via /v2/tags (verified live). */
  async tags(query: string, take = 8): Promise<{ name: string; id: string }[]> {
    const j = await this.request("/v2/tags", { "filter.query": query, take });
    const list = j?.results?.tags ?? j?.results ?? j?.tags;
    if (!Array.isArray(list)) throw new QlooError("Tags response did not contain a tag list.", "malformed");
    return list.map((t: any) => ({ name: String(t?.name ?? ""), id: String(t?.id ?? t?.tag_id ?? "") })).filter((t) => t.id.startsWith("urn:tag:"));
  }

  async insights(p: InsightsParams): Promise<Entity[]> {
    const j = await this.request("/v2/insights", {
      "filter.type": p.type,
      "signal.interests.entities": p.entities?.length ? p.entities.join(",") : undefined,
      "signal.interests.tags": p.signalTags?.length ? p.signalTags.join(",") : undefined,
      "filter.location.query": p.location,
      "filter.tags": p.tags?.join(","),
      take: p.take ?? 10,
      "feature.explainability": true,
    });
    const list = j?.results?.entities;
    if (!Array.isArray(list)) throw new QlooError("Insights response missing results.entities.", "malformed");
    return QlooClient.normalize(list);
  }
}

/** Explainability shape is only loosely documented: accept any array of {entity id, numeric score}. */
export function extractExplain(exp: unknown): { id: string; score: number }[] | undefined {
  const found: { id: string; score: number }[] = [];
  const walk = (v: any, depth: number) => {
    if (!v || typeof v !== "object" || depth > 4) return;
    if (Array.isArray(v)) {
      for (const it of v) {
        const id = it?.entity_id ?? it?.tag_id ?? it?.id ?? it?.entity?.entity_id ?? it?.entity?.id;
        const score = it?.score ?? it?.weight ?? it?.normalized_score;
        if (typeof id === "string" && typeof score === "number") found.push({ id, score });
        else walk(it, depth + 1);
      }
    } else for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(exp, 0);
  return found.length ? found : undefined;
}
