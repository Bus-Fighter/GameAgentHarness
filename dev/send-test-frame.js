import net from "node:net";
import crypto from "node:crypto";
import { buildHandshakeResponse, decodeFrames, encodeTextFrame } from "../src/host/websocket-codec.js";

const host = process.argv[2] || "127.0.0.1";
const port = Number(process.argv[3] || 8765);

function parseWsUrl(url) {
  const match = url.match(/^ws:\/\/([^\/]+)(\/.*)?$/);
  if (!match) throw new Error(`Invalid ws URL: ${url}`);
  const hostPort = match[1];
  const [h, portStr] = hostPort.split(":");
  return { host: h, port: Number(portStr), path: match[2] || "/" };
}

function connectWebSocket(url) {
  const { host, port, path } = parseWsUrl(url);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n"),
      );

      let handshaken = false;
      let pending = Buffer.alloc(0);

      socket.on("data", (chunk) => {
        if (!handshaken) {
          pending = Buffer.concat([pending, chunk]);
          const end = pending.indexOf("\r\n\r\n");
          if (end === -1) return;
          const response = pending.subarray(0, end + 4).toString("utf8");
          if (!response.includes("101 Switching Protocols")) {
            reject(new Error("WebSocket handshake failed: " + response.split("\r\n")[0]));
            socket.destroy();
            return;
          }
          handshaken = true;
          pending = pending.subarray(end + 4);
          resolve(socket);
        } else {
          pending = Buffer.concat([pending, chunk]);
          const decoded = decodeFrames(pending);
          pending = Buffer.from(decoded.remaining);
          for (const msg of decoded.messages) {
            if (msg === null) {
              socket.end();
              return;
            }
            try {
              const parsed = JSON.parse(msg);
              console.log("[test-frame] host:", JSON.stringify(parsed));
            } catch {
              console.log("[test-frame] raw:", msg);
            }
          }
        }
      });

      socket.on("error", reject);
    });
  });
}

function buildPng(width, height) {
  const row = Buffer.alloc(width * 3 + 1);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = (x * 255) / width;
      row[2 + x * 3] = (y * 255) / height;
      row[3 + x * 3] = 128;
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat(rows);
}

async function main() {
  const url = `ws://${host}:${port}`;
  console.log(`[test-frame] connecting to ${url}`);
  const socket = await connectWebSocket(url);

  const width = 640;
  const height = 360;
  const raw = buildPng(width, height);

  const zlib = await import("node:zlib");
  const idat = zlib.deflateSync(raw, { level: 6 });

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return c ^ 0xffffffff;
  }

  const chunks = [];
  function writeChunk(type, data) {
    const typeBuf = Buffer.from(type);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc32(Buffer.concat([typeBuf, data])) >>> 0), 0);
    chunks.push(lenBuf, typeBuf, data, crcBuf);
  }

  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  writeChunk("IHDR", ihdr);
  writeChunk("IDAT", idat);
  writeChunk("IEND", Buffer.alloc(0));

  const png = Buffer.concat(chunks);

  socket.write(
    encodeTextFrame(
      JSON.stringify({
        kind: "frame",
        format: "png",
        data: png.toString("base64"),
        width,
        height,
        source: "test",
        persist: true,
      }),
    ),
  );

  console.log(`[test-frame] sent ${png.length} byte PNG frame`);

  setTimeout(() => {
    socket.end();
    process.exit(0);
  }, 1000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
