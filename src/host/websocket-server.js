import net from "node:net";
import { buildHandshakeResponse, decodeFrames, encodeTextFrame } from "./websocket-codec.js";

export class WebSocketServer {
  constructor({ port = 8765, host = "127.0.0.1", onMessage, onConnection, onClose } = {}) {
    this.port = port;
    this.host = host;
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
        pending = Buffer.concat([pending, chunk]);
        const requestText = pending.toString("utf8");
        const end = requestText.indexOf("\r\n\r\n");
        if (end === -1) {
          return;
        }

        socket.write(buildHandshakeResponse(requestText));
        handshaken = true;
        this.clients.add(socket);
        this.onConnection?.(socket);
        pending = pending.subarray(end + 4);
      } else {
        pending = Buffer.concat([pending, chunk]);
      }

      if (pending.length > 0) {
        const decoded = decodeFrames(pending);
        pending = Buffer.from(decoded.remaining);
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
}
