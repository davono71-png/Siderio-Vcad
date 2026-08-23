"use client";

import { useState, type ReactNode } from "react";

export function Dialog({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-3 sm:items-center">
      <button
        className="absolute inset-0 cursor-default"
        aria-label="Chiudi"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-3xl bg-paper p-5 shadow-xl">
        <h2 className="font-serif text-2xl text-ink">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Elimina",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <p className="text-ink/70">{body}</p>
      <div className="mt-5 flex gap-3">
        <button type="button" className="btn-secondary flex-1" onClick={onClose}>
          Annulla
        </button>
        <button type="button" className="btn-danger flex-1" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-sm font-medium text-ink/70">{label}</span>
      {children}
    </label>
  );
}

export function usePromptState() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
