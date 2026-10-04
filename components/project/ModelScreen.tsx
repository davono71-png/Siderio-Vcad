"use client";

import Link from "next/link";
import { PageHeader } from "../ui/PageHeader";

const OUTPUTS = [
  { ext: "OBJ", text: "Mesh con texture" },
  { ext: "GLB", text: "Modello da vedere qui" },
  { ext: "STEP", text: "Pareti semplificate" },
] as const;

export function ModelScreen({ projectId }: { projectId: string }) {
  return (
    <div className="page">
      <PageHeader title="Anteprima 3D" backHref={`/rilievo/${projectId}`} />
      <div className="model-stage" aria-hidden>
        <svg viewBox="0 0 200 140" className="h-40 w-full">
          <path d="M30 110 L70 78 L170 78 L130 110 Z" fill="none" stroke="#f3752c" strokeWidth="2" />
          <path d="M70 78 L70 28 L170 28 L170 78" fill="none" stroke="#2c2c2c" strokeWidth="2" />
          <path d="M30 110 L30 60 L70 28" fill="none" stroke="#2c2c2c" strokeWidth="2" />
          <path d="M30 60 L130 60 L170 28" fill="none" stroke="#2c2c2c" strokeWidth="2" />
          <path d="M130 60 L130 110" fill="none" stroke="#2c2c2c" strokeWidth="2" />
        </svg>
        <p>Nessuna mesh ancora</p>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-steel">
        Quando il worker avrà ricostruito il rilievo, qui si aprirà il modello. Oggi questa schermata è solo il posto
        in cui arriveranno la nuvola sparsa, la mesh e le pareti.
      </p>
      <ul className="mt-4 grid gap-2">
        {OUTPUTS.map((output) => (
          <li key={output.ext} className="notebook-card flex items-center justify-between p-3">
            <span>
              <span className="font-semibold">{output.ext}</span>
              <span className="mt-0.5 block text-sm text-steel">{output.text}</span>
            </span>
            <button type="button" className="btn-secondary" disabled title="Disponibile dopo l’elaborazione">
              Scarica
            </button>
          </li>
        ))}
      </ul>
      <Link href={`/rilievo/${projectId}/lavoro`} className="btn-secondary mt-4 inline-flex">
        Stato del lavoro
      </Link>
    </div>
  );
}
