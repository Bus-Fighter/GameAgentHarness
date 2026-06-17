import crypto from "node:crypto";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function buildHandshakeResponse(requestText) {
  const keyMatch = requestText.match(/Sec-WebSocket-Key:\s*(.+)\r\n/i);
  if (!keyMatch) {
    throw new Error("Missing Sec-WebSocket-Key");
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${keyMatch[1].trim()}${WS_MAGIC}`)
    .digest("base64");

  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ].join("\r\n");
}

export function encodeTextFrame(text, { masked = false } = {}) {
  const payload = Buffer.from(text, "utf8");
  const header = [];
  header.push(0x81);

  if (payload.length < 126) {
    header.push((masked ? 0x80 : 0) | payload.length);
  } else if (payload.length <= 0xffff) {
    header.push((masked ? 0x80 : 0) | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    throw new Error("Frame payload too large for this prototype");
  }

  if (!masked) {
    return Buffer.concat([Buffer.from(header), payload]);
  }

  const mask = crypto.randomBytes(4);
  const maskedPayload = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    maskedPayload[i] = payload[i] ^ mask[i % 4];
  }

  return Buffer.concat([Buffer.from(header), mask, maskedPayload]);
}

export function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte1 = buffer[offset];
    const byte2 = buffer[offset + 1];
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let length = byte2 & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      throw new Error("64-bit WebSocket frames are not supported in this prototype");
    }

    let mask = null;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    if (cursor + length > buffer.length) break;

    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    }

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    } else if (opcode === 0x8) {
      messages.push(null);
    }

    offset = cursor + length;
  }

  return { messages, remaining: buffer.subarray(offset) };
}
