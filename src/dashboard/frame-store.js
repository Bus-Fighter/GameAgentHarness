export class FrameStore {
  constructor() {
    this.latest = null;
  }

  setFrame({ buffer, contentType, source, width, height, seq, traceId, receivedAt } = {}) {
    this.latest = {
      buffer,
      contentType: contentType ?? "image/png",
      source,
      width,
      height,
      seq,
      traceId,
      receivedAt: receivedAt ?? new Date().toISOString(),
    };
  }

  getFrame() {
    return this.latest;
  }
}
