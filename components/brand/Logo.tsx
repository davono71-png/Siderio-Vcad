/* eslint-disable @next/next/no-img-element */

export function Mark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <img
      src="/brand/siderio-icon.svg"
      alt=""
      width={36}
      height={36}
      className={`shrink-0 ${className}`}
    />
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Mark />
      <div className="leading-tight">
        <div className="font-serif text-xl tracking-tight text-ink">Siderio</div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand/70">
          Vcad
        </div>
      </div>
    </div>
  );
}
