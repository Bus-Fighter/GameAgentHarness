import { randomBytes } from "node:crypto";

const RES_PROTOCOL = "res://";

const DANGEROUS_PATTERNS = [
  { pattern: /OS\.(execute|shell_open|kill|set_restart_on_exit|crash|create_process)\b/, label: "OS system command" },
  { pattern: /\bOS\s*\[/, label: "OS singleton indexed access (sandbox bypass)" },
  { pattern: /(?<![=!<>])=\s*OS\b(?!\s*\.)/, label: "OS singleton aliasing (sandbox bypass)" },
  { pattern: /DirAccess\.(remove_absolute|remove)\b/, label: "Directory removal" },
  { pattern: /FileAccess\.open\s*\([^;]*FileAccess\.(?:WRITE|READ_WRITE|READ_WRITE_APPEND)\b/, label: "File write access" },
  { pattern: /Engine\.(set_singleton|get_singleton)\b/, label: "Engine singleton access (sandbox bypass)" },
  { pattern: /\b(Engine|FileAccess|DirAccess|JavaScriptBridge)\s*\[/, label: "Singleton indexed access (sandbox bypass)" },
  { pattern: /JavaScriptBridge\.eval\b/, label: "JavaScript eval (web escape)" },
  { pattern: /\bstr2var\b/, label: "str2var (arbitrary deserialization)" },
  { pattern: /\bbytes2var\b/, label: "bytes2var (arbitrary deserialization)" },
  { pattern: /\bvar2str\b/, label: "var2str (serialization bypass)" },
  { pattern: /load\s*\(\s*"(?!res:\/\/)/, label: "load() with non-resource path" },
  { pattern: /ResourceLoader\.load\s*\(\s*["'](?!res:\/\/)/, label: "ResourceLoader.load with non-resource path" },
  { pattern: /Thread\.(new|start)\b/, label: "Thread creation" },
  { pattern: /Semaphore\.new\b/, label: "Semaphore creation" },
  { pattern: /Mutex\.new\b/, label: "Mutex creation" },
  { pattern: /\bClassDB\b/, label: "ClassDB reflection (sandbox bypass)" },
  { pattern: /\.call\s*\(\s*["']/, label: "Indirect call via .call(\"string\") (sandbox bypass)" },
  { pattern: /\.callv\s*\(\s*["']/, label: "Indirect call via .callv(\"string\") (sandbox bypass)" },
  { pattern: /Expression\b[\s\S]{0,500}?\.execute\b/, label: "Expression.execute (arbitrary code execution)" },
  { pattern: /\.get_script\b/, label: "get_script reflection (sandbox bypass)" },
];

const DANGEROUS_API_TOKENS = [
  "OS.execute", "OS.shell_open", "OS.kill", "OS.create_process",
  "DirAccess.remove", "DirAccess.remove_absolute",
  "JavaScriptBridge.eval",
  "str2var", "bytes2var", "var2str",
  "ClassDB", ".call(", ".callv(",
  "Engine.get_singleton",
  ".get_script", "ResourceLoader.load",
];

export function stripLiterals(code) {
  let result = "";
  let i = 0;
  const len = code.length;

  while (i < len) {
    const ch = code.charAt(i);

    if ((ch === '"' || ch === "'") && code.charAt(i + 1) === ch && code.charAt(i + 2) === ch) {
      const quote = ch;
      result += quote;
      i += 3;
      if (code.startsWith(RES_PROTOCOL, i)) {
        result += RES_PROTOCOL;
        i += RES_PROTOCOL.length;
      }
      while (i < len) {
        if (code.charAt(i) === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (code.charAt(i) === quote && code.charAt(i + 1) === quote && code.charAt(i + 2) === quote) {
          result += quote;
          i += 3;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      result += quote;
      i += 1;
      if (code.startsWith(RES_PROTOCOL, i)) {
        result += RES_PROTOCOL;
        i += RES_PROTOCOL.length;
      }
      while (i < len) {
        if (code.charAt(i) === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (code.charAt(i) === quote) {
          result += quote;
          i += 1;
          break;
        }
        if (code.charAt(i) === "\n") {
          result += "\n";
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === "#") {
      while (i < len && code.charAt(i) !== "\n") {
        i += 1;
      }
      continue;
    }

    result += ch;
    i += 1;
  }

  return result;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectStringConcatBypass(code) {
  const warnings = [];
  const stringContents = [];
  const stringLiteralRe = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let match;
  while ((match = stringLiteralRe.exec(code)) !== null) {
    const content = match[1] ?? match[2];
    if (content) stringContents.push(content);
  }

  const MAX_CONCAT_WINDOW = 8;
  for (let i = 0; i < stringContents.length; i += 1) {
    for (let j = i; j < Math.min(i + MAX_CONCAT_WINDOW, stringContents.length); j += 1) {
      const combined = stringContents.slice(i, j + 1).join("");
      for (const token of DANGEROUS_API_TOKENS) {
        const dotIdx = token.indexOf(".");
        const suffix = dotIdx >= 0 ? token.slice(dotIdx) : null;
        if (combined === token || (suffix !== null && combined === suffix)) {
          warnings.push(`[SANDBOX-P2] String concatenation bypass attempt: "${token}" built from parts`);
          break;
        }
      }
    }
  }

  if (/\bpreload\s*\(\s*(?!["']res:\/\/)/.test(code)) {
    warnings.push("[SANDBOX-P2] preload() with computed/dynamic path");
  }

  for (const token of DANGEROUS_API_TOKENS) {
    const dotIdx = token.indexOf(".");
    const suffix = dotIdx >= 0 ? token.slice(dotIdx) : null;
    const prefixPart = dotIdx >= 0 ? token.slice(0, dotIdx) : token;
    if (prefixPart && new RegExp(`["']${escapeRegExp(prefixPart)}%[sdi]["']`).test(code)) {
      warnings.push(`[SANDBOX-P2] % format string used to construct dangerous API: "${token}"`);
    }
    if (suffix && new RegExp(`["']${escapeRegExp(suffix)}["'].*%[sdi]`).test(code)) {
      warnings.push(`[SANDBOX-P2] % format string used to construct API suffix: "${suffix}"`);
    }
  }

  return warnings;
}

export function scanGdscriptSandbox(code) {
  if (process.env.GODOT_MCP_SANDBOX === "disabled" && process.env.GODOT_MCP_UNRESTRICTED === "true") {
    return [];
  }
  const warnings = [];
  const skeleton = stripLiterals(code);

  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(skeleton)) {
      warnings.push(`[SANDBOX] Potential dangerous operation detected: ${label}`);
    }
  }

  warnings.push(...detectStringConcatBypass(code));
  return warnings;
}

const TOKEN_TTL_MS = 60000;
const MAX_TOKENS = 100;
const pendingTokens = new Map();

export function createPendingToken(toolName, args) {
  const now = Date.now();
  for (const [key, pending] of pendingTokens) {
    if (now - pending.createdAt > TOKEN_TTL_MS) pendingTokens.delete(key);
  }
  if (pendingTokens.size >= MAX_TOKENS) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, pending] of pendingTokens) {
      if (pending.createdAt < oldestTime) {
        oldestTime = pending.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) pendingTokens.delete(oldestKey);
  }
  const token = randomBytes(18).toString("base64url");
  pendingTokens.set(token, { token, toolName, args, createdAt: now });
  return token;
}

export function consumeToken(token) {
  const pending = pendingTokens.get(token);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > TOKEN_TTL_MS) {
    pendingTokens.delete(token);
    return null;
  }
  pendingTokens.delete(token);
  return { toolName: pending.toolName, args: pending.args };
}

export function resetTokens() {
  pendingTokens.clear();
}

export function gateDestructive(toolName, args, execute) {
  const token = args.confirm_token;
  if (typeof token === "string" && token.length > 0) {
    const consumed = consumeToken(token);
    if (!consumed) {
      return {
        content: [{ type: "text", text: `Invalid or expired confirm_token. Call ${toolName} without confirm_token to receive a fresh token.` }],
        isError: true,
      };
    }
    return execute(consumed.args);
  }
  const fresh = createPendingToken(toolName, args);
  return {
    content: [{
      type: "text",
      text: `${toolName} is a destructive operation. To proceed, call ${toolName} again with the same arguments plus confirm_token="${fresh}" (expires in 60 seconds).`,
    }],
  };
}
