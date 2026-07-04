export class FrameStore {
  constructor() {
    this.frames = new Map();
    this.latest = null;
  }

  setFrame({ buffer, contentType, source, width, height, seq, traceId, receivedAt } = {}) {
    const frame = {
      buffer,
      contentType: contentType ?? "image/png",
      source: source ?? "unknown",
      width,
      height,
      seq,
      traceId,
      receivedAt: receivedAt ?? new Date().toISOString(),
    };
    this.frames.set(frame.source, frame);
    this.latest = frame;
  }

  getFrame(source) {
    if (source) {
      return this.frames.get(source) ?? null;
    }
    return this.latest;
  }

  getPrimaryFrame() {
    const runtime = this.frames.get("runtime");
    const editor = this.frames.get("editor");
    return runtime ?? editor ?? null;
  }
}
