import { closeRealtime } from "./realtime.service";
import { pruneNotifications } from "./notification.service";
import { pruneFeedEvents } from "./feed.service";

/** Daily cleanup of old read notifications and feed events; closes realtime streams on shutdown. */
export function startSocialMaintenance(): () => void {
  const run = () => { void pruneNotifications(); void pruneFeedEvents(); };
  const timer = setInterval(run, 24 * 3_600_000);
  timer.unref?.();
  return () => { clearInterval(timer); closeRealtime(); };
}
