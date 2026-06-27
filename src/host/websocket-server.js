import net from "node:net";
import { buildHandshakeResponse, decodeFrames, encodeTextFrame } from "./websocket-codec.js";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

export class WebSocketServer {
  constructor({ port = 8765, host = "127.0.0.1", maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE, onMessage, onConnection, onClose } = {}) {
    this.port = port;
    this.host = host;
    this.maxMessageSize = maxMessageSize;
    this.onMessage = onMessage;
    this.onConnection = onConnection;
    this.onClose = onClose;
    this.server = null;
    this.clients = new Set();
  }

  start() {
    this.server = net.createServer((socket) => this.handleSocket(socket));
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  stop() {
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    this.server?.close();
  }

  handleSocket(socket) {
    let handshaken = false;
    let pending = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      if (!handshaken) {
        if (pending.length + chunk.length > this.maxMessageSize) {
          socket.destroy();
          return;
        }
        pending = Buffer.concat([pending, chunk]);
        const requestText = pending.toString("utf8");
        const end = requestText.indexOf("\r\n\r\n");
        if (end === -1) {
          return;
        }

        try {
          socket.write(buildHandshakeResponse(requestText));
          handshaken = true;
          this.clients.add(socket);
          this.onConnection?.(socket);
          pending = pending.subarray(end + 4);
        } catch (err) {
          const isUpgrade = requestText.toLowerCase().includes("upgrade: websocket");
          const status = isUpgrade ? "400 Bad Request" : "426 Upgrade Required";
          const body = `${status}\n`;
          socket.write(
            `HTTP/1.1 ${status}\r\n` +
              "Content-Type: text/plain\r\n" +
              `Content-Length: ${Buffer.byteLength(body)}\r\n` +
              "Connection: close\r\n\r\n" +
              body
          );
          socket.end();
          pending = Buffer.alloc(0);
        }
      } else {
        if (pending.length + chunk.length > this.maxMessageSize) {
          socket.destroy();
          return;
        }
        pending = Buffer.concat([pending, chunk]);
      }

      if (pending.length > 0) {
        const decoded = decodeFrames(pending);
        pending = decoded.remaining;
        for (const message of decoded.messages) {
          if (message === null) {
            socket.end();
            return;
          }
          this.onMessage?.(socket, message);
        }
      }
    });

    socket.on("close", () => {
      this.clients.delete(socket);
      this.onClose?.(socket);
    });

    socket.on("error", () => {
      this.clients.delete(socket);
    });
  }

  send(socket, value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    socket.write(encodeTextFrame(text));
  }

  sendFrame(socket, frame) {
    socket.write(frame);
  }
}
