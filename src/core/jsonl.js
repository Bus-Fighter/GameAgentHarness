import fs from "node:fs";

export function appendJsonLine(filePath, value) {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return [];
  }

  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
