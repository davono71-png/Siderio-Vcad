"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NotebookCard } from "./NotebookCard";
import { NotebookMenu } from "./NotebookMenu";
import { NewSurveyDialog } from "./NewSurveyDialog";
import { ConfirmDialog, Dialog, Field } from "../ui/Dialog";
import {
  createAndSaveSurvey,
  deleteSurvey,
  duplicateSurvey,
  getThumbnailUrl,
  listSurveys,
  renameSurvey,
} from "@/lib/db/surveys";
import { importProject } from "@/lib/export/project";
import { createSurveyFromCad } from "@/lib/cad/ingest";
import { CadParseError } from "@/lib/cad/parse";
import type { Survey } from "@/lib/models/types";

export function HomeScreen() {
  const router = useRouter();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const cadRef = useRef<HTMLInputElement>(null);
  const thumbUrls = useRef<string[]>([]);

  const reload = useCallback(async () => {
    const list = await listSurveys();
    setSurveys(list);
    thumbUrls.current.forEach((u) => URL.revokeObjectURL(u));
    thumbUrls.current = [];
    const next: Record<string, string> = {};
    for (const s of list) {
      const url = await getThumbnailUrl(s);
      if (url) {
        next[s.id] = url;
        thumbUrls.current.push(url);
      }
    }
    setThumbs(next);
    setReady(true);
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
    const urls = thumbUrls;
    return () => urls.current.forEach((u) => URL.revokeObjectURL(u));
  }, [reload]);

  const menuSurvey = surveys.find((s) => s.id === menuId) ?? null;

  async function create(input: { title: string; date: string }) {
    const survey = await createAndSaveSurvey(input);
    setNewOpen(false);
    router.push(`/survey/${survey.id}`);
  }

  async function openDrawing(file: File) {
    try {
      setError(null);
      setBusy("Apertura disegno…");
      const survey = await createSurveyFromCad(file);
      router.push(`/survey/${survey.id}`);
    } catch (e) {
      setBusy(null);
      setError(
        e instanceof CadParseError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Disegno non aperto",
      );
    }
  }

  async function openSample() {
    try {
      setError(null);
      setBusy("Apertura esempio…");
      const res = await fetch("/samples/piano-terra.dxf");
      if (!res.ok) {
        setBusy(null);
        setError("Esempio non trovato");
        return;
      }
      const blob = await res.blob();
      await openDrawing(new File([blob], "piano-terra.dxf", { type: "application/dxf" }));
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Esempio non aperto");
    }
  }

  async function onImport(file: File) {
    try {
      const survey = await importProject(file);
      await reload();
      router.push(`/survey/${survey.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Importazione non riuscita");
    }
  }

  return (
    <div className="home-desk flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center gap-3 px-6 pt-6">
        <div className="pill-save pointer-events-none">
          <Marchio />
          Siderio Vcad
        </div>
        <div className="pill-meta">
          <span>Visualizzatore DXF · layer, campiture, quote in scala</span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-8">
        {error ? (
          <p className="mb-3 rounded-2xl bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}
        {busy ? <p className="mb-3 text-sm text-black/50">{busy}</p> : null}

        <div className="mb-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            className="pill-save"
            disabled={!!busy}
            onClick={() => cadRef.current?.click()}
          >
            Apri DXF / DWG
          </button>
          <button type="button" className="pill" disabled={!!busy} onClick={() => void openSample()}>
            Esempio
          </button>
          <button type="button" className="pill" onClick={() => setNewOpen(true)}>
            Vuoto
          </button>
          <button type="button" className="pill" onClick={() => importRef.current?.click()}>
            .srilievo
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-2.5 pb-8">
          {!ready ? (
            <p className="py-8 text-center text-sm text-black/40">Apertura disegni…</p>
          ) : surveys.length === 0 ? (
            <div className="rounded-[1.4rem] bg-white p-10 text-center text-sm text-black/50 shadow-[0_10px_32px_rgba(0,0,0,0.08)]">
              Apri un DXF o DWG per vederlo, spegnere layer e campiture, quota e stampa.
            </div>
          ) : (
            surveys.map((s) => (
              <NotebookCard
                key={s.id}
                survey={s}
                thumbUrl={thumbs[s.id]}
                onOpen={() => undefined}
                onMenu={() => setMenuId(s.id)}
              />
            ))
          )}
        </div>
      </div>
      <input
          ref={cadRef}
          type="file"
          accept=".dxf,.dwg,image/vnd.dxf,application/dxf,application/acad,application/x-dxf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openDrawing(f);
            e.target.value = "";
          }}
        />
        <input
          ref={importRef}
          type="file"
          accept=".srilievo,application/octet-stream"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />

      <NotebookMenu
        survey={menuSurvey}
        onClose={() => setMenuId(null)}
        onRename={() => {
          if (!menuSurvey) return;
          setRenameTitle(menuSurvey.title);
          setRenameId(menuSurvey.id);
          setMenuId(null);
        }}
        onDuplicate={async () => {
          if (!menuId) return;
          await duplicateSurvey(menuId);
          setMenuId(null);
          await reload();
        }}
        onDelete={() => {
          setDeleteId(menuId);
          setMenuId(null);
        }}
      />

      <NewSurveyDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={(input) => void create(input)}
      />

      <Dialog open={!!renameId} title="Rinomina taccuino" onClose={() => setRenameId(null)}>
        <Field label="Titolo">
          <input
            className="input"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
          />
        </Field>
        <div className="mt-4 flex gap-3">
          <button className="btn-secondary flex-1" type="button" onClick={() => setRenameId(null)}>
            Annulla
          </button>
          <button
            className="btn-primary flex-1"
            type="button"
            onClick={async () => {
              if (renameId) await renameSurvey(renameId, renameTitle);
              setRenameId(null);
              await reload();
            }}
          >
            Salva
          </button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        title="Eliminare il taccuino?"
        body="L’operazione è definitiva su questo dispositivo. Esporta prima il progetto se vuoi conservarlo."
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          if (deleteId) await deleteSurvey(deleteId);
          setDeleteId(null);
          await reload();
        }}
      />
    </div>
  );
}

function Marchio() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M13.6 2L5 13.4h5.2L9.2 22l8.8-11.6h-5.4z" />
    </svg>
  );
}
