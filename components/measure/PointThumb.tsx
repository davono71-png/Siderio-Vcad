"use client";

import { useState } from "react";
import type { NotablePoint, PhotoMeta } from "@/lib/data/types";

/**
 * A photo thumbnail with the notable points placed on it, so a wrong click
 * shows up in the list without opening the photo. The whole photo is shown
 * (contain, not cover) so no point falls outside the tile.
 */
export function PointThumb({
  photo,
  url,
  points,
  frame,
}: {
  photo: PhotoMeta;
  url: string;
  points: NotablePoint[];
  /** Width / height of the tile, fixed by its CSS class. */
  frame: number;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // Thumbs are upright, so their aspect is the oriented photo's aspect.
  const width = photo.orientedWidth || natural?.w || 0;
  const height = photo.orientedHeight || natural?.h || 0;
  const marks = points.flatMap((point) =>
    point.observations
      .filter((item) => item.photoId === photo.id)
      .map((item, index) => ({ key: `${point.id}-${index}`, label: point.label, x: item.x, y: item.y })),
  );

  let box: { left: number; top: number; width: number; height: number } | null = null;
  if (width > 0 && height > 0) {
    const aspect = width / height;
    box =
      aspect > frame
        ? { left: 0, width: 100, height: (frame / aspect) * 100, top: (100 - (frame / aspect) * 100) / 2 }
        : { top: 0, height: 100, width: (aspect / frame) * 100, left: (100 - (aspect / frame) * 100) / 2 };
  }

  return (
    <span className="point-thumb">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`Foto ${photo.sequence}`}
        onLoad={(event) =>
          setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })
        }
      />
      {box && marks.length ? (
        <span
          className="point-thumb-box"
          aria-hidden
          style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
        >
          {marks.map((mark) => (
            <span
              key={mark.key}
              className="point-thumb-mark"
              style={{ left: `${(mark.x / width) * 100}%`, top: `${(mark.y / height) * 100}%` }}
            >
              <i />
              <b>{mark.label}</b>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
