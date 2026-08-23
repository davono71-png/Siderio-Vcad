"use client";

import Link from "next/link";
import { Dialog } from "../ui/Dialog";

export function MoreMenu({
  open,
  onClose,
  onRename,
  onDuplicate,
  onExportPdf,
  onExportImages,
  onExportProject,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onExportPdf: () => void;
  onExportImages: () => void;
  onExportProject: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open={open} title="Taccuino" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <Link href="/" className="btn-secondary w-full" onClick={onClose}>
          Taccuini
        </Link>
        <button type="button" className="btn-secondary w-full" onClick={onRename}>
          Rinomina taccuino
        </button>
        <button type="button" className="btn-secondary w-full" onClick={onDuplicate}>
          Duplica
        </button>
        <button type="button" className="btn-secondary w-full" onClick={onExportPdf}>
          Esporta PDF
        </button>
        <button type="button" className="btn-secondary w-full" onClick={onExportImages}>
          Esporta immagini
        </button>
        <button type="button" className="btn-secondary w-full" onClick={onExportProject}>
          Esporta progetto
        </button>
        <button type="button" className="btn-danger w-full" onClick={onDelete}>
          Elimina
        </button>
      </div>
    </Dialog>
  );
}
