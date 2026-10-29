import { z } from "zod";
import type { Brief, Interest, Person } from "./types.js";

export const ATMOSPHERES = ["quiet", "energetic", "creative", "social", "alternative", "adventurous"] as const;
export const BUDGETS = ["any", "low", "mid"] as const;

/** Place-category presets. Each tagQuery was verified live to resolve to a category:place tag with results in Bengaluru. */
export const PLACE_PRESETS: { label: string; tagQuery: string }[] = [
  { label: "Cafés", tagQuery: "cafe" },
  { label: "Japanese food", tagQuery: "japanese restaurant" },
  { label: "Heritage buildings", tagQuery: "heritage building" },
  { label: "Museums", tagQuery: "museum" },
  { label: "Art galleries", tagQuery: "art gallery" },
  { label: "Bookstores", tagQuery: "book store" },
  { label: "Live music venues", tagQuery: "live music venue" },
  { label: "Bars", tagQuery: "bar" },
  { label: "Bakeries", tagQuery: "bakery" },
  { label: "Parks", tagQuery: "park" },
  { label: "Italian food", tagQuery: "italian restaurant" },
  { label: "South Indian food", tagQuery: "south indian restaurant" },
  { label: "Movie theaters", tagQuery: "movie theater" },
];

const text = (max: number) => z.string().trim().min(1).max(max);
const list = (max: number, n: number) => z.array(text(max)).max(n).default([]);
const Taste = z.object({ favorites: list(60, 8), genres: list(40, 6), places: list(40, 8) });

export const PassportSchema = z.object({
  from: text(60).optional(),
  to: text(60),
  favorites: list(60, 8),
  genres: list(40, 6),
  places: list(40, 8),
  atmosphere: z.array(z.enum(ATMOSPHERES)).max(6).default([]),
  budget: z.enum(BUDGETS).default("any"),
  stops: z.number().int().min(1).max(6).default(3),
  avoid: list(40, 6),
  companions: z.array(Taste.extend({ name: text(30) })).max(2).default([]),
}).refine((p) => p.favorites.length + p.genres.length + p.places.length > 0, { message: "Add at least one favorite, genre or place category." });

export type Passport = z.infer<typeof PassportSchema>;

const interestsOf = (person: string, t: { favorites: string[]; genres: string[]; places: string[] }): Interest[] => [
  ...t.favorites.map((label): Interest => ({ label, type: "urn:entity:artist", person, kind: "favorite" })),
  ...t.genres.map((label): Interest => ({ label, type: "urn:entity:artist", person, kind: "genre", tagQuery: label })),
  ...t.places.map((label): Interest => {
    const preset = PLACE_PRESETS.find((p) => p.label.toLowerCase() === label.toLowerCase());
    return { label, type: "urn:entity:place", person, kind: "place", tagQuery: preset?.tagQuery ?? label };
  }),
];

export function passportToBrief(p: Passport): Brief {
  const people: Person[] = [
    { name: "You", interests: interestsOf("You", p), dislikes: p.avoid.map((a) => a.toLowerCase()) },
    ...p.companions.map((c) => ({ name: c.name, interests: interestsOf(c.name, c), dislikes: p.avoid.map((a) => a.toLowerCase()) })),
  ];
  return {
    from: p.from, location: p.to, atmosphere: p.atmosphere, stops: p.stops,
    budget: p.budget === "any" ? undefined : `${p.budget} budget`,
    constraints: [], people, parsedBy: "passport",
  };
}
