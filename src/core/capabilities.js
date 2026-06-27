export function getCapabilities() {
  return {
    schemaVersion: 1,
    name: "Game Agent Harness",
    purpose: "Generic runtime evidence and validation framework for game-development agents.",
    surfaces: [
      {
        name: "host",
        status: "available",
        commands: ["harness host start", "harness dashboard start"],
        provides: ["local WebSocket intake", "trace session lifecycle", "artifact writing", "live dashboard"],
      },
      {
        name: "profiles",
        status: "available",
        commands: ["harness profile show --profile <file>"],
        provides: ["project identity", "engine identity", "important entities", "semantic event registry", "scenario routing"],
      },
      {
        name: "traces",
        status: "available",
        commands: ["harness trace list", "harness trace summarize latest", "harness trace inspect latest"],
        provides: ["timeline inspection", "stream filtering", "JSONL artifacts", "human summaries"],
      },
      {
        name: "context",
        status: "available",
        commands: ["harness context current latest"],
        provides: ["current scene", "runtime state", "selection", "latest snapshot", "semantic events", "errors", "validation status"],
      },
      {
        name: "validation",
        status: "available",
        commands: ["harness validate scenario --scenario <file>"],
        provides: ["trace-based assertions", "timeline order checks", "snapshot checks", "validation-result checks"],
      },
      {
        name: "engine adapters",
        status: "partial",
        commands: ["harness godot install-adapter --project <path>"],
        provides: ["Godot editor/runtime events"],
      },
      {
        name: "visual proof",
        status: "artifact-ready",
        commands: ["harness trace inspect latest --type evidence"],
        provides: ["evidence artifact references", "future screenshot/video hooks"],
      },
      {
        name: "viewer",
        status: "available",
        commands: ["harness viewer export latest --output /tmp/trace.html"],
        provides: ["static HTML trace report", "timeline table", "snapshot and validation view", "evidence links"],
      },
      {
        name: "MCP adapter",
        status: "planned",
        commands: [],
        provides: ["future wrapper over the same profile, trace, context, and validation APIs"],
      },
    ],
    safety: {
      defaultMode: "read-only observation",
      writes: ["trace artifacts", "summary.md", "explicit adapter install", "explicit dev fixture generation"],
      requiresHumanApproval: ["saving game scenes", "changing project settings", "running arbitrary engine scripts", "deleting artifacts"],
    },
  };
}

export function formatCapabilities(capabilities = getCapabilities()) {
  const lines = [
    `# ${capabilities.name} Capabilities`,
    "",
    capabilities.purpose,
    "",
    "## Surfaces",
    "",
  ];

  for (const surface of capabilities.surfaces) {
    lines.push(`- ${surface.name}: ${surface.status}`);
    if (surface.commands.length > 0) {
      lines.push(`  commands: ${surface.commands.join(", ")}`);
    }
    lines.push(`  provides: ${surface.provides.join(", ")}`);
  }

  lines.push("", "## Safety", "");
  lines.push(`- Default mode: ${capabilities.safety.defaultMode}`);
  lines.push(`- Writes: ${capabilities.safety.writes.join(", ")}`);
  lines.push(`- Approval boundary: ${capabilities.safety.requiresHumanApproval.join(", ")}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}
