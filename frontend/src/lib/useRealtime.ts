import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { parseSse } from "./sse";

export type RealtimeState = "connecting" | "live" | "reconnecting" | "offline";

/**
 * Keeps a realtime stream open (personal events without a topic, or a live game topic) and
 * dispatches named events to handlers. Reconnects with backoff.
 */
export function useRealtime(topic: string | null, handlers: Record<string, (data: unknown) => void>, enabled = true): RealtimeState {
  const [state, setState] = useState<RealtimeState>("connecting");
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    if (!enabled || typeof TextDecoder === "undefined" || typeof AbortController === "undefined") { setState("offline"); return; }
    const controller = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const connect = async () => {
      setState(attempt ? "reconnecting" : "connecting");
      try {
        const response = await api.realtimeStream(topic, controller.signal);
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        attempt = 0;
        setState("live");
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSse(buffer);
          buffer = parsed.rest;
          for (const frame of parsed.events) {
            const handler = handlersRef.current[frame.event];
            if (!handler) continue;
            try { handler(JSON.parse(frame.data)); } catch { /* ignore malformed frames */ }
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (controller.signal.aborted) return;
      attempt += 1;
      setState(attempt > 5 ? "offline" : "reconnecting");
      timer = setTimeout(() => void connect(), Math.min(30_000, 2000 * 2 ** Math.min(attempt, 4)));
    };
    void connect();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [topic, enabled]);
  return state;
}
