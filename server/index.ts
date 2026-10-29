import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp, depsFromEnv } from "./app.js";

const app = createApp(depsFromEnv());
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
app.use(express.static(dist));
app.use((req, res) => req.path.startsWith("/api") ? res.status(404).json({ error: "Not found" }) : res.sendFile(path.join(dist, "index.html"), (e) => e && res.status(404).end()));
const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`TastePilot API on :${port}`));
