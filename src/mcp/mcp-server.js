import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { attachResourceHandlers } from "./resources.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));

export function createMcpServer({ dispatch, listTools, bridge = null, projectRoot = process.cwd(), traceDir = "traces", godotPath = null, profile = null, processManager = null } = {}) {
  if (typeof dispatch !== "function") throw new Error("createMcpServer: dispatch function required");
  if (typeof listTools !== "function") throw new Error("createMcpServer: listTools function required");

  const ctx = { godotPath, projectRoot, traceDir, profile, bridge, processManager };

  const server = new Server(
    { name: "game-agent-harness", version: PKG.version },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return dispatch(name, args ?? {}, ctx);
  });

  attachResourceHandlers(server, ctx);

  return server;
}

export async function serveStdio(options = {}) {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[harness] mcp server game-agent-harness@${PKG.version} listening on stdio`);
  return server;
}

export function createHttpHandler(options = {}) {
  const active = new Set();

  async function handle(req, res, body) {
    const server = createMcpServer(options);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    active.add(server);
    const cleanup = () => {
      if (!active.has(server)) return;
      active.delete(server);
      server.close().catch(() => {});
    };
    res.on("close", cleanup);
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      cleanup();
    } catch (error) {
      cleanup();
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: `MCP transport error: ${error.message}` }));
      }
    }
  }

  async function close() {
    const servers = [...active];
    active.clear();
    await Promise.all(servers.map((server) => server.close().catch(() => {})));
  }

  return { handle, close };
}
