import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import type { AuthRequest } from "../types";
import { openRealtime, TOPIC_PATTERN } from "../services/social/realtime.service";

const router = Router();
router.use(requireAuth);

/** Personal stream (notifications) without `topic`; live game chat and reactions with `topic=game:<league>:<id>`. */
router.get("/stream", (req: AuthRequest, res) => {
  const topic = typeof req.query.topic === "string" ? req.query.topic : null;
  if (topic && !TOPIC_PATTERN.test(topic)) {
    res.status(400).json({ error: "Invalid topic" });
    return;
  }
  openRealtime(res, req.user!.id, topic);
});

export default router;
