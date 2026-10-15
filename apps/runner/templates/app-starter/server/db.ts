// One SQLite file through node:sqlite (sample-app.md section 1). Migrations run in name order and
// are recorded in _migrations; a reset drops every other table, runs them again and loads the seed.
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { now } from "./clock.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "migrations");
const SEED = join(HERE, "seed.json");

export type Seed = {
  clinic: { name: string; address: string; phone: string };
  staff: unknown[];
  hours: unknown[];
  bookings: unknown[];
};

const file = process.env.DB_FILE ?? "data/app.db";
mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);

export function migrate(): void {
  db.exec(readFileSync(join(MIGRATIONS, "001-base.sql"), "utf8"));
  const done = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  for (const name of files.sort()) {
    if (done.has(name)) continue;
    db.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
    db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
      name,
      now().toISOString(),
    );
  }
}

/** The seed file as written; cards that add tables load their part of it in `reset`. */
export function seed(): Seed {
  return JSON.parse(readFileSync(SEED, "utf8")) as Seed;
}

/** Drops every table but _migrations, runs the migrations again. Cards add their seed loading. */
export function reset(): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name } of tables) {
    if (name !== "_migrations") db.exec(`DROP TABLE IF EXISTS "${name}"`);
  }
  db.exec("DELETE FROM _migrations WHERE name <> '001-base.sql'");
  migrate();
}

migrate();
