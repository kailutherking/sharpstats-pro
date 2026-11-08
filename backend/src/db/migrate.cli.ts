import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
dotenv.config({ path: process.env.ENV_FILE ?? "../.env" });

/** `npm run db:migrate`: applies the baseline schema, then pending migrations. */
async function main(): Promise<void> {
  const [{ pool }, { runMigrations }] = await Promise.all([import("./pool"), import("./migrate")]);
  try {
    await pool.query(await readFile(path.join(process.cwd(), "src", "db", "schema.sql"), "utf8"));
    const applied = await runMigrations(pool);
    console.info(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
