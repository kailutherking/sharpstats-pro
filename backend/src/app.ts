import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth";
import betRoutes from "./routes/bets";
import analyticsRoutes from "./routes/analytics";
import bankrollRoutes from "./routes/bankroll";
import oddsRoutes from "./routes/odds";
import oddsPlatformRoutes from "./routes/odds.routes";
import profileRoutes from "./routes/profile";
import statsRoutes from "./routes/stats.routes";
import liveGameRoutes from "./routes/liveGame.routes";
import injuryRoutes from "./routes/injury.routes";
import socialRoutes from "./routes/social.routes";
import notificationRoutes from "./routes/notifications.routes";
import realtimeRoutes from "./routes/realtime.routes";
import { errorHandler, notFound } from "./middleware/errors";

/**
 * Proxy trust. Railway, Render, Vercel and Nginx put the client IP in X-Forwarded-For; trusting the
 * proxy hops in front of the API makes req.ip the real client, so rate limits are per visitor instead
 * of one shared bucket for the proxy. Default: 1 hop (Railway/Render/a single Nginx). Set TRUST_PROXY to
 * the hop count (e.g. 2 when a Vercel rewrite sits in front of Railway), a subnet list such as
 * "loopback, uniquelocal", or "false" when the API is exposed directly. `true` (trust everything) is
 * rejected because clients could then spoof their IP and bypass rate limits.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): number | string | false {
  const value = raw?.trim().toLowerCase();
  if (!value) return 1;
  if (value === "false" || value === "0" || value === "off") return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "true") return 1;
  return value;
}

export const app = express();
app.set("trust proxy", trustProxySetting());
app.disable("x-powered-by");
app.use(helmet());
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:5175",
  "http://localhost:5177",
  "http://192.168.1.180:5173",
  "http://192.168.1.180:5175",
  "http://192.168.1.180:5177",
  "http://192.168.1.179:5173",
  "http://192.168.1.179:5175",
  "http://192.168.1.179:5177",
  ...(process.env.CLIENT_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? []),
]);
app.use(cors({ origin: [...allowedOrigins], credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }), authRoutes);
// /health is for platform health checks (Railway); /api/health stays for existing clients.
app.get(["/health", "/api/health"], (_req, res) => res.json({ status: "ok", service: "sharpstats-backend" }));
app.use("/api/bets", betRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/bankroll", bankrollRoutes);
app.use("/api/odds", oddsPlatformRoutes);
app.use("/api", oddsRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/live-games", liveGameRoutes);
app.use("/api/injuries", injuryRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/realtime", realtimeRoutes);
app.use(notFound);
app.use(errorHandler);
