import { describe, it, expect } from "vitest";
import { PassportSchema, passportToBrief, PLACE_PRESETS } from "../server/passport.js";

const base = { to: "Bengaluru", favorites: ["Radiohead"] };

describe("Taste Passport validation", () => {
  it("accepts a minimal passport and applies defaults", () => {
    const p = PassportSchema.parse(base);
    expect(p).toMatchObject({ budget: "any", stops: 3, genres: [], places: [], atmosphere: [], avoid: [], companions: [] });
  });
  it("requires a destination", () => { expect(PassportSchema.safeParse({ favorites: ["x"] }).success).toBe(false); expect(PassportSchema.safeParse({ ...base, to: "  " }).success).toBe(false); });
  it("requires at least one taste input", () => {
    const r = PassportSchema.safeParse({ to: "Bengaluru" });
    expect(r.success).toBe(false);
    expect(JSON.stringify((r as any).error.issues)).toMatch(/at least one/i);
  });
  it("enforces limits and enums", () => {
    expect(PassportSchema.safeParse({ ...base, stops: 0 }).success).toBe(false);
    expect(PassportSchema.safeParse({ ...base, stops: 7 }).success).toBe(false);
    expect(PassportSchema.safeParse({ ...base, budget: "lavish" }).success).toBe(false);
    expect(PassportSchema.safeParse({ ...base, atmosphere: ["spooky"] }).success).toBe(false);
    expect(PassportSchema.safeParse({ ...base, favorites: Array(9).fill("a") }).success).toBe(false);
    expect(PassportSchema.safeParse({ ...base, favorites: ["x".repeat(61)] }).success).toBe(false);
    const three = [1, 2, 3].map((i) => ({ name: `F${i}`, favorites: ["a"] }));
    expect(PassportSchema.safeParse({ ...base, companions: three }).success).toBe(false);
  });
  it("trims input", () => { expect(PassportSchema.parse({ to: "  Pune ", favorites: [" Muse "] })).toMatchObject({ to: "Pune", favorites: ["Muse"] }); });
});

describe("passportToBrief (cross-city translation)", () => {
  it("destination becomes the location filter; source city is kept as context only", () => {
    const b = passportToBrief(PassportSchema.parse({ ...base, from: "Chennai" }));
    expect(b.location).toBe("Bengaluru");
    expect(b.from).toBe("Chennai");
    expect(b.parsedBy).toBe("passport");
  });
  it("maps favorites, genres and places to distinct interest kinds", () => {
    const b = passportToBrief(PassportSchema.parse({ ...base, genres: ["indie music"], places: ["Japanese food", "vegetarian restaurant"], budget: "mid", atmosphere: ["quiet"] }));
    const [fav, gen, jp, veg] = b.people[0].interests;
    expect(fav).toMatchObject({ kind: "favorite", label: "Radiohead" });
    expect(fav.tagQuery).toBeUndefined();
    expect(gen).toMatchObject({ kind: "genre", tagQuery: "indie music" });
    expect(jp).toMatchObject({ kind: "place", tagQuery: PLACE_PRESETS.find((x) => x.label === "Japanese food")!.tagQuery });
    expect(veg).toMatchObject({ kind: "place", tagQuery: "vegetarian restaurant" });
    expect(b.budget).toBe("mid budget"); expect(b.atmosphere).toEqual(["quiet"]);
  });
  it("companions become additional people; budget 'any' is omitted", () => {
    const b = passportToBrief(PassportSchema.parse({ ...base, companions: [{ name: "Asha", favorites: ["Muse"] }] }));
    expect(b.people.map((p) => p.name)).toEqual(["You", "Asha"]);
    expect(b.budget).toBeUndefined();
  });
});
