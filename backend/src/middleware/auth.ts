import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import type { AuthRequest } from "../types";

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not configured");
    const payload = jwt.verify(token, secret);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      res.status(401).json({ error: "Invalid authentication token" });
      return;
    }
    req.user = {
      id: Number(payload.sub),
      email: typeof payload.email === "string" ? payload.email : "",
      username: typeof payload.username === "string" ? payload.username : "",
    };
    if (!Number.isInteger(req.user.id) || req.user.id < 1) {
      res.status(401).json({ error: "Invalid authentication token" });
      return;
    }
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Invalid or expired authentication token" });
      return;
    }
    next(error);
  }
}
