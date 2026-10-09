"use client";

import type { ReactNode } from "react";
import Link from "next/link";

type Props = {
  title: string;
  backHref?: string;
  action?: ReactNode;
};

export function PageHeader({ title, backHref, action }: Props) {
  return (
    <header className="page-header">
      {backHref ? (
        <Link href={backHref} className="header-back" aria-label="Indietro">
          ←
        </Link>
      ) : (
        <span className="w-10" />
      )}
      <h1 className="min-w-0 flex-1 truncate font-serif text-xl">{title}</h1>
      <div className="ml-auto">{action}</div>
    </header>
  );
}
