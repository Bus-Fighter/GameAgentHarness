import net from "node:net";
import crypto from "node:crypto";
import { encodeTextFrame, decodeFrames } from "../host/websocket-codec.js";

export class EngineBridge {
  constructor({ harnessHost = null, host = "127.0.0.1", port = 8765 } = {}) {
    this.harnessHost = harnessHost;
    this.host = host;
    this.port = Number(port);
  }

  async isAvailable() {
    if (this.harnessHost) {
      return this.harnessHost.hasEngine();
    }
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setTimeout(500);
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  async cmd(domain, command, params = {}, { timeoutMs = 15000 } = {}) {
    if (this.harnessHost) {
      return this.harnessHost.sendEngineCommand(domain, command, params, { timeoutMs });
    }
    return this._cmdOverSocket(domain, command, params, timeoutMs);
  }

  _cmdOverSocket(domain, command, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const socket = net.createConnection({ host: this.host, port: this.port });
      const key = crypto.randomBytes(16).toString("base64");
      let handshaken = false;
      let buffer = Buffer.alloc(0);
      let settled = false;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.end();
        fn(value);
      };

      const timer = setTimeout(() => {
        finish(reject, new Error(`engine command ${domain}.${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.once("error", (error) => finish(reject, error));

      socket.on("connect", () => {
        socket.write(
          [
            "GET / HTTP/1.1",
            `Host: ${this.host}:${this.port}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${key}`,
            "Sec-WebSocket-Version: 13",
            "\r\n",
          ].join("\r\n"),
        );
      });

      socket.on("data", (chunk) => {
        if (!handshaken) {
          buffer = Buffer.concat([buffer, chunk]);
          const end = buffer.indexOf("\r\n\r\n");
          if (end === -1) return;
          const response = buffer.subarray(0, end + 4).toString("utf8");
          if (!response.includes("101 Switching Protocols")) {
            finish(reject, new Error("WebSocket handshake failed: " + response.split("\r\n")[0]));
            return;
          }
          handshaken = true;
          buffer = buffer.subarray(end + 4);
          socket.write(
            encodeTextFrame(
              JSON.stringify({ kind: "control", action: "cmd", id, domain, command, params, timeoutMs }),
              { masked: true },
            ),
          );
        } else {
          buffer = Buffer.concat([buffer, chunk]);
        }

        const decoded = decodeFrames(buffer);
        buffer = Buffer.from(decoded.remaining);
        for (const raw of decoded.messages) {
          if (raw === null) {
            finish(reject, new Error("connection closed by host"));
            return;
          }
          let message;
          try {
            message = JSON.parse(raw);
          } catch {
            continue;
          }
          if (message.kind === "control.result" && message.id === id) {
            if (message.ok) {
              finish(resolve, message.data ?? null);
            } else {
              finish(reject, new Error(message.error ?? "engine command failed"));
            }
            return;
          }
        }
      });
    });
  }
}
