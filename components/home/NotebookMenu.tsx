"use client";

import { Dialog } from "../ui/Dialog";
import type { Survey } from "@/lib/models/types";

export function NotebookMenu({
  survey,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
}: {
  survey: Survey | null;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open={!!survey} title={survey?.title ?? ""} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <button type="button" className="btn-secondary w-full" onClick={onRename}>
          Rinomina
        </button>
        <button type="button" className="btn-secondary w-full" onClick={onDuplicate}>
          Duplica
        </button>
        <button type="button" className="btn-danger w-full" onClick={onDelete}>
          Elimina
        </button>
      </div>
    </Dialog>
  );
}
