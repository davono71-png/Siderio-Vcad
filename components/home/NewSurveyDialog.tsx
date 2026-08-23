"use client";

import { useEffect, useState } from "react";
import { Dialog, Field } from "../ui/Dialog";
import { todayIsoDate } from "@/lib/format";

export type NewSurveyInput = {
  title: string;
  date: string;
};

export function NewSurveyDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: NewSurveyInput) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayIsoDate());

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDate(todayIsoDate());
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onCreate({
      title: title.trim() || "Disegno senza titolo",
      date,
    });
  }

  return (
    <Dialog open={open} title="Nuovo taccuino" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Titolo">
          <input
            autoFocus
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Es. Piano terra — villa Rossi"
          />
        </Field>
        <Field label="Data">
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        <div className="mt-4 flex gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Annulla
          </button>
          <button type="submit" className="btn-primary flex-1">
            Crea
          </button>
        </div>
      </form>
    </Dialog>
  );
}
