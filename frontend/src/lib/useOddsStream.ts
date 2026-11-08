import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { OddsAlert, OddsSport } from "./oddsTypes";
import { parseSse } from "./sse";

export type StreamState = "connecting" | "live" | "reconnecting" | "offline";

export interface StreamUpdate { sport: OddsSport; scope: string; at: string; moves: number; alerts: number; positiveEv: number; arbitrage: number }

/**
 * Keeps one live stream per sport. The server pushes "update" whenever a provider refresh lands
 * and "alerts" for new alerts; polling continues underneath as a fallback.
 */
export function useOddsStream(sport: OddsSport, handlers: { onUpdate: (update: StreamUpdate) => void; onAlerts?: (alerts: OddsAlert[]) => void }): { state: StreamState; lastEventAt: string | null } {
  const [state, setState] = useState<StreamState>("connecting");
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (typeof TextDecoder === "undefined" || typeof AbortController === "undefined") {
      setState("offline");
      return;
    }
    const controller = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      setState(attempt ? "reconnecting" : "connecting");
      try {
        const response = await api.oddsStream(sport, controller.signal);
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
            setLastEventAt(new Date().toISOString());
            try {
              if (frame.event === "update") handlersRef.current.onUpdate(JSON.parse(frame.data) as StreamUpdate);
              else if (frame.event === "alerts") handlersRef.current.onAlerts?.(JSON.parse(frame.data) as OddsAlert[]);
            } catch {
              // Ignore malformed frames; the next poll still refreshes the data.
            }
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
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [sport]);

  return { state, lastEventAt };
}
