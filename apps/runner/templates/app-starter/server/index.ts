// One process (sample-app.md section 1): Express serves /api and, in development and tests, mounts
// Vite as middleware; in production it serves the built dist/ folder.
import { existsSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { sendError } from "./errors.ts";
import { health } from "./routes/health.ts";
import { testRoutes } from "./routes/test.ts";

const port = Number(process.env.PORT ?? 5180);
const app = express();
app.use(express.json());

const api = express.Router();
api.use(health);
if (process.env.NODE_ENV === "test") api.use(testRoutes);
api.use((_req, res) => sendError(res, 404, "NOT_FOUND", "No such API route."));
app.use("/api", api);

if (process.env.NODE_ENV === "production") {
  const dist = join(process.cwd(), "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*any}", (_req, res) => res.sendFile(join(dist, "index.html")));
  }
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(port, "127.0.0.1", () => {
  console.log(`clinic booking on http://127.0.0.1:${port}`);
});
