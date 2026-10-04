/// <reference lib="webworker" />

import { analyzeRgba } from "./analyze";

type InMsg = {
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  prev: ArrayBuffer | null;
  prevW: number;
  prevH: number;
};

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<InMsg>) => {
  const { id, width, height, buffer, prev, prevW, prevH } = event.data;
  const previous = prev
    ? { gray: new Uint8Array(prev), width: prevW, height: prevH }
    : null;
  const analysis = analyzeRgba(new Uint8ClampedArray(buffer), width, height, previous);
  const gray = analysis.gray.buffer.slice(0);
  scope.postMessage(
    {
      id,
      laplacian: analysis.laplacian,
      difference: analysis.difference,
      cornersPerK: analysis.cornersPerK,
      gradient: analysis.gradient,
      gray,
      width,
      height,
    },
    [gray],
  );
};
