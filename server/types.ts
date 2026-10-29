/** Where a piece of data came from. "derived" = computed by this app from retrieved data. */
export type Source = "qloo" | "llm" | "derived" | "dev-fixture" | "user";

/** Role an entity plays in the translation (provenance for the map and cards). */
export type Role = "user-favorite" | "seed" | "tag" | "result";

export interface Entity {
  id: string;
  name: string;
  types: string[];
  image?: string;
  description?: string;
  affinity?: number; // only set when Qloo returned query.affinity
  tags: string[];
  city?: string;
  rating?: number;
  priceLevel?: number; // Qloo price_level indicator (1-4), not a verified cost
  hours?: Record<string, { opens?: string; closes?: string; closed?: boolean }[]>; // weekly schedule, not live status
  isClosed?: boolean;
  website?: string;
  address?: string;
  explain?: { id: string; score: number }[];
  role?: Role;
  source: Source;
}

export type QlooType =
  | "urn:entity:artist" | "urn:entity:movie" | "urn:entity:tv_show" | "urn:entity:place"
  | "urn:entity:brand" | "urn:entity:destination" | "urn:entity:book" | "urn:entity:podcast"
  | "urn:entity:video_game" | "urn:entity:person";

/** favorite = a named entity the user gave; genre = broad music/film genre (tag -> seeds); place = place category (tag filter). */
export type InterestKind = "favorite" | "genre" | "place";

export interface Interest {
  label: string;
  type: QlooType;
  person: string;
  kind?: InterestKind; // derived from type/tagQuery when absent (text planner path)
  tagQuery?: string;
}

export interface Person {
  name: string;
  interests: Interest[];
  dislikes: string[];
}

export interface Brief {
  from?: string;
  location?: string;
  when?: string;
  budget?: string;
  constraints: string[];
  atmosphere?: string[];
  stops?: number;
  people: Person[];
  parsedBy: "llm" | "rules" | "passport";
}

export interface TraceStep {
  step: string;
  tool?: string;
  status: "ok" | "error" | "skipped";
  ms?: number;
  detail?: string;
}

export type Evidence = "signal-linked" | "signal-ranked" | "category-only";

export interface Candidate {
  entity: Entity;
  perPerson: Record<string, number | undefined>; // Qloo affinity per person (only when Qloo returned it)
  coverage: number;
  groupScore?: number; // app-derived: mean of contributing Qloo affinities x coverage
  groupAffinity?: number; // Qloo affinity when queried with everyone's signals together
  via: string[]; // interests whose query returned this candidate
  evidence: Evidence; // app-derived label for how strongly retrieved data ties it to the user's signals
  fallback?: { requested: string; used: string };
  atmosphere: string[]; // app-derived keyword matches in Qloo tags/description
  lowConfidence: boolean;
  rank: number;
  why: string[];
  constraints: { label: string; status: "pass" | "fail" | "unknown"; note: string }[];
  excluded?: string;
}

export type EdgeKind = "explain" | "category" | "resolve";
export interface Edge { from: string; to: string; kind: EdgeKind; source: Source; score?: number } // score = Qloo explainability score (explain edges only)
export interface PlanStop { order: number; title: string; category: string; minutes: number; reason: string; entityId: string }

export interface AgentResult {
  mode: "live" | "dev";
  brief: Brief;
  questions: string[];
  resolved: { interest: Interest; entity?: Entity; seeds?: Entity[]; fallback?: { requested: string; used: string } }[];
  candidates: Candidate[];
  edges: Edge[];
  plan: { verified: false; stops: PlanStop[]; alternatives: string[]; notes: string[] };
  overlaps: { shared: string[]; conflicts: string[]; tradeoffs: string[] };
  trace: TraceStep[];
  warnings: string[];
  diff?: { added: string[]; removed: string[]; kept: number };
}
