import { opsErrorResult, gdEscape, normalizeNodePath } from "../util.js";
import { requireProjectPath } from "../path-utils.js";
import { resolveGodotPath } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";
import { HEADER, ff, validateVector3, clampParam } from "./navigation.js";

const NON_PERSIST = " Runtime effect only: changes do NOT persist to .tscn files (edit the scene file to persist).";

const PARTICLE_NODE_TYPES = ["GPUParticles2D", "GPUParticles3D"];
const EMISSION_SHAPES = ["point", "sphere", "box", "ring"];
export const PRESETS = ["fire", "smoke", "rain", "snow", "sparkle", "explosion"];

export const PRESET_CONFIGS = {
  fire: { amount: 40, lifetime: 1.5, gravity: { x: 0, y: -5, z: 0 }, spread: 30, explosiveness: 0.3, damping: 2 },
  smoke: { amount: 20, lifetime: 3, gravity: { x: 0, y: -1, z: 0 }, spread: 10, explosiveness: 0.1, damping: 3 },
  rain: { amount: 200, lifetime: 1, gravity: { x: 0, y: -20, z: 0 }, spread: 5, direction: { x: 0, y: -1, z: 0 } },
  snow: { amount: 60, lifetime: 4, gravity: { x: 0, y: -2, z: 0 }, spread: 180, randomness: 0.8 },
  sparkle: { amount: 30, lifetime: 0.5, gravity: { x: 0, y: 0, z: 0 }, spread: 180, explosiveness: 0.8 },
  explosion: { amount: 80, lifetime: 1, gravity: { x: 0, y: -3, z: 0 }, spread: 180, explosiveness: 1.0, one_shot: true },
};

export function validateVector2(v, label = "Vector2") {
  if (typeof v !== "object" || v === null) throw new Error(`${label} must be an object with x, y number fields`);
  for (const key of ["x", "y"]) {
    if (typeof v[key] !== "number" || !Number.isFinite(v[key])) throw new Error(`${label} field "${key}" must be a finite number`);
  }
  return { x: v.x, y: v.y };
}

export function genPresetLines(cfg) {
  let lines = "";
  lines += `\n\tnode.amount = ${cfg.amount}`;
  lines += `\n\tnode.lifetime = ${ff(cfg.lifetime)}`;
  lines += `\n\tnode.explosiveness = ${ff(cfg.explosiveness ?? 0)}`;
  lines += `\n\tnode.randomness = ${ff(cfg.randomness ?? 0)}`;
  if (cfg.one_shot) lines += `\n\tnode.one_shot = true`;
  lines += `\n\tvar mat = node.process_material`;
  lines += `\n\tif mat == null:`;
  lines += `\n\t\tmat = ParticleProcessMaterial.new()`;
  lines += `\n\t\tnode.process_material = mat`;
  if (cfg.gravity) lines += `\n\tmat.gravity = Vector3(${ff(cfg.gravity.x)}, ${ff(cfg.gravity.y)}, ${ff(cfg.gravity.z)})`;
  if (cfg.spread !== undefined) lines += `\n\tmat.spread = ${ff(cfg.spread)}`;
  if (cfg.damping !== undefined) lines += `\n\tmat.damping = Vector2(${ff(cfg.damping)}, ${ff(cfg.damping)})`;
  if (cfg.direction) lines += `\n\tmat.direction = Vector3(${ff(cfg.direction.x)}, ${ff(cfg.direction.y)}, ${ff(cfg.direction.z)})`;
  return lines;
}

export function genParticlesCreateScript(nodeType, nodeName, parentPath, position, presetLines) {
  const is3D = nodeType === "GPUParticles3D";
  let posLine = "";
  if (position) {
    posLine = is3D
      ? `\n\tnode.position = Vector3(${ff(position.x)}, ${ff(position.y)}, ${ff(position.z)})`
      : `\n\tnode.position = Vector2(${ff(position.x)}, ${ff(position.y)})`;
  }

  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar parent = _mcp_get_node("${gdEscape(parentPath)}")
\tif parent == null:
\t\t_mcp_output("error", "Parent node not found: ${gdEscape(parentPath)}")
\t\t_mcp_done()
\t\treturn
\tvar node = ${nodeType}.new()
\tnode.name = "${gdEscape(nodeName)}"${posLine}
\tparent.add_child(node)
\tnode.owner = parent.owner if parent.owner != null else parent${presetLines ?? ""}
\t_mcp_output("created", {"type": "${gdEscape(nodeType)}", "name": "${gdEscape(nodeName)}", "path": str(node.get_path()) if node.is_inside_tree() else "${gdEscape(nodeName)}"${presetLines ? ', "preset_applied": true' : ""}})
\t_mcp_done()
`;
}

export function genSetEmissionScript(nodePath, amount, emissionShape, emissionSphereRadius, emissionBoxExtents, direction, spread) {
  let lines = "";
  if (amount !== undefined) {
    lines += `\n\tnode.amount = ${amount}`;
  }
  if (emissionShape) {
    const shapeMap = {
      point: "ParticleProcessMaterial.EMISSION_SHAPE_POINT",
      sphere: "ParticleProcessMaterial.EMISSION_SHAPE_SPHERE",
      box: "ParticleProcessMaterial.EMISSION_SHAPE_BOX",
      ring: "ParticleProcessMaterial.EMISSION_SHAPE_RING",
    };
    lines += `\n\tvar mat = node.process_material`;
    lines += `\n\tif mat == null:`;
    lines += `\n\t\tmat = ParticleProcessMaterial.new()`;
    lines += `\n\t\tnode.process_material = mat`;
    lines += `\n\tmat.emission_shape = ${shapeMap[emissionShape]}`;
    if (emissionShape === "sphere" && emissionSphereRadius !== undefined) {
      lines += `\n\tmat.emission_sphere_radius = ${ff(emissionSphereRadius)}`;
    }
    if (emissionShape === "box" && emissionBoxExtents) {
      lines += `\n\tmat.emission_box_extents = Vector3(${ff(emissionBoxExtents.x)}, ${ff(emissionBoxExtents.y)}, ${ff(emissionBoxExtents.z)})`;
    }
  }
  if (direction) {
    lines += `\n\tvar mat_d = node.process_material`;
    lines += `\n\tif mat_d == null:`;
    lines += `\n\t\tmat_d = ParticleProcessMaterial.new()`;
    lines += `\n\t\tnode.process_material = mat_d`;
    lines += `\n\tmat_d.direction = Vector3(${ff(direction.x)}, ${ff(direction.y)}, ${ff(direction.z)})`;
  }
  if (spread !== undefined) {
    lines += `\n\tvar mat_s = node.process_material`;
    lines += `\n\tif mat_s == null:`;
    lines += `\n\t\tmat_s = ParticleProcessMaterial.new()`;
    lines += `\n\t\tnode.process_material = mat_s`;
    lines += `\n\tmat_s.spread = ${ff(spread)}`;
  }

  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not (node is GPUParticles2D or node is GPUParticles3D):
\t\t_mcp_output("error", "Node is not a GPUParticles type: " + node.get_class())
\t\t_mcp_done()
\t\treturn${lines}
\t_mcp_output("emission_set", {"node": "${gdEscape(nodePath)}"})
\t_mcp_done()
`;
}

export function genSetProcessScript(nodePath, gravity, speedScale, explosiveness, randomness, lifetime, damping) {
  let lines = "";
  if (gravity) {
    lines += `\n\tvar mat_g = node.process_material`;
    lines += `\n\tif mat_g == null:`;
    lines += `\n\t\tmat_g = ParticleProcessMaterial.new()`;
    lines += `\n\t\tnode.process_material = mat_g`;
    lines += `\n\tmat_g.gravity = Vector3(${ff(gravity.x)}, ${ff(gravity.y)}, ${ff(gravity.z)})`;
  }
  if (speedScale !== undefined) lines += `\n\tnode.speed_scale = ${ff(speedScale)}`;
  if (explosiveness !== undefined) lines += `\n\tnode.explosiveness = ${ff(explosiveness)}`;
  if (randomness !== undefined) lines += `\n\tnode.randomness = ${ff(randomness)}`;
  if (lifetime !== undefined) lines += `\n\tnode.lifetime = ${ff(lifetime)}`;
  if (damping !== undefined) {
    lines += `\n\tvar mat_d = node.process_material`;
    lines += `\n\tif mat_d == null:`;
    lines += `\n\t\tmat_d = ParticleProcessMaterial.new()`;
    lines += `\n\t\tnode.process_material = mat_d`;
    lines += `\n\tmat_d.damping = Vector2(${ff(damping)}, ${ff(damping)})`;
  }

  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not (node is GPUParticles2D or node is GPUParticles3D):
\t\t_mcp_output("error", "Node is not a GPUParticles type: " + node.get_class())
\t\t_mcp_done()
\t\treturn${lines}
\t_mcp_output("process_set", {"node": "${gdEscape(nodePath)}"})
\t_mcp_done()
`;
}

export function genLoadPresetScript(nodePath, preset) {
  const cfg = PRESET_CONFIGS[preset];
  if (!cfg) return "";
  const lines = genPresetLines(cfg);
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not (node is GPUParticles2D or node is GPUParticles3D):
\t\t_mcp_output("error", "Node is not a GPUParticles type: " + node.get_class())
\t\t_mcp_done()
\t\treturn${lines}
\t_mcp_output("preset_loaded", {"node": "${gdEscape(nodePath)}", "preset": "${gdEscape(preset)}"})
\t_mcp_done()
`;
}

export function genSetMaterialScript(nodePath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not (node is GPUParticles2D or node is GPUParticles3D):
\t\t_mcp_output("error", "Node is not a GPUParticles type: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\tvar mat = ParticleProcessMaterial.new()
\tnode.process_material = mat
\t_mcp_output("material_set", {"node": "${gdEscape(nodePath)}", "material_type": "ParticleProcessMaterial"})
\t_mcp_done()
`;
}

const VEC3_SCHEMA = { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, required: ["x", "y", "z"] };

export const tools = [
  {
    name: "particles_create",
    description: `Create a GPUParticles2D/GPUParticles3D node, optionally applying a preset effect in the same pass.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_type: { type: "string", enum: PARTICLE_NODE_TYPES, description: "Particle node type" },
        name: { type: "string", description: "Node name" },
        parent: { type: "string", description: "Parent node path (default: root)", default: "root" },
        position: { type: "object", description: "Position {x,y} for 2D or {x,y,z} for 3D", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        preset: { type: "string", enum: PRESETS, description: "Optional preset effect to apply immediately" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_type", "name"],
    },
  },
  {
    name: "particles_set_emission",
    description: `Set emission parameters (amount, shape, direction, spread) on a GPUParticles node.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Particles node path" },
        amount: { type: "number", description: "Particle amount (positive integer)" },
        emission_shape: { type: "string", enum: EMISSION_SHAPES, description: "Emission shape" },
        emission_sphere_radius: { type: "number", description: "Sphere emission radius (sphere shape)" },
        emission_box_extents: { ...VEC3_SCHEMA, description: "Box emission extents {x,y,z} (box shape)" },
        direction: { ...VEC3_SCHEMA, description: "Emission direction {x,y,z}" },
        spread: { type: "number", description: "Spread angle in degrees (0-180)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "particles_set_process",
    description: `Set process parameters (gravity, speed, explosiveness, randomness, lifetime, damping) on a GPUParticles node.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Particles node path" },
        gravity: { ...VEC3_SCHEMA, description: "Gravity {x,y,z}" },
        speed_scale: { type: "number", description: "Speed scale" },
        explosiveness: { type: "number", description: "Explosiveness (0-1)" },
        randomness: { type: "number", description: "Randomness (0-1)" },
        lifetime: { type: "number", description: "Particle lifetime in seconds" },
        damping: { type: "number", description: "Damping" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "particles_load_preset",
    description: `Apply a built-in preset effect (fire/smoke/rain/snow/sparkle/explosion) to a GPUParticles node.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Particles node path" },
        preset: { type: "string", enum: PRESETS, description: "Preset effect name" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path", "preset"],
    },
  },
  {
    name: "particles_set_material",
    description: `Assign a fresh ParticleProcessMaterial to a GPUParticles node.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Particles node path" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
];

async function runScript(script, args, ctx) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout: 30, trusted: true });
  return parseGdscriptResult(result, {
    mapError: (msg) => (msg.includes("not found") ? "NODE_NOT_FOUND" : "SCRIPT_EXEC_FAILED"),
  });
}

export async function handle(toolName, args, ctx) {
  try {
    switch (toolName) {
      case "particles_create": {
        const nodeType = String(args.node_type ?? "");
        if (!PARTICLE_NODE_TYPES.includes(nodeType)) {
          return opsErrorResult("INVALID_TYPE", `Invalid node_type "${nodeType}". Must be GPUParticles2D or GPUParticles3D`);
        }
        const nodeName = String(args.name ?? "");
        if (!nodeName) return opsErrorResult("INVALID_PARAMS", "name is required");
        const parentPath = normalizeNodePath(args.parent || "root");
        const is3D = nodeType === "GPUParticles3D";
        let position;
        if (args.position) {
          position = is3D ? validateVector3(args.position, "position") : validateVector2(args.position, "position");
        }
        let presetLines;
        if (args.preset !== undefined) {
          if (!PRESETS.includes(args.preset)) {
            return opsErrorResult("PRESET_NOT_FOUND", `Unknown preset "${args.preset}". Available: ${PRESETS.join(", ")}`);
          }
          presetLines = genPresetLines(PRESET_CONFIGS[args.preset]);
        }
        return runScript(genParticlesCreateScript(nodeType, nodeName, parentPath, position, presetLines), args, ctx);
      }
      case "particles_set_emission": {
        const nodePath = normalizeNodePath(args.node_path);
        const warnings = [];
        const amount = args.amount !== undefined ? Math.floor(clampParam(args.amount, 1, 100000, "amount", warnings) ?? 0) : undefined;
        const emissionShape = args.emission_shape;
        if (emissionShape !== undefined && !EMISSION_SHAPES.includes(emissionShape)) {
          return opsErrorResult("INVALID_PARAMS", `Invalid emission_shape "${emissionShape}". Must be one of: ${EMISSION_SHAPES.join(", ")}`);
        }
        const sphereRadius = args.emission_sphere_radius;
        if (sphereRadius !== undefined && (typeof sphereRadius !== "number" || sphereRadius < 0 || !Number.isFinite(sphereRadius))) {
          return opsErrorResult("INVALID_PARAMS", "emission_sphere_radius must be a non-negative finite number");
        }
        const boxExtents = args.emission_box_extents ? validateVector3(args.emission_box_extents, "emission_box_extents") : undefined;
        const direction = args.direction ? validateVector3(args.direction, "direction") : undefined;
        const spread = clampParam(args.spread, 0, 180, "spread", warnings);
        return runScript(genSetEmissionScript(nodePath, amount, emissionShape, sphereRadius, boxExtents, direction, spread), args, ctx);
      }
      case "particles_set_process": {
        const nodePath = normalizeNodePath(args.node_path);
        const gravity = args.gravity ? validateVector3(args.gravity, "gravity") : undefined;
        const speedScale = args.speed_scale;
        if (speedScale !== undefined && (typeof speedScale !== "number" || !Number.isFinite(speedScale))) {
          return opsErrorResult("INVALID_PARAMS", "speed_scale must be a finite number");
        }
        const warnings = [];
        const explosiveness = clampParam(args.explosiveness, 0, 1, "explosiveness", warnings);
        const randomness = clampParam(args.randomness, 0, 1, "randomness", warnings);
        const lifetime = args.lifetime;
        if (lifetime !== undefined && (typeof lifetime !== "number" || lifetime <= 0 || !Number.isFinite(lifetime))) {
          return opsErrorResult("INVALID_PARAMS", "lifetime must be a positive finite number");
        }
        const damping = args.damping;
        if (damping !== undefined && (typeof damping !== "number" || damping < 0 || !Number.isFinite(damping))) {
          return opsErrorResult("INVALID_PARAMS", "damping must be a non-negative finite number");
        }
        return runScript(genSetProcessScript(nodePath, gravity, speedScale, explosiveness, randomness, lifetime, damping), args, ctx);
      }
      case "particles_load_preset": {
        const nodePath = normalizeNodePath(args.node_path);
        const preset = String(args.preset ?? "");
        if (!PRESETS.includes(preset)) {
          return opsErrorResult("PRESET_NOT_FOUND", `Unknown preset "${preset}". Available: ${PRESETS.join(", ")}`);
        }
        return runScript(genLoadPresetScript(nodePath, preset), args, ctx);
      }
      case "particles_set_material": {
        const nodePath = normalizeNodePath(args.node_path);
        return runScript(genSetMaterialScript(nodePath), args, ctx);
      }
      default:
        return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
    }
  } catch (err) {
    const msg = err.message;
    if (msg.includes("Vector")) return opsErrorResult("INVALID_VECTOR", msg);
    if (msg.includes("project_path") || msg.includes("project.godot")) return opsErrorResult("INVALID_PATH", msg);
    return opsErrorResult("INVALID_PARAMS", msg);
  }
}
