"use client";

import { countBandSectors, pitchBand, SELECT, type CoverageSample, type PitchBand } from "@/lib/capture/select";

type Props = {
  shots: CoverageSample[];
  liveHeading: number | null;
};

const SECTORS = 24;

function polar(cx: number, cy: number, radius: number, deg: number) {
  const angle = ((deg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
}

function slice(cx: number, cy: number, inner: number, outer: number, start: number, end: number) {
  const large = end - start > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, outer, start);
  const [x1, y1] = polar(cx, cy, outer, end);
  const [x2, y2] = polar(cx, cy, inner, end);
  const [x3, y3] = polar(cx, cy, inner, start);
  return `M ${x0} ${y0} A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`;
}

/**
 * Direction coverage from accepted shots.
 * The rings are the stand-in for a live mesh: a later sparse cloud from the
 * server can sit in the same corner via ScanPreview's overlay slot.
 */
export function CoverageMap({ shots, liveHeading }: Props) {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    const sector = Math.floor(((shot.headingDeg % 360) + 360) % 360 / (360 / SECTORS)) % SECTORS;
    const band = pitchBand(shot.elevationDeg);
    const key = `${sector}:${band}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const bands: { id: PitchBand; inner: number; outer: number }[] = [
    { id: "giu", inner: 70, outer: 92 },
    { id: "orizzonte", inner: 46, outer: 68 },
    { id: "su", inner: 22, outer: 44 },
  ];

  const up = countBandSectors(shots, "su");
  const horizon = countBandSectors(shots, "orizzonte");
  const down = countBandSectors(shots, "giu");
  const caption =
    shots.length === 0
      ? "Su 30–45° al centro"
      : `Su ${up}/${SELECT.upSectorsNeeded} · Orizz. ${horizon} · Giù ${down}`;

  return (
    <div className="coverage-card">
      <svg viewBox="0 0 200 200" className="h-full w-full" role="img" aria-label="Mappa di copertura">
        <circle cx="100" cy="100" r="96" fill="rgba(14,14,14,0.72)" />
        {bands.map((band) =>
          Array.from({ length: SECTORS }, (_, sector) => {
            const count = counts.get(`${sector}:${band.id}`) ?? 0;
            const start = sector * (360 / SECTORS) + 0.8;
            const end = (sector + 1) * (360 / SECTORS) - 0.8;
            const fill = count === 0 ? "rgba(255,255,255,0.08)" : count === 1 ? "rgba(243,117,44,0.55)" : "#f3752c";
            return (
              <path
                key={`${band.id}-${sector}`}
                d={slice(100, 100, band.inner, band.outer, start, end)}
                fill={fill}
              />
            );
          }),
        )}
        <circle cx="100" cy="100" r="8" fill="#f3752c" />
        {liveHeading != null ? (
          <line
            x1="100"
            y1="100"
            x2={polar(100, 100, 96, liveHeading)[0]}
            y2={polar(100, 100, 96, liveHeading)[1]}
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : null}
        <text x="100" y="14" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">
          N
        </text>
      </svg>
      <p className="coverage-caption">{caption}</p>
    </div>
  );
}
