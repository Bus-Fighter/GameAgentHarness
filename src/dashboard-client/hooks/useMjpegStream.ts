import { useEffect, useState } from "react";

const BOUNDARY = "--frame";
const BOUNDARY_WITH_PREFIX = "\r\n--frame";
const DOUBLE_CRLF = "\r\n\r\n";

export interface MjpegStreamState {
  url: string | null;
  failed: boolean;
}

export function useMjpegStream(enabled: boolean, url: string): MjpegStreamState {
  const [state, setState] = useState<MjpegStreamState>({ url: null, failed: false });

  useEffect(() => {
    if (!enabled) {
      setState({ url: null, failed: false });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let currentBlobUrl: string | null = null;
    const decoder = new TextDecoder("latin1");

    const release = () => {
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
      }
    };

    const updateFrame = (bytes: Uint8Array, contentType: string) => {
      if (cancelled) return;
      try {
        const blob = new Blob([bytes], { type: contentType || "image/jpeg" });
        const next = URL.createObjectURL(blob);
        release();
        currentBlobUrl = next;
        setState({ url: next, failed: false });
      } catch {
        setState({ url: null, failed: true });
      }
    };

    const parse = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.body) {
          throw new Error("response has no body");
        }
        const reader = response.body.getReader();
        let buffer = new Uint8Array(0);
        let text = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          const nextBuffer = new Uint8Array(buffer.length + value.length);
          nextBuffer.set(buffer);
          nextBuffer.set(value, buffer.length);
          buffer = nextBuffer;
          text += decoder.decode(value, { stream: true });

          while (true) {
            const start = text.startsWith(BOUNDARY) ? 0 : text.indexOf(BOUNDARY_WITH_PREFIX);
            if (start < 0) break;

            const headerStart = start === 0 ? BOUNDARY.length : start + 2 + BOUNDARY.length;
            const headerEnd = text.indexOf(DOUBLE_CRLF, headerStart);
            if (headerEnd < 0) break;

            const bodyStart = headerEnd + DOUBLE_CRLF.length;
            const nextBoundary = text.indexOf(BOUNDARY_WITH_PREFIX, bodyStart);
            if (nextBoundary < 0) break;

            const headers = text.slice(headerStart, headerEnd);
            const contentType = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || "image/jpeg";
            updateFrame(buffer.subarray(bodyStart, nextBoundary), contentType);

            buffer = buffer.slice(nextBoundary);
            text = text.slice(nextBoundary);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, failed: true }));
        }
      } finally {
        release();
        if (!cancelled) {
          setState((prev) => ({ ...prev, url: null }));
        }
      }
    };

    parse();
    return () => {
      cancelled = true;
      controller.abort();
      release();
      setState({ url: null, failed: false });
    };
  }, [enabled, url]);

  return state;
}
