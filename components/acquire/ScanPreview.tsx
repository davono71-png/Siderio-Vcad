"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { CoverageSample } from "@/lib/capture/select";
import { CoverageMap } from "./CoverageMap";

export type FilmFrame = {
  id: string;
  url: string;
};

type Props = {
  shots: CoverageSample[];
  liveHeading: number | null;
  frames: FilmFrame[];
  /** Slot for a future server-side sparse cloud or mesh preview. */
  overlay?: ReactNode;
};

export function ScanPreview({ shots, liveHeading, frames, overlay }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    if (strip) strip.scrollLeft = strip.scrollWidth;
  }, [frames.length]);

  return (
    <>
      {overlay ? <div className="pointer-events-none absolute inset-0 z-10">{overlay}</div> : null}
      <div className="coverage-dock">
        <CoverageMap shots={shots} liveHeading={liveHeading} />
      </div>
      <div ref={stripRef} className="filmstrip" aria-label="Foto accettate">
        {frames.length === 0 ? (
          <p className="px-3 text-xs text-white/70">Le foto accettate compaiono qui</p>
        ) : (
          frames.map((frame, index) => (
            // Blob thumbnails are object URLs, not static assets.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={frame.id} src={frame.url} alt={`Foto ${index + 1}`} className="film-thumb" />
          ))
        )}
      </div>
    </>
  );
}
