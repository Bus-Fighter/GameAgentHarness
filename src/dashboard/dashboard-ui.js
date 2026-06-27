export function buildDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Game Agent Harness</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Fira+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0F172A;
      --surface: #1E293B;
      --surface-2: #334155;
      --border: #475569;
      --text: #F8FAFC;
      --muted: #94A3B8;
      --accent: #22C55E;
      --accent-dim: rgba(34, 197, 94, 0.15);
      --warning: #F59E0B;
      --warning-dim: rgba(245, 158, 11, 0.15);
      --danger: #EF4444;
      --danger-dim: rgba(239, 68, 68, 0.15);
      --info: #3B82F6;
      --info-dim: rgba(59, 130, 246, 0.15);
      --radius: 12px;
      --radius-sm: 8px;
      --transition: 200ms ease;
      --header-h: 56px;
      --action-bar-h: 72px;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      min-height: 100dvh;
      background: var(--bg);
      color: var(--text);
      font-family: "Fira Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      overscroll-behavior: contain;
      -webkit-font-smoothing: antialiased;
    }

    code, pre, .mono {
      font-family: "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .app {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
    }

    /* Header */
    .status-header {
      position: sticky;
      top: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      height: var(--header-h);
      padding: 0 16px;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 1rem;
      letter-spacing: -0.01em;
    }

    .status-pills {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: var(--surface);
      color: var(--muted);
      border: 1px solid var(--border);
      white-space: nowrap;
    }

    .pill .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }

    .pill.online { color: var(--accent); background: var(--accent-dim); border-color: rgba(34, 197, 94, 0.3); }
    .pill.online .dot { box-shadow: 0 0 8px var(--accent); }
    .pill.offline { color: var(--danger); background: var(--danger-dim); border-color: rgba(239, 68, 68, 0.3); }
    .pill.warn { color: var(--warning); background: var(--warning-dim); border-color: rgba(245, 158, 11, 0.3); }
    .pill.info { color: var(--info); background: var(--info-dim); border-color: rgba(59, 130, 246, 0.3); }

    .reconnect-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: border-color var(--transition), background var(--transition);
    }

    .reconnect-btn:hover, .reconnect-btn:focus-visible {
      border-color: var(--accent);
      background: var(--surface-2);
      outline: none;
    }

    .reconnect-btn svg {
      width: 14px;
      height: 14px;
    }

    /* Main layout */
    main {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      padding: 16px;
      padding-bottom: calc(var(--action-bar-h) + 24px);
    }

    @media (min-width: 1024px) {
      main {
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
        grid-template-rows: auto 1fr auto;
        grid-template-areas:
          "viewport scene"
          "viewport events"
          "viewport evidence";
        align-items: start;
      }
      .viewport-panel { grid-area: viewport; position: sticky; top: calc(var(--header-h) + 16px); }
      .scene-card { grid-area: scene; }
      .events-panel { grid-area: events; min-height: 0; }
      .evidence-panel { grid-area: evidence; }
      .diagnostics-panel { grid-column: 1 / -1; }
    }

    /* Cards */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
    }

    .card-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }

    .card-title svg {
      width: 16px;
      height: 16px;
      color: var(--muted);
    }

    .card-body {
      padding: 14px;
    }

    /* Viewport */
    .viewport-panel .card-body {
      padding: 0;
      aspect-ratio: 16 / 10;
      background: #000;
      position: relative;
    }

    .viewport-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      cursor: crosshair;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }

    .viewport-placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 24px;
      color: var(--muted);
      gap: 8px;
    }

    .viewport-placeholder svg {
      width: 48px;
      height: 48px;
      color: var(--surface-2);
      margin-bottom: 8px;
    }

    .viewport-placeholder h3 {
      margin: 0;
      font-size: 1rem;
      color: var(--text);
      font-weight: 600;
    }

    .viewport-placeholder p {
      margin: 0;
      font-size: 0.85rem;
      max-width: 320px;
      line-height: 1.55;
    }

    .viewport-overlay {
      position: absolute;
      bottom: 10px;
      left: 10px;
      right: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      pointer-events: none;
    }

    .viewport-overlay .meta-pill {
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 500;
      font-family: "Fira Code", monospace;
      backdrop-filter: blur(4px);
    }

    .viewport-actions {
      position: absolute;
      top: 10px;
      right: 10px;
      display: flex;
      gap: 8px;
    }

    /* Scene card */
    .scene-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .scene-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .scene-label {
      font-size: 0.75rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-weight: 500;
    }

    .scene-value {
      font-size: 0.92rem;
      color: var(--text);
      font-weight: 500;
      word-break: break-word;
    }

    .scene-value.mono {
      font-size: 0.85rem;
    }

    .state-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .state-item {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 10px;
      text-align: center;
    }

    .state-item .value {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent);
      font-family: "Fira Code", monospace;
    }

    .state-item .label {
      font-size: 0.7rem;
      color: var(--muted);
      margin-top: 2px;
    }

    /* Events */
    .events-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 360px;
      overflow-y: auto;
    }

    .event-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      transition: border-color var(--transition), background var(--transition);
    }

    .event-item:hover {
      border-color: var(--border);
      background: rgba(71, 85, 105, 0.2);
    }

    .event-icon {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      color: var(--muted);
      flex-shrink: 0;
    }

    .event-icon svg {
      width: 16px;
      height: 16px;
    }

    .event-item.error .event-icon { color: var(--danger); background: var(--danger-dim); }
    .event-item.warning .event-icon { color: var(--warning); background: var(--warning-dim); }
    .event-item.success .event-icon { color: var(--accent); background: var(--accent-dim); }
    .event-item.info .event-icon { color: var(--info); background: var(--info-dim); }

    .event-content {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .event-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
    }

    .event-detail {
      font-size: 0.78rem;
      color: var(--muted);
      font-family: "Fira Code", monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .event-time {
      font-size: 0.7rem;
      color: var(--muted);
      flex-shrink: 0;
      margin-top: 2px;
    }

    .empty-state {
      color: var(--muted);
      font-size: 0.9rem;
      text-align: center;
      padding: 20px 0;
    }

    /* Evidence */
    .evidence-scroll {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 4px;
      scroll-snap-type: x mandatory;
    }

    .evidence-scroll::-webkit-scrollbar { height: 6px; }
    .evidence-scroll::-webkit-scrollbar-track { background: var(--bg); border-radius: 3px; }
    .evidence-scroll::-webkit-scrollbar-thumb { background: var(--surface-2); border-radius: 3px; }

    .evidence-card {
      flex: 0 0 auto;
      width: 140px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
      cursor: pointer;
      scroll-snap-align: start;
      transition: border-color var(--transition), transform var(--transition);
    }

    .evidence-card:hover, .evidence-card:focus-visible {
      border-color: var(--accent);
      transform: translateY(-2px);
      outline: none;
    }

    .evidence-card img {
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: cover;
      display: block;
      background: #000;
    }

    .evidence-card .caption {
      padding: 8px;
      font-size: 0.72rem;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: "Fira Code", monospace;
    }

    /* Diagnostics */
    .diagnostics-body {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }

    @media (min-width: 640px) {
      .diagnostics-body { grid-template-columns: 1fr 1fr; }
    }

    .diag-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }

    .diag-key {
      font-size: 0.78rem;
      color: var(--muted);
    }

    .diag-value {
      font-size: 0.85rem;
      color: var(--text);
      font-weight: 500;
      font-family: "Fira Code", monospace;
      text-align: right;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 60%;
    }

    /* Action bar */
    .action-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      height: var(--action-bar-h);
      padding: 0 16px;
      background: rgba(15, 23, 42, 0.98);
      backdrop-filter: blur(10px);
      border-top: 1px solid var(--border);
    }

    @media (min-width: 1024px) {
      .action-bar {
        position: sticky;
        bottom: 0;
        border-top: none;
        border-bottom: 1px solid var(--border);
        margin-top: auto;
      }
    }

    .action-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 44px;
      padding: 0 16px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: border-color var(--transition), background var(--transition), color var(--transition);
    }

    .btn:hover, .btn:focus-visible {
      border-color: var(--accent);
      background: var(--surface-2);
      outline: none;
    }

    .btn.danger:hover, .btn.danger:focus-visible {
      border-color: var(--danger);
      background: var(--danger-dim);
    }

    .btn svg {
      width: 16px;
      height: 16px;
    }

    /* Toggle */
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text);
      min-height: 44px;
    }

    .toggle input {
      appearance: none;
      width: 44px;
      height: 24px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 999px;
      position: relative;
      outline: none;
      cursor: pointer;
      transition: background var(--transition), border-color var(--transition);
    }

    .toggle input::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      background: var(--text);
      border-radius: 50%;
      transition: transform var(--transition);
    }

    .toggle input:checked {
      background: var(--accent-dim);
      border-color: var(--accent);
    }

    .toggle input:checked::after {
      transform: translateX(20px);
      background: var(--accent);
    }

    .toggle input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Toast */
    .error-toast {
      position: fixed;
      bottom: calc(var(--action-bar-h) + 16px);
      left: 16px;
      right: 16px;
      z-index: 100;
      background: var(--danger-dim);
      color: var(--danger);
      border: 1px solid rgba(239, 68, 68, 0.3);
      padding: 12px 16px;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--transition);
      text-align: center;
    }

    @media (min-width: 640px) {
      .error-toast {
        left: auto;
        right: 16px;
        max-width: 360px;
      }
    }

    .error-toast.show { opacity: 1; pointer-events: auto; }

    /* Connection error banner */
    .conn-error-banner {
      display: none;
      padding: 10px 16px;
      background: var(--danger-dim);
      color: var(--danger);
      border-bottom: 1px solid rgba(239, 68, 68, 0.25);
      font-size: 0.85rem;
      text-align: center;
    }

    .conn-error-banner.show { display: block; }

    /* Utils */
    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hide-sm { display: none; }
    @media (min-width: 640px) {
      .hide-sm { display: inline; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="status-header">
      <div class="brand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent);">
          <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
          <path d="M2 17l10 5 10-5"></path>
          <path d="M2 12l10 5 10-5"></path>
        </svg>
        <span>Game Agent Harness</span>
      </div>
      <div class="status-pills">
        <span id="trace-pill" class="pill">No trace</span>
        <span id="pause-pill" class="pill" style="display:none;">Paused</span>
        <span id="engine-pill" class="pill offline"><span class="dot"></span><span id="engine-pill-text">No engine</span></span>
      </div>
      <button id="reconnect-btn" class="reconnect-btn" style="display:none;" aria-label="Reconnect">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
          <path d="M16 21h5v-5"></path>
        </svg>
        Reconnect
      </button>
    </header>

    <div id="conn-error" class="conn-error-banner"></div>

    <main>
      <section class="card viewport-panel">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            Live Viewport
          </div>
        </div>
        <div class="card-body">
          <div id="live-placeholder" class="viewport-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <h3>No live frame yet</h3>
            <p>Enable the Game Agent Harness plugin in Godot, set intake URL to <b id="intake-url-hint">ws://127.0.0.1:8765</b>, turn on <b>Runtime</b> capture, and run a scene.</p>
          </div>
          <img id="live-img" class="viewport-img" alt="Live viewport" style="display:none;">
          <div id="capture-paused" class="viewport-placeholder" style="display:none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="10" y1="15" x2="10" y2="9"></line>
              <line x1="14" y1="15" x2="14" y2="9"></line>
            </svg>
            <h3>Capture paused</h3>
            <p>Turn on Runtime capture to stream, or tap Snapshot to capture one frame.</p>
          </div>
          <div id="live-overlay" class="viewport-overlay" style="display:none;"></div>
        </div>
      </section>

      <section class="card scene-card">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
            Scene & State
          </div>
          <span id="ctx-runtime" class="pill offline">Stopped</span>
        </div>
        <div class="card-body">
          <div class="scene-grid">
            <div class="scene-row">
              <span class="scene-label">Project</span>
              <span id="ctx-project" class="scene-value">-</span>
            </div>
            <div class="scene-row">
              <span class="scene-label">Scene</span>
              <span id="ctx-scene" class="scene-value mono">-</span>
            </div>
            <div class="scene-row">
              <span class="scene-label">Engine</span>
              <span id="ctx-engine" class="scene-value">-</span>
            </div>
          </div>
          <div id="state-grid" class="state-grid"></div>
        </div>
      </section>

      <section class="card events-panel">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
            </svg>
            Event Stream
          </div>
          <span id="events-count" class="pill">0</span>
        </div>
        <div class="card-body">
          <ul id="events-list" class="events-list">
            <li class="empty-state">No events yet.</li>
          </ul>
        </div>
      </section>

      <section class="card evidence-panel">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            Evidence
          </div>
          <span id="evidence-count" class="pill">0</span>
        </div>
        <div class="card-body">
          <div id="evidence-scroll" class="evidence-scroll">
            <div class="empty-state">No screenshots yet.</div>
          </div>
        </div>
      </section>

      <section class="card diagnostics-panel">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
            </svg>
            Connection Diagnostics
          </div>
        </div>
        <div class="card-body diagnostics-body">
          <div class="diag-row">
            <span class="diag-key">Intake URL</span>
            <span id="diag-intake-url" class="diag-value">-</span>
          </div>
          <div class="diag-row">
            <span class="diag-key">Engine clients</span>
            <span id="diag-engine-clients" class="diag-value">0</span>
          </div>
          <div class="diag-row">
            <span class="diag-key">Last engine seen</span>
            <span id="diag-last-engine" class="diag-value">-</span>
          </div>
          <div class="diag-row">
            <span class="diag-key">Dashboard clients</span>
            <span id="diag-dashboard-clients" class="diag-value">0</span>
          </div>
          <div class="diag-row">
            <span class="diag-key">Latest frame</span>
            <span id="diag-latest-frame" class="diag-value">-</span>
          </div>
          <div class="diag-row">
            <span class="diag-key">WebSocket mode</span>
            <span id="diag-mode" class="diag-value">-</span>
          </div>
        </div>
      </section>
    </main>

    <nav class="action-bar">
      <div class="action-group">
        <label class="toggle">
          <input id="runtime-toggle" type="checkbox" checked>
          <span>Runtime</span>
        </label>
        <button id="pause-btn" class="btn" aria-label="Pause runtime">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
          <span class="hide-sm">Pause</span>
        </button>
      </div>
      <div class="action-group">
        <button id="snapshot-btn" class="btn" aria-label="Take snapshot">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="13" r="3"></circle>
            <path d="M20 21H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2z"></path>
          </svg>
          <span class="hide-sm">Snapshot</span>
        </button>
        <button id="clear-evidence-btn" class="btn danger" aria-label="Clear evidence">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          <span class="hide-sm">Clear</span>
        </button>
        <button id="reconnect-bottom-btn" class="btn" aria-label="Reconnect">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
            <path d="M3 3v5h5"></path>
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
            <path d="M16 21h5v-5"></path>
          </svg>
          <span class="hide-sm">Reconnect</span>
        </button>
      </div>
    </nav>

    <div id="error-toast" class="error-toast"></div>
  </div>

  <script>
    (function () {
      const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
      const apiBase = "/api";

      const els = {
        connError: document.getElementById("conn-error"),
        reconnectBtn: document.getElementById("reconnect-btn"),
        reconnectBottomBtn: document.getElementById("reconnect-bottom-btn"),
        tracePill: document.getElementById("trace-pill"),
        pausePill: document.getElementById("pause-pill"),
        enginePill: document.getElementById("engine-pill"),
        enginePillText: document.getElementById("engine-pill-text"),
        liveImg: document.getElementById("live-img"),
        livePlaceholder: document.getElementById("live-placeholder"),
        capturePaused: document.getElementById("capture-paused"),
        liveOverlay: document.getElementById("live-overlay"),
        runtimeToggle: document.getElementById("runtime-toggle"),
        pauseBtn: document.getElementById("pause-btn"),
        snapshotBtn: document.getElementById("snapshot-btn"),
        ctxProject: document.getElementById("ctx-project"),
        ctxEngine: document.getElementById("ctx-engine"),
        ctxScene: document.getElementById("ctx-scene"),
        ctxRuntime: document.getElementById("ctx-runtime"),
        stateGrid: document.getElementById("state-grid"),
        eventsList: document.getElementById("events-list"),
        eventsCount: document.getElementById("events-count"),
        evidenceScroll: document.getElementById("evidence-scroll"),
        evidenceCount: document.getElementById("evidence-count"),
        diagIntakeUrl: document.getElementById("diag-intake-url"),
        diagEngineClients: document.getElementById("diag-engine-clients"),
        diagLastEngine: document.getElementById("diag-last-engine"),
        diagDashboardClients: document.getElementById("diag-dashboard-clients"),
        diagLatestFrame: document.getElementById("diag-latest-frame"),
        diagMode: document.getElementById("diag-mode"),
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
        events: [],
        lastSeq: 0,
        latestStateSample: null,
        runtimeCaptureEnabled: true,
        paused: false,
        ws: null,
        eventSource: null,
        reconnectDelay: 2000,
        pingTimer: null,
        connectTimer: null,
      };

      function setOnline(online, mode) {
        state.connected = online;
        if (online) {
          els.connError.classList.remove("show");
          els.connError.textContent = "";
          els.reconnectBtn.style.display = "none";
          state.reconnectDelay = 2000;
        } else {
          if (!state.fallback) {
            els.reconnectBtn.style.display = "inline-flex";
          }
        }
        els.diagMode.textContent = mode === "fallback" ? "HTTP polling" : "WebSocket";
      }

      function setConnectionError(msg) {
        if (!state.connected) {
          els.connError.textContent = msg;
          els.connError.classList.add("show");
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

      function updateEnginePill(status) {
        const hasEngine = (status.engineClients ?? 0) > 0;
        els.enginePillText.textContent = hasEngine ? "Engine" : "No engine";
        els.enginePill.className = "pill " + (hasEngine ? "online" : "offline");
      }

      function updateTracePill(status) {
        if (status.traceId) {
          state.traceId = status.traceId;
          els.tracePill.textContent = (status.traceActive ? "Active: " : "Idle: ") + status.traceId.slice(0, 8);
          els.tracePill.className = "pill " + (status.traceActive ? "online" : "warn");
        } else {
          els.tracePill.textContent = "No trace";
          els.tracePill.className = "pill";
        }
      }

      function updateSceneCard(context) {
        if (!context) return;
        els.ctxProject.textContent = context.observed?.project?.name || context.profile?.project?.name || "-";
        els.ctxEngine.textContent = context.observed?.engine?.name || context.profile?.engine?.name || "-";
        els.ctxScene.textContent = context.scene || "-";
        const running = context.runtime?.running;
        els.ctxRuntime.textContent = running ? "Running" : "Stopped";
        els.ctxRuntime.className = "pill " + (running ? "online" : "offline");
        renderStateGrid();
      }

      function renderStateGrid() {
        const sample = state.latestStateSample;
        const scene = sample?.scene;
        const rootChildCount = sample?.rootChildCount;
        const currentSceneChildCount = sample?.currentSceneChildCount;
        const items = [];
        if (typeof rootChildCount === "number") {
          items.push({ label: "Root children", value: rootChildCount });
        }
        if (typeof currentSceneChildCount === "number") {
          items.push({ label: "Scene children", value: currentSceneChildCount });
        }
        if (scene?.name) {
          items.push({ label: "Root", value: scene.name });
        }
        if (items.length === 0) {
          els.stateGrid.innerHTML = "";
          return;
        }
        els.stateGrid.innerHTML = items.map((it) => '<div class="state-item"><div class="value">' + it.value + '</div><div class="label">' + it.label + '</div></div>').join("");
      }

      function eventIconSvg(type) {
        const icons = {
          scene: '<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline>',
          input: '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
          key: '<path d="M6 9a6 6 0 0 1 12 0v8A6 6 0 0 1 6 17"></path><line x1="12" y1="19" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line>',
          state: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
          runtime: '<polygon points="5 3 19 12 5 21 5 3"></polygon>',
          evidence: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>',
          validation: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
          error: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>',
        };
        let key = "state";
        if (type.startsWith("scene.")) key = "scene";
        else if (type.startsWith("input.")) key = "input";
        else if (type.startsWith("input.action")) key = "key";
        else if (type.startsWith("state.")) key = "state";
        else if (type.startsWith("runtime.")) key = "runtime";
        else if (type.startsWith("evidence.")) key = "evidence";
        else if (type.startsWith("validation")) key = "validation";
        else if (type.includes("error")) key = "error";
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icons[key] + '</svg>';
      }

      function eventItemClass(type) {
        if (type.includes("error")) return "error";
        if (type.startsWith("validation") && type.includes("fail")) return "error";
        if (type.startsWith("validation")) return "success";
        if (type.startsWith("evidence.")) return "info";
        if (type.startsWith("input.")) return "warning";
        return "";
      }

      function formatEventDetail(event) {
        if (event.type.startsWith("input.pointer")) {
          return "x:" + (event.data?.x ?? "?") + " y:" + (event.data?.y ?? "?");
        }
        if (event.type.startsWith("input.action")) {
          return "key:" + (event.data?.keycode ?? "?");
        }
        if (event.type === "scene.changed") {
          return event.data?.scenePath || event.data?.scenePath || "-";
        }
        if (event.type === "state.sampled") {
          const d = event.data || {};
          return "root:" + (d.rootChildCount ?? "?") + " scene:" + (d.currentSceneChildCount ?? "?");
        }
        if (event.type.startsWith("evidence.")) {
          return event.data?.path || "-";
        }
        if (event.type.startsWith("validation")) {
          return event.data?.message || event.data?.name || event.type;
        }
        return JSON.stringify(event.data || {}).slice(0, 60);
      }

      function renderEvents() {
        const events = state.events;
        if (events.length === 0) {
          els.eventsList.innerHTML = '<li class="empty-state">No events yet.</li>';
          els.eventsCount.textContent = "0";
          return;
        }
        els.eventsCount.textContent = events.length;
        els.eventsList.innerHTML = events
          .slice()
          .reverse()
          .map((ev) => {
            const cls = eventItemClass(ev.type);
            return '<li class="event-item ' + cls + '"><div class="event-icon">' + eventIconSvg(ev.type) + '</div><div class="event-content"><div class="event-title">' + ev.type + '</div><div class="event-detail" title="' + formatEventDetail(ev).replace(/"/g, "&quot;") + '">' + formatEventDetail(ev) + '</div></div><div class="event-time">' + formatTime(ev.receivedAt) + '</div></li>';
          })
          .join("");
      }

      function addEvent(event) {
        state.events.push(event);
        if (state.events.length > 100) state.events.shift();
        if (event.seq > state.lastSeq) state.lastSeq = event.seq;
        renderEvents();
      }

      function renderEvidence() {
        if (state.evidence.length === 0) {
          els.evidenceScroll.innerHTML = '<div class="empty-state">No screenshots yet.</div>';
          els.evidenceCount.textContent = "0";
          return;
        }
        els.evidenceCount.textContent = state.evidence.length;
        els.evidenceScroll.innerHTML = state.evidence
          .slice()
          .reverse()
          .map((ev) => '<div class="evidence-card" tabindex="0" role="button" aria-label="Evidence ' + ev.seq + '"><img src="' + ev.url + '" alt="Evidence" loading="lazy"><div class="caption">#' + ev.seq + ' ' + ev.type.replace("evidence.", "") + ' ' + formatTime(ev.receivedAt) + '</div></div>')
          .join("");
      }

      function loadEvidence(traceId, since) {
        const s = since || 0;
        fetch(apiBase + "/traces/" + traceId + "/events?type=evidence.&limit=50&since=" + s)
          .then((res) => res.ok ? res.json() : { events: [] })
          .then((data) => {
            const images = (data.events || [])
              .filter((e) => e.type?.startsWith("evidence.") && e.data?.path)
              .map((e) => ({
                seq: e.seq,
                type: e.type,
                receivedAt: e.receivedAt,
                url: apiBase + "/traces/" + traceId + "/evidence/" + e.data.path,
              }));
            if (s === 0) state.evidence = images;
            else images.forEach((img) => state.evidence.push(img));
            if (state.evidence.length > 50) state.evidence = state.evidence.slice(-50);
            state.lastSeq = data.events?.length ? data.events[data.events.length - 1].seq : state.lastSeq;
            renderEvidence();
          })
          .catch((e) => showError("Could not load evidence: " + e.message));
      }

      function loadEvents(traceId) {
        fetch(apiBase + "/traces/" + traceId + "/events?limit=100")
          .then((res) => res.ok ? res.json() : { events: [] })
          .then((data) => {
            state.events = data.events || [];
            if (state.events.length > 0) {
              state.lastSeq = state.events[state.events.length - 1].seq;
            }
            const sample = state.events.slice().reverse().find((e) => e.type === "state.sampled");
            if (sample) state.latestStateSample = sample.data;
            renderEvents();
            renderStateGrid();
          })
          .catch((e) => showError("Could not load events: " + e.message));
      }

      function updateDiagnostics(status) {
        els.diagIntakeUrl.textContent = status.intakeUrl || "-";
        els.diagEngineClients.textContent = status.engineClients ?? 0;
        els.diagDashboardClients.textContent = status.dashboardClients ?? 0;
        els.diagLastEngine.textContent = status.latestFrame?.receivedAt ? formatTime(status.latestFrame.receivedAt) : "-";
        els.diagLatestFrame.textContent = status.latestFrame
          ? (status.latestFrame.width || "?") + "x" + (status.latestFrame.height || "?") + " " + (status.latestFrame.source || "")
          : "-";
        updateEnginePill(status);
      }

      async function fetchContext(traceId) {
        try {
          const res = await fetch(apiBase + "/traces/" + traceId + "/context");
          if (!res.ok) return;
          const { context } = await res.json();
          updateSceneCard(context);
        } catch (e) {
          // ignore
        }
      }

      async function fetchStatus() {
        try {
          const res = await fetch(apiBase + "/status");
          if (!res.ok) return;
          const status = await res.json();
          updateDiagnostics(status);
          updateTracePill(status);
          if (status.traceId) {
            if (!state.traceId) {
              state.traceId = status.traceId;
              loadEvidence(status.traceId);
              loadEvents(status.traceId);
            }
            fetchContext(status.traceId);
          }
        } catch (e) {
          // ignore polling errors
        }
      }

      function updateViewportVisibility() {
        if (state.runtimeCaptureEnabled) {
          els.capturePaused.style.display = "none";
          // liveImg stays as-is; next frame will show it
        } else {
          els.liveImg.style.display = "none";
          els.liveOverlay.style.display = "none";
          els.livePlaceholder.style.display = "none";
          els.capturePaused.style.display = "flex";
        }
      }

      function updatePauseUI() {
        const paused = state.paused;
        els.pausePill.style.display = paused ? "inline-flex" : "none";
        els.pausePill.className = "pill " + (paused ? "warn" : "");
        els.pausePill.textContent = paused ? "Paused" : "Pause";
        els.pauseBtn.classList.toggle("warn", paused);
        els.pauseBtn.querySelector("svg").innerHTML = paused
          ? '<polygon points="5 3 19 12 5 21 5 3"></polygon>'
          : '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
      }

      function handleFrame(frame) {
        if (!frame || !frame.seq) return;
        if (!state.runtimeCaptureEnabled) return;
        const url = apiBase + "/live/frame?t=" + Date.now();
        els.liveImg.src = url;
        els.liveImg.style.display = "";
        els.livePlaceholder.style.display = "none";
        els.capturePaused.style.display = "none";
        els.liveOverlay.style.display = "flex";
        els.liveOverlay.innerHTML = '<span class="meta-pill">#' + frame.seq + '</span><span class="meta-pill">' + (frame.source || "viewport") + '</span><span class="meta-pill">' + (frame.width || "?") + 'x' + (frame.height || "?") + '</span><span class="meta-pill">' + formatTime(frame.receivedAt) + '</span>';
      }

      function handleEvent(event) {
        if (event.type?.startsWith("evidence.") && event.data?.path && state.traceId) {
          state.evidence.push({
            seq: event.seq,
            type: event.type,
            receivedAt: event.receivedAt,
            url: apiBase + "/traces/" + state.traceId + "/evidence/" + event.data.path,
          });
          if (state.evidence.length > 50) state.evidence.shift();
          renderEvidence();
        }
        if (event.type === "state.sampled") {
          state.latestStateSample = event.data;
          renderStateGrid();
        }
        if (event.type === "runtime_capture.changed") {
          state.runtimeCaptureEnabled = Boolean(event.data?.enabled);
          els.runtimeToggle.checked = state.runtimeCaptureEnabled;
          updateViewportVisibility();
        }
        if (event.type === "pause.changed") {
          state.paused = Boolean(event.data?.enabled);
          updatePauseUI();
        }
        addEvent(event);
      }

      function handleMessage(data) {
        if (data.kind === "hello") {
          if (data.traceId) {
            state.traceId = data.traceId;
            loadEvidence(data.traceId);
            loadEvents(data.traceId);
            fetchStatus();
          }
        } else if (data.kind === "frame") {
          handleFrame(data);
        } else if (data.kind === "event") {
          handleEvent(data.event);
        } else if (data.kind === "context") {
          updateSceneCard(data.context);
        } else if (data.kind === "trace") {
          state.traceId = data.traceId;
          state.evidence = [];
          state.events = [];
          state.latestStateSample = null;
          state.lastSeq = 0;
          if (data.traceId) {
            loadEvidence(data.traceId);
            loadEvents(data.traceId);
            fetchStatus();
          } else {
            els.tracePill.textContent = "No trace";
            els.tracePill.className = "pill";
            renderEvents();
            renderEvidence();
            renderStateGrid();
          }
        }
      }

      function startSseFallback() {
        if (state.eventSource) return;
        state.fallback = true;
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
          setConnectionError("EventSource error. Retrying...");
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
          setOnline(true, "ws");
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
            setConnectionError("Connection lost. Retrying... (" + (event.reason || event.code || "unknown") + ")");
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

      function doReconnect() {
        state.reconnectDelay = 500;
        stopSseFallback();
        connect();
      }

      function getNormalizedPointerPos(event) {
        const rect = els.liveImg.getBoundingClientRect();
        let clientX, clientY;
        if (event.touches && event.touches.length > 0) {
          clientX = event.touches[0].clientX;
          clientY = event.touches[0].clientY;
        } else if (event.changedTouches && event.changedTouches.length > 0) {
          clientX = event.changedTouches[0].clientX;
          clientY = event.changedTouches[0].clientY;
        } else {
          clientX = event.clientX;
          clientY = event.clientY;
        }
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        return { x, y };
      }

      function sendPointer(phase, event) {
        if (els.liveImg.style.display === "none") return;
        const pos = getNormalizedPointerPos(event);
        sendControl({
          kind: "control",
          action: "input.pointer",
          phase: phase,
          x: pos.x,
          y: pos.y,
          button: event.button ?? 0,
          modifiers: {
            ctrl: event.ctrlKey || false,
            shift: event.shiftKey || false,
            alt: event.altKey || false,
            meta: event.metaKey || false,
          },
        });
        event.preventDefault();
      }

      els.liveImg.addEventListener("mousedown", (e) => sendPointer("pressed", e));
      els.liveImg.addEventListener("mouseup", (e) => sendPointer("released", e));
      els.liveImg.addEventListener("mousemove", (e) => {
        if (e.buttons > 0) sendPointer("moved", e);
      });
      els.liveImg.addEventListener("touchstart", (e) => sendPointer("pressed", e), { passive: false });
      els.liveImg.addEventListener("touchend", (e) => sendPointer("released", e), { passive: false });
      els.liveImg.addEventListener("touchmove", (e) => sendPointer("moved", e), { passive: false });

      els.reconnectBtn.addEventListener("click", doReconnect);
      els.reconnectBottomBtn.addEventListener("click", doReconnect);

      els.runtimeToggle.addEventListener("change", () => {
        state.runtimeCaptureEnabled = els.runtimeToggle.checked;
        updateViewportVisibility();
        sendControl({
          kind: "control",
          action: "runtime_capture",
          enabled: els.runtimeToggle.checked,
        });
      });

      els.pauseBtn.addEventListener("click", () => {
        const next = !state.paused;
        sendControl({
          kind: "control",
          action: "pause",
          enabled: next,
        });
      });

      els.snapshotBtn.addEventListener("click", () => {
        sendControl({
          kind: "control",
          action: "snapshot",
        });
      });

      els.clearEvidenceBtn.addEventListener("click", () => {
        state.evidence = [];
        renderEvidence();
      });

      async function pollLiveFrame() {
        try {
          if (!state.runtimeCaptureEnabled) return;
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
          els.capturePaused.style.display = "none";
        } catch (e) {
          // ignore polling errors
        }
      }

      updatePauseUI();
      updateViewportVisibility();
      connect();
      setInterval(fetchStatus, 2000);
      setInterval(pollLiveFrame, 2000);
    })();
  </script>
</body>
</html>`;
}
