export function buildDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Game Agent Harness Dashboard</title>
  <style>
    :root {
      --bg: #0b0d10;
      --panel: #14171c;
      --panel-2: #1c2028;
      --border: #2a303a;
      --text: #e8ecf1;
      --muted: #9aa3b2;
      --accent: #3b82f6;
      --accent-2: #22c55e;
      --danger: #ef4444;
      --warning: #f59e0b;
      --radius: 12px;
      --gap: 16px;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.45;
    }

    .app {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 1.05rem;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--muted);
      flex-shrink: 0;
    }

    .dot.online { background: var(--accent-2); box-shadow: 0 0 8px var(--accent-2); }
    .dot.offline { background: var(--danger); }

    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--muted);
    }

    .btn-sm {
      padding: 4px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel-2);
      color: var(--text);
      font-size: 0.8rem;
      cursor: pointer;
    }

    .btn-sm:hover {
      border-color: var(--accent);
      background: var(--accent);
      color: white;
    }

    .conn-error {
      background: rgba(239, 68, 68, 0.12);
      color: var(--danger);
      padding: 10px 16px;
      text-align: center;
      font-size: 0.85rem;
      border-bottom: 1px solid rgba(239, 68, 68, 0.25);
    }
    main {
      display: grid;
      grid-template-columns: 1fr 320px;
      grid-template-rows: 1fr auto auto;
      grid-template-areas:
        "live context"
        "live diagnostics"
        "evidence evidence";
      gap: var(--gap);
      padding: var(--gap);
      overflow: hidden;
    }

    @media (max-width: 900px) {
      main {
        grid-template-columns: 1fr;
        grid-template-rows: auto auto auto 1fr;
        grid-template-areas:
          "live"
          "diagnostics"
          "context"
          "evidence";
        overflow-y: auto;
      }
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: var(--panel-2);
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }

    .panel-body {
      flex: 1;
      overflow: auto;
      padding: 14px;
    }

    #live-panel { grid-area: live; min-height: 0; }
    #context-panel { grid-area: context; }
    #diagnostics-panel { grid-area: diagnostics; }
    #evidence-panel { grid-area: evidence; max-height: 220px; }

    @media (max-width: 900px) {
      #live-panel { min-height: 320px; }
      #evidence-panel { max-height: none; }
    }
    }

    .live-viewport {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
    }

    .live-viewport img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      transition: opacity 0.15s ease;
    }

    .live-viewport .placeholder {
      color: var(--muted);
      text-align: center;
      padding: 24px;
    }

    .live-meta {
      position: absolute;
      bottom: 8px;
      left: 8px;
      display: flex;
      gap: 8px;
      font-size: 0.7rem;
      color: #fff;
      background: rgba(0,0,0,0.6);
      padding: 4px 8px;
      border-radius: 6px;
      pointer-events: none;
    }

    .context-list {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: 0.92rem;
    }

    .context-list li {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
    }

    .context-list li:last-child { border-bottom: none; }

    .context-key { color: var(--muted); }
    .context-value { color: var(--text); font-weight: 500; max-width: 55%; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
      background: var(--panel-2);
      color: var(--muted);
    }

    .badge.ok { background: rgba(34,197,94,0.15); color: var(--accent-2); }
    .badge.fail { background: rgba(239,68,68,0.15); color: var(--danger); }
    .badge.warn { background: rgba(245,158,11,0.15); color: var(--warning); }

    .evidence-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
    }

    @media (max-width: 600px) {
      .evidence-grid { grid-template-columns: repeat(2, 1fr); }
    }

    .evidence-card {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.1s ease, border-color 0.15s ease;
    }

    .evidence-card:hover { border-color: var(--accent); transform: translateY(-2px); }

    .evidence-card img {
      width: 100%;
      aspect-ratio: 16/10;
      object-fit: cover;
      display: block;
      background: #000;
    }

    .evidence-card .caption {
      padding: 8px;
      font-size: 0.75rem;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .empty {
      color: var(--muted);
      font-size: 0.9rem;
      padding: 12px 0;
    }

    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text);
      text-transform: none;
      letter-spacing: 0;
    }

    .toggle input {
      appearance: none;
      width: 36px;
      height: 20px;
      background: var(--border);
      border-radius: 999px;
      position: relative;
      outline: none;
      cursor: pointer;
      transition: background 0.2s ease;
    }

    .toggle input::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s ease;
    }

    .toggle input:checked {
      background: var(--accent-2);
    }

    .toggle input:checked::after {
      transform: translateX(16px);
    }

    .toggle input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error-toast {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: var(--danger);
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 100;
    }

    .error-toast.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="brand">
        <div id="conn-dot" class="dot offline"></div>
        <span>Game Agent Harness</span>
      </div>
      <div class="status">
        <span id="conn-status">Connecting…</span>
        <button id="reconnect-btn" class="btn-sm" style="display:none;">Reconnect</button>
        <span id="trace-status" class="badge">No trace</span>
      </div>
    </header>

    <div id="conn-error" class="conn-error" style="display:none;"></div>

    <main>
      <section id="live-panel" class="panel">
        <div class="panel-header">
          <span>Live Viewport</span>
          <div style="display:flex;gap:12px;align-items:center;">
            <label class="toggle">
              <input id="editor-toggle" type="checkbox" checked>
              <span>Editor</span>
            </label>
            <label class="toggle">
              <input id="runtime-toggle" type="checkbox" checked>
              <span>Runtime</span>
            </label>
          </div>
        </div>
        <div class="panel-body">
          <div class="live-viewport">
            <div id="live-placeholder" class="placeholder">
              No live frame yet.<br>
              1. Enable the Game Agent Harness plugin in Godot.<br>
              2. Set Godot intake URL to <b id="intake-url-hint">ws://127.0.0.1:8765</b>.<br>
              3. Turn on <b>Live viewport capture</b> and select/run a scene.
            </div>
            <img id="live-img" alt="Live viewport" style="display:none;">
            <div id="live-overlay" class="live-meta" style="display:none;"></div>
          </div>
        </div>
      </section>

      <section id="diagnostics-panel" class="panel">
        <div class="panel-header">
          <span>Connection Diagnostics</span>
          <span id="engine-status-badge" class="badge">No engine</span>
        </div>
        <div class="panel-body">
          <ul class="context-list">
            <li><span class="context-key">Intake URL</span><span id="diag-intake-url" class="context-value">-</span></li>
            <li><span class="context-key">Engine clients</span><span id="diag-engine-clients" class="context-value">0</span></li>
            <li><span class="context-key">Last engine seen</span><span id="diag-last-engine" class="context-value">-</span></li>
            <li><span class="context-key">Dashboard clients</span><span id="diag-dashboard-clients" class="context-value">0</span></li>
            <li><span class="context-key">Latest frame</span><span id="diag-latest-frame" class="context-value">-</span></li>
          </ul>
        </div>
      </section>

      <section id="context-panel" class="panel">
        <div class="panel-header">Context</div>
        <div class="panel-body">
          <ul class="context-list">
            <li><span class="context-key">Project</span><span id="ctx-project" class="context-value">-</span></li>
            <li><span class="context-key">Engine</span><span id="ctx-engine" class="context-value">-</span></li>
            <li><span class="context-key">Scene</span><span id="ctx-scene" class="context-value">-</span></li>
            <li><span class="context-key">Runtime</span><span id="ctx-runtime" class="context-value">-</span></li>
            <li><span class="context-key">Selected</span><span id="ctx-selected" class="context-value">-</span></li>
            <li><span class="context-key">Validations</span><span id="ctx-validations" class="context-value">-</span></li>
            <li><span class="context-key">Events</span><span id="ctx-events" class="context-value">-</span></li>
          </ul>
        </div>
      </section>

      <section id="evidence-panel" class="panel">
        <div class="panel-header">
          <span>Recent Evidence</span>
          <span id="evidence-count" class="badge">0</span>
        </div>
        <div class="panel-body">
          <div id="evidence-grid" class="evidence-grid">
            <div class="empty">No screenshots yet.</div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <div id="error-toast" class="error-toast"></div>

  <script>
    (function () {
      const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
      const apiBase = "/api";

      const els = {
        connDot: document.getElementById("conn-dot"),
        connStatus: document.getElementById("conn-status"),
        reconnectBtn: document.getElementById("reconnect-btn"),
        connError: document.getElementById("conn-error"),
        traceStatus: document.getElementById("trace-status"),
        liveImg: document.getElementById("live-img"),
        livePlaceholder: document.getElementById("live-placeholder"),
        liveOverlay: document.getElementById("live-overlay"),
        editorToggle: document.getElementById("editor-toggle"),
        runtimeToggle: document.getElementById("runtime-toggle"),
        engineStatusBadge: document.getElementById("engine-status-badge"),
        diagIntakeUrl: document.getElementById("diag-intake-url"),
        diagEngineClients: document.getElementById("diag-engine-clients"),
        diagLastEngine: document.getElementById("diag-last-engine"),
        diagDashboardClients: document.getElementById("diag-dashboard-clients"),
        diagLatestFrame: document.getElementById("diag-latest-frame"),
        project: document.getElementById("ctx-project"),
        engine: document.getElementById("ctx-engine"),
        scene: document.getElementById("ctx-scene"),
        runtime: document.getElementById("ctx-runtime"),
        selected: document.getElementById("ctx-selected"),
        validations: document.getElementById("ctx-validations"),
        events: document.getElementById("ctx-events"),
        evidenceGrid: document.getElementById("evidence-grid"),
        evidenceCount: document.getElementById("evidence-count"),
        errorToast: document.getElementById("error-toast"),
      };

      const intakeHint = document.getElementById("intake-url-hint");
      if (intakeHint) {
        intakeHint.textContent = "ws://" + location.hostname + ":8765";
      }

      let state = {
        traceId: null,
        connected: false,
        fallback: false,
        evidence: [],
        lastSeq: 0,
        ws: null,
        eventSource: null,
        reconnectDelay: 2000,
        pingTimer: null,
        connectTimer: null,
      };

      function setOnline(online, mode) {
        state.connected = online;
        els.connDot.classList.toggle("online", online);
        els.connDot.classList.toggle("offline", !online);
        if (online) {
          els.connStatus.textContent = mode === "fallback" ? "Live (polling)" : "Live";
          els.reconnectBtn.style.display = "none";
          els.connError.style.display = "none";
          els.connError.textContent = "";
          state.reconnectDelay = 2000;
        } else {
          els.connStatus.textContent = state.fallback ? "Polling…" : "Disconnected";
          els.reconnectBtn.style.display = "inline-block";
        }
      }

      function setConnectionError(msg) {
        if (!state.connected) {
          els.connError.textContent = msg;
          els.connError.style.display = "block";
        }
      }

      function showError(msg) {
        els.errorToast.textContent = msg;
        els.errorToast.classList.add("show");
        setTimeout(() => els.errorToast.classList.remove("show"), 3000);
      }

      function formatTime(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }

      function updateContext(status, context) {
        if (status.traceId) {
          state.traceId = status.traceId;
          els.traceStatus.textContent = status.traceActive ? "Active: " + status.traceId.slice(0, 8) : "Idle";
          els.traceStatus.className = "badge " + (status.traceActive ? "ok" : "warn");
        }
        if (!context) return;
        els.project.textContent = context.observed?.project?.name || context.profile?.project?.name || "-";
        els.engine.textContent = context.observed?.engine?.name || context.profile?.engine?.name || "-";
        els.scene.textContent = context.scene || "-";
        els.runtime.textContent = context.runtime?.running ? "Running" : "Stopped";
        els.selected.textContent = context.selected?.name || context.selected?.path || "none";
        const v = context.validations;
        els.validations.innerHTML = v ? \`\${v.passed} \u003cspan class="badge ok"\u003ePASS\u003c/span\u003e / \${v.failed} \u003cspan class="badge fail"\u003eFAIL\u003c/span\u003e\` : "-";
        els.events.textContent = context.recentTimeline?.length ?? "-";
      }

      function updateDiagnostics(status) {
        els.diagIntakeUrl.textContent = status.intakeUrl || "-";
        els.diagEngineClients.textContent = status.engineClients ?? 0;
        els.diagDashboardClients.textContent = status.dashboardClients ?? 0;
        els.diagLastEngine.textContent = status.latestFrame?.receivedAt ? formatTime(status.latestFrame.receivedAt) : "-";
        els.diagLatestFrame.textContent = status.latestFrame
          ? (status.latestFrame.width || "?") + "\u00d7" + (status.latestFrame.height || "?") + " " + (status.latestFrame.source || "")
          : "-";
        const hasEngine = (status.engineClients ?? 0) > 0;
        els.engineStatusBadge.textContent = hasEngine ? "Engine connected" : "No engine";
        els.engineStatusBadge.className = "badge " + (hasEngine ? "ok" : "warn");
      }

      async function fetchStatus() {
        try {
          const res = await fetch(apiBase + "/status");
          if (!res.ok) return;
          const status = await res.json();
          updateDiagnostics(status);
          if (status.traceId) {
            const ctxRes = await fetch(apiBase + "/traces/" + status.traceId + "/context");
            if (ctxRes.ok) {
              const { context } = await ctxRes.json();
              updateContext(status, context);
            } else {
              updateContext(status, null);
            }
          }
        } catch (e) {
          // ignore polling errors
        }
      }

      function renderEvidence() {
        if (state.evidence.length === 0) {
          els.evidenceGrid.innerHTML = \`\u003cdiv class="empty"\u003eNo screenshots yet.\u003c/div\u003e\`;
          els.evidenceCount.textContent = "0";
          return;
        }
        els.evidenceCount.textContent = state.evidence.length;
        els.evidenceGrid.innerHTML = state.evidence
          .slice()
          .reverse()
          .map((ev) => \`
            \u003cdiv class="evidence-card"\u003e
              \u003cimg src="\${ev.url}" alt="\${ev.type}" loading="lazy"\u003e
              \u003cdiv class="caption"\u003e#\${ev.seq} \${ev.type.replace("evidence.", "")} \u0026middot; \${formatTime(ev.receivedAt)}\u003c/div\u003e
            \u003c/div\u003e
          \`)
          .join("");
      }

      async function loadEvidence(traceId, since = 0) {
        try {
          const res = await fetch(apiBase + "/traces/" + traceId + "/events?type=evidence.&limit=50");
          if (!res.ok) return;
          const { events } = await res.json();
          const images = events
            .filter((e) => e.type?.startsWith("evidence.") && e.data?.path)
            .map((e) => ({
              seq: e.seq,
              type: e.type,
              receivedAt: e.receivedAt,
              url: apiBase + "/traces/" + traceId + "/evidence/" + e.data.path,
            }));
          state.evidence = images;
          state.lastSeq = events.length ? events[events.length - 1].seq : state.lastSeq;
          renderEvidence();
        } catch (e) {
          showError("Could not load evidence: " + e.message);
        }
      }

      function handleFrame(frame) {
        if (!frame || !frame.seq) return;
        const url = apiBase + "/live/frame?t=" + Date.now();
        els.liveImg.src = url;
        els.liveImg.style.display = "";
        els.livePlaceholder.style.display = "none";
        els.liveOverlay.style.display = "flex";
        els.liveOverlay.innerHTML = "\n          \u003cspan\u003e#" + frame.seq + "\u003c/span\u003e\n          \u003cspan\u003e" + (frame.source || "viewport") + "\u003c/span\u003e\n          \u003cspan\u003e" + (frame.width || "?") + "\u00d7" + (frame.height || "?") + "\u003c/span\u003e\n          \u003cspan\u003e" + formatTime(frame.receivedAt) + "\u003c/span\u003e\n        ";
      }

      function handleEvent(event) {
        if (event.type?.startsWith("evidence.") && event.data?.path) {
          state.evidence.push({
            seq: event.seq,
            type: event.type,
            receivedAt: event.receivedAt,
            url: apiBase + "/traces/" + state.traceId + "/evidence/" + event.data.path,
          });
          if (state.evidence.length > 50) state.evidence.shift();
          renderEvidence();
        }
        if (event.seq > state.lastSeq) state.lastSeq = event.seq;
      }

      function handleMessage(data) {
        if (data.kind === "hello") {
          if (data.traceId) {
            state.traceId = data.traceId;
            loadEvidence(data.traceId);
            fetchStatus();
          }
        } else if (data.kind === "frame") {
          handleFrame(data);
        } else if (data.kind === "event") {
          handleEvent(data.event);
          if (data.event.type === "editor_capture.changed") {
            els.editorToggle.checked = Boolean(data.event.data?.enabled);
          } else if (data.event.type === "runtime_capture.changed") {
            els.runtimeToggle.checked = Boolean(data.event.data?.enabled);
          }
        } else if (data.kind === "context") {
          updateContext({ traceId: state.traceId, traceActive: true }, data.context);
        } else if (data.kind === "trace") {
          state.traceId = data.traceId;
          state.evidence = [];
          state.lastSeq = 0;
          if (data.traceId) {
            loadEvidence(data.traceId);
            fetchStatus();
          } else {
            els.traceStatus.textContent = "No trace";
            els.traceStatus.className = "badge";
            renderEvidence();
          }
        }
      }

      function startSseFallback() {
        if (state.eventSource) return;
        state.fallback = true;
        els.connStatus.textContent = "Polling…";
        const es = new EventSource(apiBase + "/live/events");
        state.eventSource = es;
        es.onopen = () => {
          setOnline(true, "fallback");
        };
        es.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            handleMessage(data);
          } catch (e) {
            showError("Bad SSE message: " + e.message);
          }
        };
        es.onerror = () => {
          setOnline(false);
          setConnectionError("EventSource error. Retrying…");
        };
      }

      function stopSseFallback() {
        if (state.eventSource) {
          try { state.eventSource.close(); } catch {}
          state.eventSource = null;
        }
        state.fallback = false;
      }

      function connect() {
        stopSseFallback();
        if (state.ws != null) {
          try { state.ws.close(); } catch {}
          state.ws = null;
        }
        els.connStatus.textContent = "Connecting…";
        const ws = new WebSocket(wsUrl);
        state.ws = ws;

        if (state.connectTimer) clearTimeout(state.connectTimer);
        state.connectTimer = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            try { ws.close(); } catch {}
            setConnectionError("WebSocket blocked. Falling back to HTTP polling.");
            startSseFallback();
          }
        }, 3000);

        ws.onopen = () => {
          if (state.connectTimer) {
            clearTimeout(state.connectTimer);
            state.connectTimer = null;
          }
          stopSseFallback();
          setOnline(true);
          state.reconnectDelay = 2000;
          fetchStatus();
          if (state.pingTimer) clearInterval(state.pingTimer);
          state.pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ action: "ping" }));
            }
          }, 15000);
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            handleMessage(data);
          } catch (e) {
            showError("Bad message: " + e.message);
          }
        };

        ws.onclose = (event) => {
          if (state.connectTimer) {
            clearTimeout(state.connectTimer);
            state.connectTimer = null;
          }
          if (state.pingTimer) {
            clearInterval(state.pingTimer);
            state.pingTimer = null;
          }
          setOnline(false);
          if (!event.wasClean) {
            setConnectionError("Connection lost. Retrying… (" + (event.reason || event.code || "unknown") + ")");
          }
          state.reconnectDelay = Math.min(state.reconnectDelay * 1.5, 30000);
          if (!state.fallback) {
            setTimeout(connect, state.reconnectDelay);
          }
        };

        ws.onerror = () => {
          setOnline(false);
          setConnectionError("WebSocket error. Falling back to HTTP polling.");
          startSseFallback();
        };
      }

      async function sendControlHttp(message) {
        try {
          const res = await fetch(apiBase + "/control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message),
          });
          if (!res.ok) throw new Error("HTTP " + res.status);
        } catch (e) {
          showError("Control failed: " + e.message);
        }
      }

      function sendControl(message) {
        if (state.connected && state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify(message));
        } else if (state.fallback) {
          sendControlHttp(message);
        } else {
          showError("Not connected to dashboard server");
        }
      }

      els.reconnectBtn.addEventListener("click", () => {
        state.reconnectDelay = 500;
        stopSseFallback();
        connect();
      });


      els.editorToggle.addEventListener("change", () => {
        sendControl({
          kind: "control",
          action: "editor_capture",
          enabled: els.editorToggle.checked,
        });
      });

      els.runtimeToggle.addEventListener("change", () => {
        sendControl({
          kind: "control",
          action: "runtime_capture",
          enabled: els.runtimeToggle.checked,
        });
      });

      async function pollLiveFrame() {
        try {
          const res = await fetch(apiBase + "/live/frame?t=" + Date.now());
          if (!res.ok) return;
          const contentType = res.headers.get("content-type") || "image/jpeg";
          const blob = await res.blob();
          if (blob.size === 0) return;
          const url = URL.createObjectURL(blob);
          els.liveImg.onload = () => { URL.revokeObjectURL(url); };
          els.liveImg.src = url;
          els.liveImg.style.display = "";
          els.livePlaceholder.style.display = "none";
        } catch (e) {
          // ignore polling errors
        }
      }

      connect();
      setInterval(fetchStatus, 2000);
      setInterval(pollLiveFrame, 2000);
    })();
  </script>
</body>
</html>
`;
}
