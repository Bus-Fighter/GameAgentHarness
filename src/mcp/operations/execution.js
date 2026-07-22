import fs from "node:fs";
import path from "node:path";
import { textResult, errorResult, opsErrorResult } from "../util.js";
import { resolveGodotPath, spawnGodot, SCRIPTS_DIR, GodotProcessManager } from "../godot-process.js";
import { requireProjectPath } from "../path-utils.js";
import { launchEditor } from "../../core/editor-launcher.js";

const processManager = new GodotProcessManager();

export { processManager };

export const tools = [
  {
    name: "launch_editor",
    description: "Launch the Godot editor for a project.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "run_project",
    description: "Run a Godot project (windowed game process) and capture its stdout/stderr output.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
        extra_args: { type: "array", items: { type: "string" }, description: "Extra command-line arguments passed to Godot" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "stop_project",
    description: "Stop the currently running Godot project process.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_debug_output",
    description: "Get the captured stdout/stderr line buffer of the running (or last run) Godot project process.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "capture_screenshot",
    description: "Capture a screenshot of a Godot scene by running the project with the screenshot_capture.gd script. Experimental: headless rendering may not be available on all platforms (Windows headless returns null viewport textures).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene: { type: "string", description: "Scene file path (res://scenes/main.tscn). If omitted, captures the default scene." },
        output_path: { type: "string", description: "Output PNG path (absolute). Defaults to <project_path>/screenshot.png" },
        frame_delay: { type: "number", description: "Frames to wait before capture (default: 15)", default: 15 },
        viewport_width: { type: "number", description: "Viewport width in pixels (default: 1280)", default: 1280 },
        viewport_height: { type: "number", description: "Viewport height in pixels (default: 720)", default: 720 },
        wait_node: { type: "string", description: "Optional condition: node name or path (/root/...) that must exist before capturing" },
        wait_text: { type: "string", description: "Optional condition: substring that must appear in a Label/RichTextLabel before capturing" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "get_godot_version",
    description: "Get the installed Godot version string by running godot --version.",
    inputSchema: {
      type: "object",
      properties: {
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
    },
  },
];

async function captureScreenshot(args) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path);
  const scene = typeof args.scene === "string" && args.scene.trim() ? args.scene.trim() : "";
  const outputPath = typeof args.output_path === "string" && args.output_path.trim()
    ? path.resolve(args.output_path)
    : path.join(projectPath, "screenshot.png");
  const frameDelay = Number(args.frame_delay) || 15;
  const width = Number(args.viewport_width) || 1280;
  const height = Number(args.viewport_height) || 720;

  const scriptPath = path.join(SCRIPTS_DIR, "screenshot_capture.gd");
  if (!fs.existsSync(scriptPath)) {
    return errorResult(`Screenshot script not found at ${scriptPath}`);
  }

  const godotArgs = ["--path", projectPath, "--script", scriptPath];
  if (process.platform !== "win32") {
    godotArgs.unshift("--headless", "--rendering-driver", "opengl3");
  }
  godotArgs.push(outputPath);
  if (scene) godotArgs.push(scene);
  godotArgs.push(String(frameDelay), `${width}x${height}`);
  if (args.wait_node) godotArgs.push("--wait-node", String(args.wait_node));
  if (args.wait_text) godotArgs.push("--wait-text", String(args.wait_text));

  const result = await spawnGodot(godot, godotArgs, { timeoutMs: 30000 });

  if (fs.existsSync(outputPath)) {
    const size = fs.statSync(outputPath).size;
    let blankWarning = "";
    if (result.stdout.includes("BLANK_DETECTED") || size < 2048) {
      blankWarning = "\nWARNING: Screenshot may be blank (2D rendering limitation in headless mode).";
    }
    return textResult(
      `Screenshot saved to: ${outputPath}\n` +
      `File size: ${size} bytes\n` +
      `Viewport: ${width}x${height}\n` +
      `Frames waited: ${frameDelay}` +
      blankWarning,
    );
  }

  return textResult(
    `Screenshot failed (exit code ${result.exitCode}${result.timedOut ? ", timed out" : ""}).\n\n` +
    `Godot output:\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}\n\n` +
    "Note: Screenshot capture is experimental. Headless rendering may not be available on all systems.",
  );
}

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "launch_editor": {
      const projectPath = requireProjectPath(args);
      const godot = await resolveGodotPath(args.godot_path);
      const child = launchEditor({ godotBin: godot, projectRoot: projectPath });
      return textResult(`Godot editor launched for ${projectPath} (pid ${child.pid}).`);
    }

    case "run_project": {
      const projectPath = requireProjectPath(args);
      const godot = await resolveGodotPath(args.godot_path);
      const extraArgs = Array.isArray(args.extra_args) ? args.extra_args.map(String) : [];
      try {
        const info = (ctx.processManager ?? processManager).runProject(godot, projectPath, { extraArgs });
        return textResult(`Project started (pid ${info.pid}) for ${info.projectPath}. Use get_debug_output to read output and stop_project to stop it.`);
      } catch (err) {
        return errorResult(err.message);
      }
    }

    case "stop_project": {
      const result = await (ctx.processManager ?? processManager).stopProject();
      return textResult(result.stopped
        ? `Stopped Godot project process (pid ${result.pid}) for ${result.projectPath}.`
        : result.message);
    }

    case "get_debug_output": {
      const state = (ctx.processManager ?? processManager).getDebugOutput();
      const lines = state.lines.length > 0 ? state.lines.join("\n") : "(no output captured)";
      return textResult(
        `Running: ${state.running}\nProject: ${state.projectPath ?? "none"}\n--- Output ---\n${lines}`,
      );
    }

    case "capture_screenshot":
      return captureScreenshot(args);

    case "get_godot_version": {
      const godot = await resolveGodotPath(args.godot_path);
      const result = await spawnGodot(godot, ["--version"], { timeoutMs: 10000 });
      const version = (result.stdout || result.stderr).trim();
      if (!version) {
        return errorResult(`Failed to get Godot version (exit code ${result.exitCode}).`);
      }
      return textResult(version);
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
