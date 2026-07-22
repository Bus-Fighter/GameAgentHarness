import { opsErrorResult, gdEscape, normalizeNodePath, CLASS_NAME_RE, BLOCKED_PROPS, textResult } from "../util.js";
import { requireProjectPath } from "../path-utils.js";
import { resolveGodotPath } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";
import { HEADER } from "./navigation.js";

const NON_PERSIST = " Runtime effect only: in-memory changes do NOT persist unless saved via material_write save.";

export const ALLOWED_MATERIAL_TYPES = ["ShaderMaterial", "StandardMaterial3D", "CanvasItemMaterial"];

export const SHADER_TEMPLATES = {
  dissolve: {
    description: "2D dissolve effect",
    uniforms: ["edge_color: Color", "edge_width: float", "progress: float"],
    code: `shader_type canvas_item;

uniform vec4 edge_color : source_color = vec4(1.0, 0.3, 0.0, 1.0);
uniform float edge_width : hint_range(0.0, 0.5) = 0.1;
uniform float progress : hint_range(0.0, 1.0) = 0.0;

void fragment() {
  vec4 color = texture(TEXTURE, UV);
  float threshold = progress;
  float edge = smoothstep(threshold - edge_width, threshold, UV.x);
  float dissolve = step(threshold, UV.x);
  if (dissolve < 0.01) discard;
  vec3 final_color = mix(edge_color.rgb, color.rgb, edge);
  COLOR = vec4(final_color, color.a * dissolve);
}`,
  },
  outline: {
    description: "2D outline effect",
    uniforms: ["outline_color: Color", "outline_width: float"],
    code: `shader_type canvas_item;

uniform vec4 outline_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float outline_width : hint_range(1.0, 10.0) = 2.0;

void fragment() {
  vec2 pixel_size = TEXTURE_PIXEL_SIZE * outline_width;
  vec4 color = texture(TEXTURE, UV);
  float alpha = 0.0;
  alpha = max(alpha, texture(TEXTURE, UV + vec2(pixel_size.x, 0.0)).a);
  alpha = max(alpha, texture(TEXTURE, UV - vec2(pixel_size.x, 0.0)).a);
  alpha = max(alpha, texture(TEXTURE, UV + vec2(0.0, pixel_size.y)).a);
  alpha = max(alpha, texture(TEXTURE, UV - vec2(0.0, pixel_size.y)).a);
  COLOR = mix(vec4(outline_color.rgb, alpha), color, color.a);
}`,
  },
  blur: {
    description: "2D blur effect",
    uniforms: ["blur_amount: float", "direction: vec2"],
    code: `shader_type canvas_item;

uniform float blur_amount : hint_range(0.0, 10.0) = 2.0;
uniform vec2 direction = vec2(1.0, 0.0);

void fragment() {
  vec4 color = vec4(0.0);
  vec2 pixel_size = TEXTURE_PIXEL_SIZE * direction * blur_amount;
  color += texture(TEXTURE, UV + pixel_size * -3.0) * 0.015625;
  color += texture(TEXTURE, UV + pixel_size * -2.0) * 0.09375;
  color += texture(TEXTURE, UV + pixel_size * -1.0) * 0.234375;
  color += texture(TEXTURE, UV) * 0.3125;
  color += texture(TEXTURE, UV + pixel_size * 1.0) * 0.234375;
  color += texture(TEXTURE, UV + pixel_size * 2.0) * 0.09375;
  color += texture(TEXTURE, UV + pixel_size * 3.0) * 0.015625;
  COLOR = color;
}`,
  },
  glow: {
    description: "2D glow effect",
    uniforms: ["glow_color: Color", "glow_intensity: float"],
    code: `shader_type canvas_item;

uniform vec4 glow_color : source_color = vec4(0.0, 0.5, 1.0, 1.0);
uniform float glow_intensity : hint_range(0.0, 5.0) = 1.5;

void fragment() {
  vec4 color = texture(TEXTURE, UV);
  float glow = 0.0;
  vec2 pixel_size = TEXTURE_PIXEL_SIZE;
  glow += texture(TEXTURE, UV + vec2(pixel_size.x, 0.0)).a;
  glow += texture(TEXTURE, UV - vec2(pixel_size.x, 0.0)).a;
  glow += texture(TEXTURE, UV + vec2(0.0, pixel_size.y)).a;
  glow += texture(TEXTURE, UV - vec2(0.0, pixel_size.y)).a;
  glow *= 0.25 * glow_intensity;
  vec3 final_color = color.rgb + glow_color.rgb * glow * (1.0 - color.a);
  COLOR = vec4(final_color, color.a + glow * 0.5);
}`,
  },
  water: {
    description: "3D water surface effect",
    uniforms: ["wave_speed: float", "wave_scale: float", "deep_color: Color", "shallow_color: Color"],
    code: `shader_type spatial;

uniform float wave_speed = 1.0;
uniform float wave_scale = 0.5;
uniform vec4 deep_color : source_color = vec4(0.0, 0.1, 0.4, 1.0);
uniform vec4 shallow_color : source_color = vec4(0.1, 0.4, 0.7, 0.8);

void vertex() {
  VERTEX.y += sin(VERTEX.x * wave_scale + TIME * wave_speed) * 0.2;
  VERTEX.y += cos(VERTEX.z * wave_scale + TIME * wave_speed * 0.8) * 0.15;
}

void fragment() {
  float depth = clamp(NORMAL.z, 0.0, 1.0);
  vec4 water_color = mix(shallow_color, deep_color, depth);
  ALBEDO = water_color.rgb;
  ALPHA = water_color.a;
  METALLIC = 0.1;
  ROUGHNESS = 0.2;
}`,
  },
  gradient_map: {
    description: "Color remap via gradient texture",
    uniforms: ["gradient_texture: Texture", "intensity: float"],
    code: `shader_type canvas_item;

uniform sampler2D gradient_texture : hint_default_white;
uniform float intensity : hint_range(0.0, 1.0) = 1.0;

void fragment() {
  vec4 color = texture(TEXTURE, UV);
  float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec4 mapped = texture(gradient_texture, vec2(luminance, 0.5));
  COLOR = vec4(mix(color.rgb, mapped.rgb, intensity), color.a);
}`,
  },
};

export function validateParamType(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) {
    const len = v.length;
    if (len !== 2 && len !== 3 && len !== 4) {
      throw new Error(`Invalid param type: array length ${len} not supported (expected 2=Vector2, 3=Vector3, 4=Color)`);
    }
    for (let i = 0; i < len; i++) {
      if (typeof v[i] !== "number") throw new Error(`Invalid param type: array element [${i}] must be a number, got ${typeof v[i]}`);
    }
    return "array";
  }
  throw new Error(`Invalid param type: ${typeof v} not supported`);
}

export function parseMaterialParam(value, forShader = false) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (forShader && value.startsWith("res://")) return `load("${gdEscape(value)}")`;
    return `"${gdEscape(value)}"`;
  }
  if (Array.isArray(value)) {
    const len = value.length;
    if (len === 2) return `Vector2(${Number(value[0])}, ${Number(value[1])})`;
    if (len === 3) return `Vector3(${Number(value[0])}, ${Number(value[1])}, ${Number(value[2])})`;
    if (len === 4) return `Color(${Number(value[0])}, ${Number(value[1])}, ${Number(value[2])}, ${Number(value[3])})`;
    throw new Error(`Invalid param type: array length ${len} not supported`);
  }
  throw new Error(`Invalid param type: ${typeof value} not supported type`);
}

const GD_FIND_MAT = `\tvar mat = node.get("material")
\tif mat == null and node.has_method("get_surface_override_material"):
\t\tmat = node.get_surface_override_material(__IDX__)
\tif mat == null:
\t\tvar _mesh = node.get("mesh")
\t\tif _mesh != null and _mesh.has_method("surface_get_material"):
\t\t\tmat = _mesh.surface_get_material(__IDX__)
\tif mat == null:
\t\t_mcp_output("error", "No material on node")
\t\t_mcp_done()
\t\treturn`;

export function genMaterialReadScript(nodePath, materialIndex) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${GD_FIND_MAT.replaceAll("__IDX__", String(materialIndex))}
\tvar info = {}
\tinfo["material_type"] = mat.get_class()
\tinfo["resource_path"] = mat.resource_path if mat.resource_path else ""
\tif mat is ShaderMaterial and mat.shader != null:
\t\tvar uniforms = []
\t\tfor u in mat.shader.get_shader_uniform_list():
\t\t\tvar entry = {}
\t\t\tentry["name"] = u["name"]
\t\t\tentry["type"] = u["type"]
\t\t\tentry["hint"] = u["hint"]
\t\t\tvar val = mat.get_shader_parameter(u["name"])
\t\t\tif val == null:
\t\t\t\tentry["value"] = null
\t\t\telif val is Color:
\t\t\t\tentry["value"] = [val.r, val.g, val.b, val.a]
\t\t\telif val is Vector2:
\t\t\t\tentry["value"] = [val.x, val.y]
\t\t\telif val is Vector3:
\t\t\t\tentry["value"] = [val.x, val.y, val.z]
\t\t\telse:
\t\t\t\tentry["value"] = val
\t\t\tuniforms.append(entry)
\t\tinfo["shader_uniforms"] = uniforms
\t\tinfo["shader_path"] = mat.shader.resource_path if mat.shader.resource_path else ""
\telse:
\t\tvar props = {}
\t\tfor p in mat.get_property_list():
\t\t\tif p["usage"] & PROPERTY_USAGE_STORAGE:
\t\t\t\tvar pname = p["name"]
\t\t\t\tif not pname.begins_with("resource_") and not pname.begins_with("shader/"):
\t\t\t\t\tvar val = mat.get(pname)
\t\t\t\t\tif val is Color:
\t\t\t\t\t\tprops[pname] = [val.r, val.g, val.b, val.a]
\t\t\t\t\telif val is Vector2:
\t\t\t\t\t\tprops[pname] = [val.x, val.y]
\t\t\t\t\telif val is Vector3:
\t\t\t\t\t\tprops[pname] = [val.x, val.y, val.z]
\t\t\t\t\telse:
\t\t\t\t\t\tprops[pname] = val
\t\tinfo["properties"] = props
\t_mcp_output("material_info", info)
\t_mcp_done()
`;
}

export function genMaterialSetParamsScript(nodePath, materialIndex, params) {
  const paramLines = Object.entries(params).map(([key, value]) => {
    const gdShaderValue = parseMaterialParam(value, true);
    const gdValue = parseMaterialParam(value, false);
    return `\tif is_shader:\n\t\tmat.set_shader_parameter("${gdEscape(key)}", ${gdShaderValue})\n\telse:\n\t\tmat.set("${gdEscape(key)}", ${gdValue})`;
  }).join("\n");
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${GD_FIND_MAT.replaceAll("__IDX__", String(materialIndex))}
\tvar is_shader = mat is ShaderMaterial
${paramLines}
\t_mcp_output("params_set", {"count": ${Object.keys(params).length}})
\t_mcp_done()
`;
}

export function genMaterialCreateScript(nodePath, materialType, shaderPath) {
  const shaderLine = materialType === "ShaderMaterial" && shaderPath
    ? `\n\tif ResourceLoader.exists("${gdEscape(shaderPath)}"):\n\t\tmat.shader = load("${gdEscape(shaderPath)}")\n\telse:\n\t\t_mcp_output("error", "Shader not found: ${gdEscape(shaderPath)}")\n\t\t_mcp_done()\n\t\treturn`
    : "";
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar mat = ${materialType}.new()${shaderLine}
\tnode.material = mat
\t_mcp_output("created", {"material_type": "${gdEscape(materialType)}", "node": "${gdEscape(nodePath)}"})
\t_mcp_done()
`;
}

export function genMaterialSaveScript(nodePath, materialIndex, resourcePath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${GD_FIND_MAT.replaceAll("__IDX__", String(materialIndex))}
\tvar dir = "${gdEscape(resourcePath)}".get_base_dir()
\tif not DirAccess.dir_exists_absolute(dir):
\t\tDirAccess.make_dir_recursive_absolute(dir)
\tvar err = ResourceSaver.save(mat, "${gdEscape(resourcePath)}")
\tif err != OK:
\t\t_mcp_output("error", "Failed to save resource: " + str(err))
\t\t_mcp_done()
\t\treturn
\t_mcp_output("saved", {"resource_path": "${gdEscape(resourcePath)}"})
\t_mcp_done()
`;
}

export function genShaderReadScript(nodePath, materialIndex) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${GD_FIND_MAT.replaceAll("__IDX__", String(materialIndex))}
\tif not mat is ShaderMaterial:
\t\t_mcp_output("error", "Not a ShaderMaterial")
\t\t_mcp_done()
\t\treturn
\tif mat.shader == null:
\t\t_mcp_output("error", "No shader assigned")
\t\t_mcp_done()
\t\treturn
\t_mcp_output("shader_code", mat.shader.code)
\t_mcp_done()
`;
}

export function genShaderWriteScript(nodePath, materialIndex, code) {
  const jsonCode = gdEscape(JSON.stringify(code));
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${GD_FIND_MAT.replaceAll("__IDX__", String(materialIndex))}
\tif not mat is ShaderMaterial:
\t\t_mcp_output("error", "Not a ShaderMaterial")
\t\t_mcp_done()
\t\treturn
\tmat.shader = mat.shader.duplicate()
\tvar _code_json: String = "${jsonCode}"
\tvar _parsed: Variant = JSON.parse_string(_code_json)
\tif _parsed == null:
\t\t_mcp_output("error", "Failed to parse shader code JSON")
\t\t_mcp_done()
\t\treturn
\tmat.shader.code = _parsed
\tawait process_frame
\tvar compile_ok = mat.shader != null and mat.shader.get_rid().is_valid()
\tvar errors = []
\tvar warnings = []
\tif not compile_ok:
\t\terrors.append({"line": 0, "message": "Shader resource allocation failed"})
\t_mcp_output("compile_result", {"compile_success": compile_ok, "errors": errors, "warnings": warnings, "verification_note": "compile_success only confirms shader resource allocation, NOT that the code compiles. Godot 4.x headless cannot verify shader compilation — always verify via screenshot or Godot error output."})
\t_mcp_done()
`;
}

export function genShaderApplyTemplateScript(nodePath, materialIndex, templateName) {
  const template = SHADER_TEMPLATES[templateName];
  if (!template) throw new Error(`Invalid template: ${templateName}`);
  const jsonCode = gdEscape(JSON.stringify(template.code));
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${GD_FIND_MAT.replaceAll("__IDX__", String(materialIndex))}
\tif not mat is ShaderMaterial:
\t\t_mcp_output("error", "Not a ShaderMaterial")
\t\t_mcp_done()
\t\treturn
\tmat.shader = mat.shader.duplicate()
\tvar _code_json: String = "${jsonCode}"
\tvar _parsed: Variant = JSON.parse_string(_code_json)
\tif _parsed == null:
\t\t_mcp_output("error", "Failed to parse shader code JSON")
\t\t_mcp_done()
\t\treturn
\tmat.shader.code = _parsed
\tawait process_frame
\tvar compile_ok = mat.shader != null and mat.shader.get_rid().is_valid()
\tvar errors = []
\tvar warnings = []
\tif not compile_ok:
\t\terrors.append({"line": 0, "message": "Shader resource allocation failed"})
\t_mcp_output("template_applied", {"template": "${gdEscape(templateName)}", "compile_success": compile_ok, "errors": errors, "warnings": warnings, "verification_note": "compile_success only confirms shader resource allocation, NOT that the code compiles. Verify via screenshot or Godot error output."})
\t_mcp_done()
`;
}

export const tools = [
  {
    name: "material_read",
    description: "Read material info (type, resource path, shader uniforms or stored properties) from a node's material.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Node path" },
        material_index: { type: "number", description: "Surface material index (default 0)", default: 0 },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "material_write",
    description: `Write material data. Actions: set_params (set properties / shader uniforms), create (create and attach a material), save (save material to a .tres resource).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        action: { type: "string", enum: ["set_params", "create", "save"], description: "Write operation" },
        node_path: { type: "string", description: "Node path" },
        material_index: { type: "number", description: "Surface material index (default 0)", default: 0 },
        params: { type: "object", description: "set_params: parameter key/value pairs (number/bool/string/null/[2,3,4] arrays)" },
        material_type: { type: "string", enum: ALLOWED_MATERIAL_TYPES, description: "create: material type" },
        shader_path: { type: "string", description: "create: res:// shader path for ShaderMaterial" },
        resource_path: { type: "string", description: "save: res:// target .tres path" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "action", "node_path"],
    },
  },
  {
    name: "shader_edit",
    description: `Edit shader code on a node's ShaderMaterial. Actions: read (get code), write (set code with compile diagnostics), apply_template (apply a built-in shader template), list_templates (no Godot needed).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        action: { type: "string", enum: ["read", "write", "apply_template", "list_templates"], description: "Shader operation" },
        node_path: { type: "string", description: "Node path (not needed for list_templates)" },
        material_index: { type: "number", description: "Surface material index (default 0)", default: 0 },
        code: { type: "string", description: "write: shader source code" },
        template_name: { type: "string", description: "apply_template: template name" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "action"],
    },
  },
];

function materialErrorMapper(msg) {
  if (msg.includes("Node not found")) return "MATERIAL_NOT_FOUND";
  if (msg.includes("No material")) return "MATERIAL_NOT_FOUND";
  if (msg.includes("Not a ShaderMaterial")) return "INVALID_MATERIAL_TYPE";
  if (msg.includes("Shader not found") || msg.includes("Material not found")) return "MATERIAL_NOT_FOUND";
  if (msg.includes("No shader assigned")) return "MATERIAL_NOT_FOUND";
  if (msg.includes("Failed to save")) return "RESOURCE_SAVE_FAILED";
  if (msg.includes("Invalid param type") || msg.includes("not supported type")) return "INVALID_PARAM_TYPE";
  return "SCRIPT_EXEC_FAILED";
}

function requireMaterialIndex(raw) {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw new Error("material_index must be a non-negative integer");
  }
  return raw;
}

function sanitizeResPath(raw, field) {
  if (!raw || typeof raw !== "string" || !raw.startsWith("res://")) {
    throw new Error(`${field} must be a string starting with res://`);
  }
  const decoded = decodeURIComponent(raw);
  if (decoded.includes("/../") || decoded.endsWith("/..") || decoded.includes("\\")) {
    throw new Error(`${field} contains path traversal: ${raw}`);
  }
  return decoded;
}

export async function handle(toolName, args, ctx) {
  try {
    switch (toolName) {
      case "material_read": {
        const projectPath = requireProjectPath(args);
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const nodePath = normalizeNodePath(args.node_path);
        const materialIndex = requireMaterialIndex(args.material_index);
        const result = await executeGdscript({ godotPath: godot, projectPath, code: genMaterialReadScript(nodePath, materialIndex), timeout: 30, trusted: true });
        return parseGdscriptResult(result, { mapError: materialErrorMapper });
      }
      case "material_write": {
        const projectPath = requireProjectPath(args);
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const action = String(args.action ?? "");
        const nodePath = normalizeNodePath(args.node_path);
        const materialIndex = requireMaterialIndex(args.material_index);
        let script;
        switch (action) {
          case "set_params": {
            const params = args.params;
            if (!params || typeof params !== "object" || Array.isArray(params)) {
              return opsErrorResult("INVALID_PARAM_TYPE", "params must be an object");
            }
            for (const [key, val] of Object.entries(params)) {
              if (BLOCKED_PROPS.has(key)) {
                return opsErrorResult("INVALID_PARAM_TYPE", `param "${key}" is blocked (security policy)`);
              }
              try { validateParamType(val); } catch (e) {
                return opsErrorResult("INVALID_PARAM_TYPE", `param "${key}": ${e.message}`);
              }
            }
            script = genMaterialSetParamsScript(nodePath, materialIndex, params);
            break;
          }
          case "create": {
            const materialType = String(args.material_type ?? "");
            if (!ALLOWED_MATERIAL_TYPES.includes(materialType) || !CLASS_NAME_RE.test(materialType)) {
              return opsErrorResult("INVALID_MATERIAL_TYPE", `material_type must be one of: ${ALLOWED_MATERIAL_TYPES.join(", ")}`);
            }
            const shaderPath = args.shader_path;
            if (shaderPath) {
              try { sanitizeResPath(shaderPath, "shader_path"); } catch {
                return opsErrorResult("INVALID_PATH", "shader_path contains path traversal");
              }
            }
            script = genMaterialCreateScript(nodePath, materialType, shaderPath);
            break;
          }
          case "save": {
            const resourcePath = sanitizeResPath(args.resource_path, "resource_path");
            script = genMaterialSaveScript(nodePath, materialIndex, resourcePath);
            break;
          }
          default:
            return opsErrorResult("INVALID_PARAMS", `Unknown action "${action}". Must be one of: set_params, create, save`);
        }
        const result = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout: 30, trusted: true });
        return parseGdscriptResult(result, { mapError: materialErrorMapper });
      }
      case "shader_edit": {
        const action = String(args.action ?? "");
        if (action === "list_templates") {
          const templates = Object.entries(SHADER_TEMPLATES).map(([n, t]) => ({
            name: n, description: t.description, uniforms: t.uniforms,
          }));
          return textResult(JSON.stringify({ success: true, templates }, null, 2));
        }
        const projectPath = requireProjectPath(args);
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const nodePath = normalizeNodePath(args.node_path);
        const materialIndex = requireMaterialIndex(args.material_index);
        let script;
        switch (action) {
          case "read":
            script = genShaderReadScript(nodePath, materialIndex);
            break;
          case "write": {
            if (args.code === undefined || args.code === null) {
              return opsErrorResult("INVALID_PARAMS", "code is required for write action");
            }
            script = genShaderWriteScript(nodePath, materialIndex, String(args.code));
            break;
          }
          case "apply_template": {
            const templateName = String(args.template_name ?? "");
            if (!SHADER_TEMPLATES[templateName]) {
              return opsErrorResult("INVALID_TEMPLATE", `Unknown template: ${templateName}. Available: ${Object.keys(SHADER_TEMPLATES).join(", ")}`);
            }
            script = genShaderApplyTemplateScript(nodePath, materialIndex, templateName);
            break;
          }
          default:
            return opsErrorResult("INVALID_PARAMS", `Unknown action "${action}". Must be one of: read, write, apply_template, list_templates`);
        }
        const result = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout: 30, trusted: true });
        return parseGdscriptResult(result, { mapError: materialErrorMapper });
      }
      default:
        return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
    }
  } catch (err) {
    const msg = err.message;
    if (msg.includes("Invalid param type")) return opsErrorResult("INVALID_PARAM_TYPE", msg);
    if (msg.includes("Invalid template")) return opsErrorResult("INVALID_TEMPLATE", msg);
    if (msg.includes("path traversal") || msg.includes("res://")) return opsErrorResult("INVALID_PATH", msg);
    return opsErrorResult("INVALID_PARAMS", msg);
  }
}
