import { Router } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { requireAuth } from "../middleware/auth";
import type { AuthRequest } from "../types";

const router = Router();
const credentials = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});
const REFRESH_COOKIE = "sharpstats_refresh";
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth",
    maxAge: REFRESH_TTL_MS,
  };
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function createRefreshToken(userId: number): Promise<string> {
  const token = randomBytes(48).toString("base64url");
  await prisma.refreshToken.create({
    data: {
      id: randomUUID(),
      userId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return token;
}

async function sendAuthResponse(
  res: import("express").Response,
  user: { id: number; email: string; username: string },
  status = 200,
) {
  const refreshToken = await createRefreshToken(user.id);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.status(status).json({ token: issueToken(user), user });
}

function issueToken(user: { id: number; email: string; username: string }): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 24) throw new Error("JWT_SECRET must be configured with at least 24 characters");
  return jwt.sign({ email: user.email, username: user.username }, secret, {
    subject: String(user.id),
    expiresIn: (process.env.JWT_EXPIRES_IN ?? "15m") as SignOptions["expiresIn"],
  });
}

router.post("/register", async (req, res, next) => {
  try {
    const data = credentials.extend({ username: z.string().trim().min(2).max(40) }).parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: { username: data.username, email: data.email, passwordHash, bankroll: { create: {} } },
      select: { id: true, username: true, email: true },
    });
    await sendAuthResponse(res, user, 201);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const data = credentials.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
      res.status(401).json({ error: "Email or password is incorrect" });
      return;
    }
    await sendAuthResponse(res, { id: user.id, username: user.username, email: user.email });
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== "string" || token.length < 40) {
      res.status(401).json({ error: "Refresh token required" });
      return;
    }
    const existing = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      include: { user: { select: { id: true, username: true, email: true } } },
    });
    if (!existing || existing.revokedAt || existing.expiresAt <= new Date()) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      res.status(401).json({ error: "Refresh token is invalid or expired" });
      return;
    }
    const nextToken = randomBytes(48).toString("base64url");
    const now = new Date();
    const rotated = await prisma.$transaction(async (transaction) => {
      const revoked = await transaction.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) return false;
      await transaction.refreshToken.create({
        data: {
          id: randomUUID(),
          userId: existing.userId,
          tokenHash: hashRefreshToken(nextToken),
          expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
        },
      });
      return true;
    });
    if (!rotated) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      res.status(401).json({ error: "Refresh token has already been used" });
      return;
    }
    res.cookie(REFRESH_COOKIE, nextToken, refreshCookieOptions());
    res.json({ token: issueToken(existing.user), user: existing.user });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (typeof token === "string") {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, username: true, email: true },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

export default router;
