"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function Sheet({ title, onClose, children }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="max-h-[88dvh] w-full max-w-lg overflow-auto rounded-t-3xl bg-paper p-4 text-ink shadow-2xl sm:rounded-3xl"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="sheet-title" className="font-serif text-xl">
            {title}
          </h2>
          <button type="button" className="btn-secondary min-h-10 px-3" onClick={onClose}>
            Chiudi
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
