import { findGodotProcesses, killGodotProcess } from "../process-scan.js";
import { gateDestructive } from "../guard.js";

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

export const tools = [
  {
    name: "find_godot_processes",
    description:
      "Find running Godot processes on this machine (editor and game), including processes NOT started by the harness. Returns pid, kind (editor|game), project path (from --path), executable and command line. Optionally filter to a project path.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Optional Godot project directory; only processes running this project are returned." },
      },
    },
  },
  {
    name: "kill_godot_process",
    description:
      "Kill a Godot process by pid (works for processes started outside the harness). Destructive: first call returns a confirm_token; call again with the same arguments plus confirm_token to proceed. Use find_godot_processes to discover pids.",
    inputSchema: {
      type: "object",
      properties: {
        pid: { type: "number", description: "Process ID to kill." },
        force: { type: "boolean", description: "Force kill (SIGKILL / taskkill /F). Default false (graceful SIGTERM / taskkill)." },
        confirm_token: { type: "string", description: "Confirmation token from a previous call." },
      },
      required: ["pid"],
    },
  },
];

export async function handle(toolName, args, ctx) {
  if (toolName === "find_godot_processes") {
    const projectRoot = typeof args.project_path === "string" && args.project_path ? args.project_path : null;
    try {
      const processes = await findGodotProcesses({ projectRoot });
      return textResult({ count: processes.length, processes });
    } catch (error) {
      return errorResult(`Failed to enumerate Godot processes: ${error.message}`);
    }
  }

  if (toolName === "kill_godot_process") {
    if (args.pid == null || !Number.isInteger(Number(args.pid)) || Number(args.pid) <= 0) {
      return errorResult("pid is required and must be a positive integer. Use find_godot_processes to discover pids.");
    }
    return gateDestructive(toolName, args, async (consumed) => {
      try {
        const result = await killGodotProcess(consumed.pid, { force: consumed.force === true });
        return textResult({ killed: true, ...result });
      } catch (error) {
        return errorResult(`Failed to kill pid ${consumed.pid}: ${error.message}`);
      }
    });
  }

  return null;
}
