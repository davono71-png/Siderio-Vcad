"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parsePointName, withLetter, withNextSuffix } from "@/lib/measure/entry";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function LetterStrip({
  value,
  onChange,
  onDismiss,
}: {
  value: string;
  onChange: (name: string) => void;
  onDismiss?: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const shownRef = useRef(value);
  const [shown, setShown] = useState(value);
  const [custom, setCustom] = useState(false);
  const selected = parsePointName(shown)?.letter ?? null;

  useEffect(() => {
    if (value !== shownRef.current) {
      shownRef.current = value;
      setShown(value);
    }
  }, [value]);

  function commit(next: string) {
    shownRef.current = next;
    setShown(next);
    onChange(next);
  }

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const chip = selectedRef.current;
    if (!strip || !chip) return;
    const left = chip.offsetLeft - (strip.clientWidth - chip.clientWidth) / 2;
    strip.scrollLeft = Math.max(0, left);
  }, [selected]);

  function openCustom() {
    setCustom(true);
    requestAnimationFrame(() => customRef.current?.focus());
  }

  return (
    <div className="letter-pad" data-pad="letters">
      <div className="letter-tools">
        <p className="letter-value" aria-live="polite">
          {shown || "—"}
        </p>
        <button type="button" className="letter-tool" aria-label="Aggiungi numero" onClick={() => commit(withNextSuffix(shownRef.current))}>
          +
        </button>
        <button type="button" className="letter-tool letter-tool-aa" aria-label="Nome personalizzato" onClick={openCustom}>
          Aa
        </button>
        {onDismiss ? (
          <button type="button" className="letter-tool letter-tool-ok" onClick={onDismiss}>
            OK
          </button>
        ) : null}
      </div>
      <div ref={stripRef} className="letter-strip" role="listbox" aria-label="Nome del punto">
        {LETTERS.map((letter) => {
          const on = selected === letter;
          return (
            <button
              key={letter}
              ref={on ? selectedRef : undefined}
              type="button"
              role="option"
              aria-selected={on}
              className={`letter-chip ${on ? "on" : ""}`}
              onClick={() => commit(withLetter(shownRef.current, letter))}
            >
              {letter}
            </button>
          );
        })}
      </div>
      {custom ? (
        <input
          ref={customRef}
          className="input letter-custom"
          value={shown}
          aria-label="Nome personalizzato"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="done"
          onChange={(event) => commit(event.target.value.slice(0, 16))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      ) : null}
    </div>
  );
}
