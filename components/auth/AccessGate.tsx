"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { RESERVED_MESSAGE } from "@/lib/auth/admin";

type Gate = "loading" | "ok" | "unconfigured" | "login";

export function AccessGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/accesso", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string; message?: string } | null;
        if (cancelled) return;
        if (body?.ok) {
          setError(null);
          setGate("ok");
          return;
        }
        if (body?.code === "unconfigured") {
          setGate("unconfigured");
          return;
        }
        setError(body?.code === "forbidden" ? body.message || RESERVED_MESSAGE : null);
        setGate("login");
      } catch {
        if (!cancelled) setGate("login");
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
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string; message?: string } | null;
      if (body?.code === "unconfigured") {
        setGate("unconfigured");
        return;
      }
      if (body?.code === "forbidden") {
        setError(body.message || RESERVED_MESSAGE);
        return;
      }
      if (!response.ok || !body?.ok) {
        setError(body?.message || "Email o password non validi.");
        return;
      }
      setPassword("");
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
        <p className="mt-4 text-sm leading-relaxed">Il collegamento a Siderio Suite non è configurato.</p>
        <p className="mt-2 text-sm text-steel">Senza l’indirizzo e la chiave pubblica i rilievi restano chiusi.</p>
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
        Accedi con le credenziali di Siderio Suite. La sessione resta su questo telefono.
      </p>
      <form className="notebook-card mt-6 grid gap-3 p-4" onSubmit={(event) => void onSubmit(event)}>
        <label className="text-sm font-semibold" htmlFor="suite-email">
          Email
          <input
            id="suite-email"
            className="input mt-1"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="text-sm font-semibold" htmlFor="suite-password">
          Password
          <input
            id="suite-password"
            className="input mt-1"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button type="submit" className="btn-primary bg-accent text-ink" disabled={busy || email.trim().length === 0 || password.length === 0}>
          {busy ? "Verifica…" : "Entra"}
        </button>
      </form>
    </div>
  );
}
