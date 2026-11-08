import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
dotenv.config({ path: process.env.ENV_FILE ?? "../.env" });

const port = Number(process.env.PORT ?? 4000);

async function start(): Promise<void> {
  const [{ app }, { pool }, { prisma }, { seedDemoAccount }, { startStatsRefreshScheduler }, { startOddsScheduler }] = await Promise.all([
    import("./app"),
    import("./db/pool"),
    import("./db/prisma"),
    import("./services/seedDemo"),
    import("./services/stats.service"),
    import("./services/odds.service"),
  ]);
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
    throw new Error("Set JWT_SECRET to a secret of at least 24 characters");
  }
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  const seedPath = path.join(process.cwd(), "src", "db", "seed.sql");
  await pool.query(await readFile(schemaPath, "utf8"));
  await pool.query(await readFile(seedPath, "utf8"));
  await pool.query("SELECT 1");
  await seedDemoAccount();
  const server = app.listen(port, () => console.info(`SharpStats API listening on ${port}`));
  const stopStatsRefresh = startStatsRefreshScheduler();
  const stopOddsRefresh = startOddsScheduler();
  const shutdown = () => server.close(() => {
    stopStatsRefresh();
    stopOddsRefresh();
    void Promise.all([pool.end(), prisma.$disconnect()]).then(() => process.exit(0));
  });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((error: unknown) => {
  console.error("Unable to start SharpStats API", error);
  process.exitCode = 1;
});
