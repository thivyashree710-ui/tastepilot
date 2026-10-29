import { z } from "zod";
import type { Brief, Interest, Person, QlooType } from "./types.js";
import { llmJson, type LlmConfig } from "./llm.js";

export const MAX_PROMPT = 1500;

// Rule-based lexicon: a deliberately small, inspectable fallback. Unknown phrases are reported, not guessed.
const LEXICON: { re: RegExp; label: string; type: QlooType; tagQuery?: string }[] = [
  { re: /\bindie( music)?\b/i, label: "indie music", type: "urn:entity:artist", tagQuery: "indie" },
  { re: /\bjazz\b/i, label: "jazz", type: "urn:entity:artist", tagQuery: "jazz" },
  { re: /\bhip[- ]?hop\b/i, label: "hip hop", type: "urn:entity:artist", tagQuery: "hip hop" },
  { re: /\bclassical( music)?\b/i, label: "classical music", type: "urn:entity:artist", tagQuery: "classical" },
  { re: /\b(science[- ]fiction|sci-?fi)( films?| movies?)?\b/i, label: "science-fiction films", type: "urn:entity:movie", tagQuery: "science fiction" },
  { re: /\b(thrillers?|horror|romcoms?)\b/i, label: "$1", type: "urn:entity:movie", tagQuery: "$1" },
  { re: /\banime\b/i, label: "anime", type: "urn:entity:tv_show", tagQuery: "anime" },
  { re: /\bjapanese( food| cuisine| restaurants?)?\b/i, label: "Japanese food", type: "urn:entity:place", tagQuery: "japanese restaurant" },
  { re: /\b(italian|thai|south indian|korean|vegan)( food| cuisine| restaurants?)?\b/i, label: "$1 food", type: "urn:entity:place", tagQuery: "$1 restaurant" },
  { re: /\bquiet (cafes?|caf[eé]s?)\b/i, label: "quiet cafes", type: "urn:entity:place", tagQuery: "cafe" },
  { re: /\b(cafes?|caf[eé]s?|coffee)\b/i, label: "cafes", type: "urn:entity:place", tagQuery: "cafe" },
  { re: /\barchitecture\b/i, label: "architecture", type: "urn:entity:place", tagQuery: "heritage building" },
  { re: /\bdesign\b/i, label: "design", type: "urn:entity:place", tagQuery: "art gallery" },
  { re: /\bbookshops?|bookstores?\b/i, label: "bookshops", type: "urn:entity:place", tagQuery: "bookstore" },
];

const CONSTRAINT_WORDS = ["quiet", "crowded", "vegetarian", "vegan", "wheelchair", "outdoor", "late"];

function extractInterests(segment: string, person: string): Interest[] {
  const out: Interest[] = [];
  const seen = new Set<string>();
  for (const l of LEXICON) {
    const m = segment.match(l.re);
    if (!m) continue;
    const label = l.label.replace("$1", (m[1] ?? "").toLowerCase());
    if (seen.has(label)) continue;
    // "quiet cafes" subsumes plain "cafes"
    if (label === "cafes" && seen.has("quiet cafes")) continue;
    seen.add(label);
    out.push({ label, type: l.type, person, ...(l.tagQuery ? { tagQuery: l.tagQuery.replace("$1", (m[1] ?? "").toLowerCase()) } : {}) });
  }
  return out;
}

export function parseRules(text: string): Brief {
  const t = text.slice(0, MAX_PROMPT);
  const marker = /\b(one|another|the third|the second|the other|a third|a second)(?: friend| of us)?\s+(?:likes|loves|enjoys|is into|prefers)/gi;
  const hits = [...t.matchAll(marker)];
  const people: Person[] = [];
  const names = ["Person A", "Person B", "Person C"];
  const dislikeRe = /\b(?:dislikes?|hates?|avoid(?:s|ing)?|no|without|remove)\s+([a-z][a-z -]{2,30}?)(?=[.,;]| and |$)/gi;
  const dislikesIn = (s: string) => [...s.matchAll(dislikeRe)].map((m) => m[1].trim().toLowerCase());
  if (hits.length >= 1) {
    hits.slice(0, 3).forEach((h, i) => {
      const start = h.index!;
      const end = i + 1 < hits.length ? hits[i + 1].index! : t.length;
      const seg = t.slice(start, end);
      const name = names[i];
      people.push({ name, interests: extractInterests(seg, name), dislikes: dislikesIn(seg) });
    });
    // "A and B" sentences like "the third likes architecture and design" are covered by the segment lexicon
  } else {
    people.push({ name: "You", interests: extractInterests(t, "You"), dislikes: dislikesIn(t) });
  }
  const loc = t.match(/\bin ([A-Z][\w]+(?: [A-Z][\w]+)?)/);
  const when = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|tonight|today|tomorrow)\b(?:\s+(morning|afternoon|evening|night))?/i);
  const budget = t.match(/(?:₹|rs\.?|inr|\$|usd)\s?\d[\d,]*(?:\s?(?:per person|each|total|in total))?|shared budget|tight budget|low budget|budget of [^.,]+/i);
  const constraints = CONSTRAINT_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(t) && !people.some((p) => p.interests.some((i) => i.label.includes(w))));
  return {
    location: loc?.[1], when: when ? when[0] : undefined, budget: budget?.[0],
    constraints, people, parsedBy: "rules",
  };
}

const LlmBrief = z.object({
  location: z.string().optional(), when: z.string().optional(), budget: z.string().optional(),
  constraints: z.array(z.string()).max(10),
  people: z.array(z.object({
    name: z.string(), dislikes: z.array(z.string()).max(10),
    interests: z.array(z.object({ label: z.string().max(60), tagQuery: z.string().max(40).optional(), type: z.enum([
      "urn:entity:artist", "urn:entity:movie", "urn:entity:tv_show", "urn:entity:place", "urn:entity:brand",
      "urn:entity:destination", "urn:entity:book", "urn:entity:podcast", "urn:entity:video_game"]) })).max(8),
  })).min(1).max(3),
});

export async function parseRequest(text: string, llm?: LlmConfig): Promise<Brief> {
  if (llm) {
    try {
      const b = await llmJson(llm,
        "Extract a planning brief. Use only the user's stated information; omit unknown fields. Map music→urn:entity:artist, films→urn:entity:movie, TV→urn:entity:tv_show. Food, cafes, venues, architecture and design are place categories: type urn:entity:place with tagQuery set to a short search phrase (e.g. \"japanese restaurant\", \"cafe\").",
        text.slice(0, MAX_PROMPT), LlmBrief);
      return { ...b, constraints: b.constraints, people: b.people.map((p) => ({ ...p, interests: p.interests.map((i) => ({ ...i, person: p.name })) })), parsedBy: "llm" };
    } catch { /* fall through to rules; the trace reports parsedBy */ }
  }
  return parseRules(text);
}

export function missingInfo(b: Brief): string[] {
  const q: string[] = [];
  if (!b.location) q.push("Which city or area should the plan be in?");
  if (b.people.every((p) => p.interests.length === 0)) q.push("What kinds of music, films, food or places do you enjoy?");
  b.people.forEach((p) => { if (p.interests.length === 0 && b.people.some((o) => o.interests.length)) q.push(`What does ${p.name} like?`); });
  if (!b.budget) q.push("Is there a budget? (Prices are only shown when the data source provides them.)");
  return q;
}
