"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";

type Gate = "loading" | "ok" | "unconfigured" | "unauthorized";

export function AccessGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>("loading");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/accesso", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
        if (cancelled) return;
        if (body?.ok) setGate("ok");
        else if (body?.code === "unconfigured") setGate("unconfigured");
        else setGate("unauthorized");
      } catch {
        if (!cancelled) setGate("unauthorized");
      }
    }
    void refresh();
    const onAuth = () => void refresh();
    window.addEventListener("siderio-auth", onAuth);
    return () => {
      cancelled = true;
      window.removeEventListener("siderio-auth", onAuth);
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/accesso", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      if (body?.code === "unconfigured") {
        setGate("unconfigured");
        return;
      }
      if (!response.ok || !body?.ok) {
        setError("Codice non valido.");
        return;
      }
      setCode("");
      setGate("ok");
    } catch {
      setError("Connessione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  if (gate === "ok") return children;
  if (gate === "loading") {
    return (
      <div className="page">
        <p className="text-sm text-steel">Caricamento…</p>
      </div>
    );
  }
  if (gate === "unconfigured") {
    return (
      <div className="page">
        <header className="flex items-center py-3">
          <Logo />
        </header>
        <h1 className="font-serif text-4xl tracking-tight">Accesso</h1>
        <p className="mt-4 text-sm leading-relaxed">Configura APP_ACCESS_CODE</p>
        <p className="mt-2 text-sm text-steel">
          Il server non ha il codice di accesso. Senza quella variabile i rilievi restano chiusi.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="flex items-center py-3">
        <Logo />
      </header>
      <h1 className="font-serif text-4xl tracking-tight">Accesso</h1>
      <p className="mt-2 text-sm leading-relaxed text-steel">
        Inserisci il codice per aprire i rilievi su questo telefono o su questo computer.
      </p>
      <form className="notebook-card mt-6 grid gap-3 p-4" onSubmit={(event) => void onSubmit(event)}>
        <label className="text-sm font-semibold">
          Codice
          <input
            className="input mt-1"
            type="password"
            autoComplete="current-password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button type="submit" className="btn-primary bg-accent text-ink" disabled={busy || code.trim().length === 0}>
          {busy ? "Verifica…" : "Entra"}
        </button>
      </form>
    </div>
  );
}
