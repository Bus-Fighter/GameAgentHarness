import { useState, useEffect, useCallback, useRef } from "react";
import { fetchMcpStatus } from "../api";
import type { McpStatus } from "../types";

const POLL_INTERVAL = 5000;

export function useMcpStatus() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchMcpStatus();
      setStatus(s);
    } catch (err) {
      console.error("Failed to fetch MCP status", err);
    }
  }, []);

  useEffect(() => {
    function stop() {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    function start() {
      if (timerRef.current) return;
      refresh();
      timerRef.current = setInterval(refresh, POLL_INTERVAL);
    }
    function onVisibility() {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    }
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { status, refresh };
}
