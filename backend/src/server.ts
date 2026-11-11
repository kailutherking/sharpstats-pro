import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
dotenv.config({ path: process.env.ENV_FILE ?? "../.env" });

// Railway (and most hosts) assign the port through PORT; 4000 is the local default.
const PORT = Number(process.env.PORT) || 4000;

async function start(): Promise<void> {
  const [{ app }, { pool }, { runMigrations }, { prisma }, { seedDemoAccount }, { startStatsRefreshScheduler }, { startOddsScheduler }, { startInjuryScheduler }, { startLiveBetScanner }, { startSocialMaintenance }, { startNcaaSync }, { startSimGradingScheduler }] = await Promise.all([
    import("./app"),
    import("./db/pool"),
    import("./db/migrate"),
    import("./db/prisma"),
    import("./services/seedDemo"),
    import("./services/stats.service"),
    import("./services/odds.service"),
    import("./services/injury.service"),
    import("./services/social/liveBetTracker.service"),
    import("./services/social/maintenance"),
    import("./services/ncaa.service"),
    import("./services/simBetting.service"),
  ]);
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
    throw new Error("Set JWT_SECRET to a secret of at least 24 characters");
  }
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  const seedPath = path.join(process.cwd(), "src", "db", "seed.sql");
  await pool.query(await readFile(schemaPath, "utf8"));
  const migrated = await runMigrations(pool);
  if (migrated.length) console.info(`Applied database migrations: ${migrated.join(", ")}`);
  await pool.query(await readFile(seedPath, "utf8"));
  await pool.query("SELECT 1");
  await seedDemoAccount();
  const server = app.listen(PORT, () => {
    console.log(`SharpStats API listening on ${PORT}`);
  });
  const stopStatsRefresh = startStatsRefreshScheduler();
  const stopOddsRefresh = startOddsScheduler();
  const stopInjuryRefresh = startInjuryScheduler();
  const stopLiveBets = startLiveBetScanner();
  const stopSocial = startSocialMaintenance();
  const stopNcaaSync = startNcaaSync();
  const stopSimGrading = startSimGradingScheduler();
  const shutdown = () => server.close(() => {
    stopStatsRefresh();
    stopOddsRefresh();
    stopInjuryRefresh();
    stopLiveBets();
    stopSocial();
    stopNcaaSync();
    stopSimGrading();
    void Promise.all([pool.end(), prisma.$disconnect()]).then(() => process.exit(0));
  });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((error: unknown) => {
  console.error("Unable to start SharpStats API", error);
  process.exitCode = 1;
});
