import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

/**
 * Versioned SQL migrations. `schema.sql` is the idempotent baseline; every later change is a numbered
 * file in src/db/migrations (e.g. 001_add_thing.sql), applied once, in order, inside a transaction, and
 * recorded in schema_migrations. An advisory lock keeps concurrent API instances from racing.
 */

export const MIGRATIONS_DIR = path.join(process.cwd(), "src", "db", "migrations");
const LOCK_ID = 7_340_112;

export interface Migration { version: string; name: string; sql: string; checksum: string }

export function parseMigrationFile(file: string, sql: string): Migration | null {
  const match = /^(\d{3,})_([a-z0-9_]+)\.sql$/i.exec(file);
  if (!match) return null;
  return { version: match[1]!, name: match[2]!, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((file) => file.endsWith(".sql")).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const migration = parseMigrationFile(file, await readFile(path.join(dir, file), "utf8"));
    if (!migration) throw new Error(`Migration file "${file}" must be named NNN_description.sql`);
    if (migrations.some((item) => item.version === migration.version)) throw new Error(`Duplicate migration version ${migration.version}`);
    migrations.push(migration);
  }
  return migrations;
}

/** Applies pending migrations and returns the versions applied. Fails if an applied file was edited. */
export async function runMigrations(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(20) PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const done = new Map((await client.query<{ version: string; checksum: string }>("SELECT version, checksum FROM schema_migrations")).rows.map((row) => [row.version, row.checksum]));
    for (const migration of migrations) {
      const checksum = done.get(migration.version);
      if (checksum) {
        if (checksum !== migration.checksum) throw new Error(`Migration ${migration.version}_${migration.name} changed after it was applied; add a new migration instead`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [migration.version, migration.name, migration.checksum]);
        await client.query("COMMIT");
        applied.push(migration.version);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.version}_${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}
