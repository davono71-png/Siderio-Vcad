import { analyzeRgba, type Analysis } from "./analyze";

type WorkerResult = {
  id: number;
  laplacian: number;
  difference: number | null;
  cornersPerK: number;
  gradient: number;
  gray: ArrayBuffer;
  width: number;
  height: number;
};

/**
 * Runs the selector math off the main thread.
 * If the worker cannot start, the same functions run on a downscaled frame
 * inline — still cheap, but the worker is the preferred path.
 */
export class FrameAnalyzer {
  private worker: Worker | null = null;
  private pending: ((result: Analysis) => void) | null = null;
  private activeId = 0;
  private queue: Promise<void> = Promise.resolve();
  lastAccepted: { gray: Uint8Array; width: number; height: number } | null = null;

  constructor() {
    try {
      const worker = new Worker(new URL("./quality.worker.ts", import.meta.url));
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.id !== this.activeId) return;
        const done = this.pending;
        this.pending = null;
        if (!done) return;
        const data = event.data;
        done({
          laplacian: data.laplacian,
          difference: data.difference,
          cornersPerK: data.cornersPerK,
          gradient: data.gradient,
          gray: new Uint8Array(data.gray),
          width: data.width,
          height: data.height,
        });
      };
      worker.onerror = () => {
        this.worker = null;
        worker.terminate();
      };
      this.worker = worker;
    } catch {
      this.worker = null;
    }
  }

  analyze(frame: ImageData): Promise<Analysis> {
    const run = () => this.analyzeOne(frame);
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  remember(analysis: Analysis) {
    this.lastAccepted = {
      gray: analysis.gray,
      width: analysis.width,
      height: analysis.height,
    };
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
  }

  private analyzeOne(frame: ImageData): Promise<Analysis> {
    const previous = this.lastAccepted;
    const inline = () => analyzeRgba(frame.data, frame.width, frame.height, previous);
    const worker = this.worker;
    if (!worker) return Promise.resolve(inline());

    const id = ++this.activeId;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (analysis: Analysis) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.activeId === id) this.activeId += 1;
        this.pending = null;
        resolve(analysis);
      };
      const timeout = setTimeout(() => finish(inline()), 700);
      this.pending = (analysis) => finish(analysis);

      const pixels = new Uint8ClampedArray(frame.data);
      const prevCopy = previous ? previous.gray.slice().buffer : null;
      const transfer: Transferable[] = [pixels.buffer];
      if (prevCopy) transfer.push(prevCopy);
      try {
        worker.postMessage(
          {
            id,
            width: frame.width,
            height: frame.height,
            buffer: pixels.buffer,
            prev: prevCopy,
            prevW: previous?.width ?? 0,
            prevH: previous?.height ?? 0,
          },
          transfer,
        );
      } catch {
        clearTimeout(timeout);
        finish(inline());
      }
    });
  }
}
