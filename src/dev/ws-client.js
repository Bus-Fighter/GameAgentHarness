import net from "node:net";
import crypto from "node:crypto";
import { encodeTextFrame } from "../host/websocket-codec.js";

export function sendWebSocketMessages({ host = "127.0.0.1", port = 8765, path = "/" }, messages) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const key = crypto.randomBytes(16).toString("base64");
    let handshaken = false;
    let buffer = Buffer.alloc(0);

    socket.once("error", reject);
    socket.on("connect", () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "\r\n",
      ].join("\r\n"));
    });

    socket.on("data", (chunk) => {
      if (handshaken) return;
      buffer = Buffer.concat([buffer, chunk]);
      const text = buffer.toString("utf8");
      const end = text.indexOf("\r\n\r\n");
      if (end === -1) return;

      handshaken = true;
      for (const message of messages) {
        socket.write(encodeTextFrame(JSON.stringify(message), { masked: true }));
      }
      setTimeout(() => socket.end(), 50);
    });

    socket.on("close", () => resolve());
  });
}
