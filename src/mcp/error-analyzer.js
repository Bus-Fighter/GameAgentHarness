const ERROR_PATTERNS = [
  {
    test: (msg) => /Parameter "(\w+)" is null/.test(msg),
    type: "null_reference",
    suggestion: (msg) => {
      const match = msg.match(/Parameter "(\w+)" is null/);
      const param = match ? match[1] : "variable";
      return `Check that "${param}" is initialized before use. Use if ${param} != null: guard or assign a default value.`;
    },
  },
  {
    test: (msg) => /Invalid type in function/.test(msg),
    type: "type_error",
    suggestion: (msg) => {
      const match = msg.match(/Invalid type in function "(\w+)".*Expected.*Got (\w+)/s);
      if (match) return `Function "${match[1]}" received type "${match[2]}" but expected a different type. Check the argument types passed to this function.`;
      return "A type mismatch occurred. Verify that all arguments match the expected types for the function call.";
    },
  },
  {
    test: (msg) => /Parse Error/.test(msg),
    type: "parse_error",
    suggestion: (msg) => {
      const detail = msg.replace(/SCRIPT ERROR:\s*Parse Error:\s*/i, "").trim();
      return `Syntax error: ${detail}. Check for missing colons, incorrect indentation, or typos in the script.`;
    },
  },
  {
    test: (msg, opts) => {
      if (!opts?.autoloadNames?.length && !opts?.classNames?.length) return false;
      const identMatch = msg.match(/Identifier\s+"(\w+)"/);
      if (!identMatch) return false;
      const name = identMatch[1];
      return (opts.autoloadNames?.includes(name) === true) || (opts.classNames?.includes(name) === true);
    },
    type: "headless_limitation",
    suggestion: (msg) => {
      const identMatch = msg.match(/Identifier\s+"(\w+)"/);
      const name = identMatch ? identMatch[1] : "global identifier";
      return `"${name}" is an autoload singleton or global class_name not available in headless mode. This error only occurs during headless validation and works correctly at runtime. Safe to ignore.`;
    },
  },
  {
    test: (msg) => /Identifier "(\w+)" not found/.test(msg),
    type: "script_error",
    suggestion: (msg) => {
      const match = msg.match(/Identifier "(\w+)" not found/);
      const ident = match ? match[1] : "identifier";
      return `"${ident}" is not recognized. Check for typos, ensure the class/method is available, or verify the correct class_name/extends declaration.`;
    },
  },
  {
    test: (msg) => /too few arguments for function/i.test(msg),
    type: "script_error",
    suggestion: (msg) => {
      const match = msg.match(/function "(\w+)"/);
      const fn = match ? match[1] : "the function";
      return `Missing arguments for "${fn}". Check the function signature and provide all required parameters.`;
    },
  },
  {
    test: (msg) => /too many arguments for function/i.test(msg),
    type: "script_error",
    suggestion: (msg) => {
      const match = msg.match(/function "(\w+)"/);
      const fn = match ? match[1] : "the function";
      return `Too many arguments for "${fn}". Remove extra parameters or check the function signature.`;
    },
  },
  {
    test: (msg) => /Index out of bounds/.test(msg),
    type: "runtime_error",
    suggestion: () => "Array/Dictionary index out of bounds. Verify the index is within valid range: 0 <= index < size(). Add bounds checking before access.",
  },
  {
    test: (msg) => /File not found/.test(msg) || /can't open/.test(msg) || /Resource not found/.test(msg),
    type: "runtime_error",
    suggestion: (msg) => {
      const match = msg.match(/(?:File not found|can't open|Resource not found):\s*(.+)/i);
      const target = match ? match[1].trim() : "the resource";
      return `File/resource not found: ${target}. Check the path is correct and the file exists in the project.`;
    },
  },
  {
    test: (msg) => /texture_2d_get/.test(msg) && /null/.test(msg),
    type: "headless_limitation",
    suggestion: () => "SubViewport texture is null in headless mode. This is a known headless rendering limitation - the code works correctly on actual devices with a GPU. Safe to ignore when testing via run_and_verify.",
  },
  {
    test: (msg) => /Condition ".*p_canvas_item.*is true/.test(msg) || /Condition ".*p_viewport.*is true/.test(msg),
    type: "headless_limitation",
    suggestion: () => "Canvas/Viewport rendering assertion in headless mode. This is typically a headless-only issue caused by SubViewport or CanvasItem operations without a real rendering server. Safe to ignore on actual devices.",
  },
  {
    test: (msg) => /get_image\(\)/.test(msg) && /null/.test(msg),
    type: "headless_limitation",
    suggestion: () => "get_image() returned null, likely because SubViewport did not render in headless mode. Add a null check (if img == null: return) and test on a real device. This error does not occur with a GPU.",
  },
  {
    test: (msg) => /Condition ".*" is true/.test(msg),
    type: "runtime_error",
    suggestion: (msg) => {
      const match = msg.match(/Condition "(.+?)" is true/);
      const cond = match ? match[1] : "an internal condition";
      return `Internal assertion failed: ${cond}. This usually indicates invalid state or a bug in the logic leading to this call.`;
    },
  },
  {
    test: (msg) => /Stack trace/.test(msg) || /Traceback/.test(msg),
    type: "unknown",
    suggestion: () => "A stack trace was detected. Look at the preceding error messages for the root cause.",
  },
];

function parseLocation(lines, startIdx) {
  const result = {};
  for (let i = startIdx + 1; i < Math.min(startIdx + 3, lines.length); i += 1) {
    const line = lines[i].trim();

    const atMatch = line.match(/^(?:at|in):\s*(.+?)(?::(\d+))?$/);
    if (atMatch) {
      result.file = atMatch[1].trim();
      if (atMatch[2]) result.line = parseInt(atMatch[2], 10);
      break;
    }

    const atMatch2 = line.match(/^(?:at|in):\s*(.+?)\((\d+)\)$/);
    if (atMatch2) {
      result.file = atMatch2[1].trim();
      result.line = parseInt(atMatch2[2], 10);
      break;
    }

    if (!result.func) {
      const funcMatch = line.match(/in function ['"](\w+)['"]/);
      if (funcMatch) result.func = funcMatch[1];
    }

    if (line === "" || /^(SCRIPT ERROR|ERROR|WARNING):/.test(line)) break;
  }
  return result;
}

function classifyError(message, fallbackType, options) {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.type === "parse_error") continue;
    if (pattern.test(message, options)) {
      return { type: pattern.type, suggestion: pattern.suggestion(message) };
    }
  }
  return {
    type: fallbackType,
    suggestion: fallbackType === "script_error"
      ? "Review the script logic and ensure all variables and methods are correctly referenced."
      : "An engine error occurred. Check the Godot documentation for this error message.",
  };
}

export function analyzeOutput(output, options) {
  const errors = [];
  const warnings = [];
  const prints = [];
  const suggestions = [];

  let i = 0;
  while (i < output.length) {
    const trimmed = output[i].trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^SCRIPT ERROR:\s*Parse Error:/i.test(trimmed)) {
      const message = trimmed.replace(/^SCRIPT ERROR:\s*Parse Error:\s*/i, "").trim();
      const loc = parseLocation(output, i);
      const error = {
        type: "parse_error",
        message,
        file: loc.file,
        line: loc.line,
        function: loc.func,
        suggestion: `Syntax error: ${message}. Check for missing colons, incorrect indentation, or typos.`,
      };
      errors.push(error);
      suggestions.push(`[${loc.file || "unknown"}:${loc.line || "?"}] ${error.suggestion}`);
      i += 1;
      continue;
    }

    if (/^SCRIPT ERROR:/i.test(trimmed)) {
      const message = trimmed.replace(/^SCRIPT ERROR:\s*/i, "").trim();
      const loc = parseLocation(output, i);
      const { type, suggestion } = classifyError(message, "script_error", options);
      errors.push({ type, message, file: loc.file, line: loc.line, function: loc.func, suggestion });
      suggestions.push(`[${loc.file || "unknown"}:${loc.line || "?"}] ${suggestion}`);
      i += 1;
      continue;
    }

    if (/^ERROR:/i.test(trimmed)) {
      const message = trimmed.replace(/^ERROR:\s*/i, "").trim();
      const loc = parseLocation(output, i);
      const { type, suggestion } = classifyError(message, "runtime_error", options);
      errors.push({ type, message, file: loc.file, line: loc.line, function: loc.func, suggestion });
      suggestions.push(`[${loc.file || "unknown"}:${loc.line || "?"}] ${suggestion}`);
      i += 1;
      continue;
    }

    if (/^WARNING:/i.test(trimmed)) {
      const message = trimmed.replace(/^WARNING:\s*/i, "").trim();
      const loc = parseLocation(output, i);
      warnings.push({ message, file: loc.file, line: loc.line });
      i += 1;
      continue;
    }

    prints.push(trimmed);
    i += 1;
  }

  const uniqueSuggestions = [...new Set(suggestions)];
  const headlessLimitations = errors.filter((e) => e.type === "headless_limitation");
  const realErrors = errors.filter((e) => e.type !== "headless_limitation");
  const parts = [];
  if (realErrors.length > 0) parts.push(`${realErrors.length} error(s)`);
  if (headlessLimitations.length > 0) parts.push(`${headlessLimitations.length} headless limitation(s) (safe to ignore on real devices)`);
  if (warnings.length > 0) parts.push(`${warnings.length} warning(s)`);
  if (prints.length > 0) parts.push(`${prints.length} print line(s)`);

  const summary = parts.length > 0
    ? `Analysis complete: ${parts.join(", ")}.`
    : "No errors, warnings, or output found.";

  return {
    hasErrors: realErrors.length > 0,
    errors,
    warnings,
    prints,
    suggestions: uniqueSuggestions,
    summary,
  };
}
