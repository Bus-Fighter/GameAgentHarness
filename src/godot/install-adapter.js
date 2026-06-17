import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function installGodotAdapter(projectPath) {
  if (!projectPath) {
    throw new Error("Missing --project <path>");
  }

  const absoluteProjectPath = path.resolve(projectPath);
  const projectFile = path.join(absoluteProjectPath, "project.godot");
  if (!fs.existsSync(projectFile)) {
    throw new Error(`Not a Godot project: ${absoluteProjectPath}`);
  }

  const source = path.join(rootDir, "adapters/godot/addons/game_agent_harness");
  const target = path.join(absoluteProjectPath, "addons/game_agent_harness");

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });

  return target;
}
