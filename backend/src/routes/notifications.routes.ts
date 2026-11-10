import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import type { AuthRequest } from "../types";
import { getPreferences, listNotifications, markRead, NOTIFICATION_TYPES, setPreferences } from "../services/social/notification.service";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ unread: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    res.json(await listNotifications(req.user!.id, { limit: query.limit, unreadOnly: query.unread === "true" }));
  } catch (error) {
    next(error);
  }
});

router.post("/read", async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ ids: z.array(z.number().int().positive()).max(200).optional(), all: z.boolean().optional() }).parse(req.body);
    res.json({ updated: await markRead(req.user!.id, body.all ? "all" : body.ids ?? []) });
  } catch (error) {
    next(error);
  }
});

router.get("/preferences", async (req: AuthRequest, res, next) => {
  try {
    res.json({ preferences: await getPreferences(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

router.put("/preferences", async (req: AuthRequest, res, next) => {
  try {
    const changes = z.record(z.enum(NOTIFICATION_TYPES), z.boolean()).parse(req.body);
    res.json({ preferences: await setPreferences(req.user!.id, changes) });
  } catch (error) {
    next(error);
  }
});

export default router;
