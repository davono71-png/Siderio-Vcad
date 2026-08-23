"use client";

export function EdgeTab({
  open,
  side,
  label,
  onClick,
}: {
  open: boolean;
  side: "left" | "right" | "bottom";
  label: string;
  onClick: () => void;
}) {
  const dir =
    side === "left"
      ? open
        ? "left"
        : "right"
      : side === "right"
        ? open
          ? "right"
          : "left"
        : open
          ? "down"
          : "up";

  return (
    <button
      type="button"
      className={`edge-tab ${side === "bottom" ? "edge-tab-h" : ""}`}
      onClick={onClick}
      aria-expanded={open}
      aria-label={open ? `Chiudi ${label}` : `Apri ${label}`}
      title={label}
    >
      <Chevron dir={dir} />
    </button>
  );
}

function Chevron({ dir }: { dir: "left" | "right" | "up" | "down" }) {
  const rotate =
    dir === "right" ? "0deg" : dir === "down" ? "90deg" : dir === "left" ? "180deg" : "-90deg";
  return (
    <svg
      className="dock-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: `rotate(${rotate})` }}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
