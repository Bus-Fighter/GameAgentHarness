import { useEffect, useRef, useState, useCallback } from "react";
import type { WebSocketMessage } from "../types";

type Mode = "ws" | "fallback" | null;

export interface UseWebSocketResult {
  connected: boolean;
  mode: Mode;
  error: string | null;
  reconnect: () => void;
  send: (message: Record<string, unknown>) => void;
}

export function useWebSocket(
  onMessage: (msg: WebSocketMessage) => void,
): UseWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectDelayRef = useRef(500);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const cleanup = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    if (esRef.current) {
      try {
        esRef.current.close();
      } catch {}
      esRef.current = null;
    }
  }, []);

  const startSseFallback = useCallback(() => {
    if (esRef.current) return;
    setMode("fallback");
    const es = new EventSource("/api/live/events");
    esRef.current = es;
    es.onopen = () => {
      setConnected(true);
      setError(null);
    };
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as WebSocketMessage;
        onMessageRef.current(data);
      } catch (e) {
        setError("Bad SSE message: " + (e as Error).message);
      }
    };
    es.onerror = () => {
      setConnected(false);
      setError("EventSource error. Retrying...");
    };
  }, []);

  const connect = useCallback(() => {
    cleanup();
    setMode(null);
    setError(null);
    const wsUrl =
      (location.protocol === "https:" ? "wss://" : "ws://") +
      location.host +
      "/ws";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    connectTimerRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        try {
          ws.close();
        } catch {}
        setError("WebSocket blocked. Falling back to HTTP polling.");
        startSseFallback();
      }
    }, 3000);

    ws.onopen = () => {
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch {}
        esRef.current = null;
      }
      setConnected(true);
      setMode("ws");
      setError(null);
      reconnectDelayRef.current = 2000;
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: "ping" }));
        }
      }, 15000);
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as WebSocketMessage;
        onMessageRef.current(data);
      } catch (e) {
        setError("Bad message: " + (e as Error).message);
      }
    };

    ws.onclose = (event) => {
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      setConnected(false);
      if (!event.wasClean) {
        setError(
          "Connection lost. Retrying... (" +
            (event.reason || event.code || "unknown") +
            ")",
        );
      }
      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * 1.5,
        30000,
      );
      if (mode !== "fallback") {
        setTimeout(connect, reconnectDelayRef.current);
      }
    };

    ws.onerror = () => {
      setConnected(false);
      setError("WebSocket error. Falling back to HTTP polling.");
      startSseFallback();
    };
  }, [cleanup, startSseFallback, mode]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  const send = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else if (mode === "fallback") {
      fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      }).catch((e) => setError("Control failed: " + (e as Error).message));
    } else {
      setError("Not connected to dashboard server");
    }
  }, [mode]);

  return { connected, mode, error, reconnect: connect, send };
}
