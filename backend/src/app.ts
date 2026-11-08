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
import { errorHandler, notFound } from "./middleware/errors";

export const app = express();
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
app.get(["/health", "/api/health"], (_req, res) => res.json({ status: "ok" }));
app.use("/api/bets", betRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/bankroll", bankrollRoutes);
app.use("/api/odds", oddsPlatformRoutes);
app.use("/api", oddsRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/stats", statsRoutes);
app.use(notFound);
app.use(errorHandler);
