"use client";

export function GeometryToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm leading-snug">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>Geometria completa (tutte le superfici e oggetti)</span>
    </label>
  );
}
