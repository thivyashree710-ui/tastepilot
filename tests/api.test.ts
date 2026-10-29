import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";

describe("API", () => {
  it("503 when no key and dev mode off", async () => {
    const app = createApp({ allowDev: false });
    const b = (await request(app).post("/api/parse").send({ text: "I like jazz in Chennai" })).body;
    const r = await request(app).post("/api/plan").send({ brief: b });
    expect(r.status).toBe(503);
  });
  it("dev mode runs end-to-end and is labelled", async () => {
    const app = createApp({ allowDev: true });
    expect((await request(app).get("/api/status")).body).toMatchObject({ qloo: "missing", devMode: true });
    const b = (await request(app).post("/api/parse").send({ text: "One likes indie music and quiet cafes, another likes Japanese food in Chennai" })).body;
    const r = (await request(app).post("/api/plan").send({ brief: b })).body;
    expect(r.mode).toBe("dev");
    expect(r.candidates.every((c: any) => c.entity.source === "dev-fixture")).toBe(true);
    expect(r.plan.verified).toBe(false);
  });
  it("rejects oversize / invalid input", async () => {
    const app = createApp({ allowDev: true });
    expect((await request(app).post("/api/parse").send({ text: "x".repeat(5000) })).status).toBe(400);
    expect((await request(app).post("/api/plan").send({ brief: { people: [] } })).status).toBe(400);
  });
  it("compare refuses without keys instead of faking", async () => {
    expect((await request(createApp({ allowDev: true })).post("/api/compare").send({ text: "plan a night in Chennai" })).status).toBe(503);
  });
});
