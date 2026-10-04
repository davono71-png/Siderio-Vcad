"use client";

type Props = {
  onStart: () => void;
  skipNext: boolean;
  onSkipNext: (value: boolean) => void;
};

const TIPS = [
  "Muoviti tra 4 e 6 posizioni intorno alla stanza o lungo la facciata. Non ruotare solo sui talloni.",
  "Ogni foto deve sovrapporsi alla precedente del 60–80%: lo stesso angolo deve vedersi in più scatti.",
  "Luci accese, tende aperte. Evita controluce forte e foto mosse.",
  "Inquadra anche i bordi del pavimento e del soffitto, non solo il centro delle pareti.",
  "Sulle superfici bianche e lisce attacca fogli con texture: giornale, cartone o nastro a scacchi.",
];

export function Guidance({ onStart, skipNext, onSkipNext }: Props) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-ink text-white">
      <div className="flex-1 overflow-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Prima di scattare</p>
        <h2 className="mt-2 font-serif text-3xl leading-tight">Come fare il rilievo</h2>
        <ul className="mt-5 flex flex-col gap-3">
          {TIPS.map((tip) => (
            <li key={tip} className="rounded-2xl bg-white/8 px-4 py-3 text-sm leading-relaxed text-white/90">
              {tip}
            </li>
          ))}
        </ul>
      </div>
      <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <label className="mb-3 flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={skipNext}
            onChange={(event) => onSkipNext(event.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Non mostrare più questi consigli
        </label>
        <button type="button" className="btn-primary w-full bg-accent text-ink" onClick={onStart}>
          Ho capito, apri la fotocamera
        </button>
      </div>
    </div>
  );
}
