import { getRepository } from "../data";
import type { PhotoMeta, UploadRecord, UploadSummary } from "../data/types";
import { MAX_JPEG_BYTES } from "../storage/keys";
import { syncSurvey } from "../sync/client";
import { isPermanentPresignError, PresignError, putRemote } from "./remote";

const listeners = new Set<() => void>();
let pumping = false;
let inflight = 0;
let booted = false;

export function subscribeUploads(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener();
}

export function startUploader() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  window.addEventListener("online", () => {
    void getRepository()
      .expeditePending()
      .then(() => kick())
      .catch(() => undefined);
  });
  window.addEventListener("offline", () => emit());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushManifestTimers();
  });
  void getRepository()
    .resetStaleClaims(90_000)
    .then(() => kick())
    .catch(() => undefined);
  window.setInterval(() => kick(), 4000);
}

export async function enqueueAcceptedPhoto(meta: PhotoMeta) {
  if (!meta.accepted) return;
  await getRepository().enqueuePhotoUpload(meta);
  scheduleManifest(meta.projectId);
  emit();
  kick();
}

const manifestTimers = new Map<string, number>();

export function scheduleManifest(projectId: string) {
  if (typeof window === "undefined") return;
  const existing = manifestTimers.get(projectId);
  if (existing != null) window.clearTimeout(existing);
  manifestTimers.set(
    projectId,
    window.setTimeout(() => {
      manifestTimers.delete(projectId);
      void getRepository()
        .touchManifest(projectId, 0)
        .then(() => {
          emit();
          kick();
        });
    }, 2000),
  );
}

function flushManifestTimers() {
  for (const [projectId, timer] of manifestTimers) {
    window.clearTimeout(timer);
    void getRepository().touchManifest(projectId, 0);
  }
  manifestTimers.clear();
  kick();
}

export async function retryProjectUploads(projectId: string) {
  await getRepository().retryUploads(projectId);
  emit();
  kick();
}

export async function freeUploadedPhotos(projectId: string) {
  const freed = await getRepository().releaseUploadedBlobs(projectId);
  emit();
  return freed;
}

export async function readUploadSummary(projectId: string): Promise<UploadSummary> {
  return getRepository().uploadSummary(projectId);
}

export function kick() {
  if (pumping || typeof navigator === "undefined" || !navigator.onLine) return;
  pumping = true;
  void pump().finally(() => {
    pumping = false;
  });
}

async function pump() {
  const run = async () => {
    if (!navigator.onLine) return;
    const slots = 2 - inflight;
    if (slots <= 0) return;
    const batch = await getRepository().claimUploads(Date.now(), slots);
    if (batch.length === 0) return;
    for (const item of batch) {
      inflight += 1;
      emit();
      void send(item).finally(() => {
        inflight -= 1;
        emit();
        kick();
      });
    }
  };

  const locks = navigator.locks;
  if (!locks) {
    await run();
    return;
  }
  await locks.request("siderio-r2-upload", { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    await run();
  });
}

async function send(record: UploadRecord) {
  const repo = getRepository();
  try {
    if (record.kind === "photo") {
      const photo = await repo.getPhoto(record.id);
      if (!photo?.blob) {
        await repo.finishUpload(record.id, false, "missing_blob", true);
        return;
      }
      if (photo.blob.size > MAX_JPEG_BYTES) {
        await repo.finishUpload(record.id, false, "too_big", true);
        return;
      }
      await putRemote(record.key, photo.blob, "image/jpeg");
      await repo.finishUpload(record.id, true, null, false);
      scheduleManifest(record.projectId);
      return;
    }

    const synced = await syncSurvey(record.projectId);
    if (synced === "ok" || synced === "missing") {
      await repo.finishUpload(record.id, true, null, false);
      return;
    }
    await repo.finishUpload(record.id, false, synced, false);
  } catch (error) {
    const coded = error instanceof PresignError ? error : new PresignError("network", 0);
    await repo.finishUpload(record.id, false, coded.code, isPermanentPresignError(coded));
  }
}

export function uploadStatusText(summary: UploadSummary) {
  if (summary.accepted === 0 && summary.pending === 0 && summary.failed === 0) return "";
  const parts = [`Caricate ${summary.uploaded}/${summary.accepted}`];
  if (summary.pending > 0) parts.push(summary.pending === 1 ? "1 in coda" : `${summary.pending} in coda`);
  if (summary.failed > 0) parts.push(summary.failed === 1 ? "1 errore" : `${summary.failed} errori`);
  return parts.join(" · ");
}

export function uploadErrorText(code: string | null) {
  if (!code) return null;
  if (code === "missing_env" || code === "bad_account") return "Archivio remoto non configurato su questo server.";
  if (code === "unconfigured") return "Configura l’accesso a Siderio Suite sul server.";
  if (code === "unauthorized") return "Accedi di nuovo con Siderio Suite.";
  if (code === "forbidden") return "Accesso riservato all'amministratore.";
  if (code === "network") return "Rete assente: riprovo da solo.";
  if (code === "denied") return "L’archivio ha rifiutato l’accesso.";
  if (code === "too_big" || code === "bad_size") return "File oltre il limite (25 MB per le foto).";
  if (code === "unreachable" || code === "put_failed") return "Archivio non raggiungibile.";
  if (code === "rate_limited") return "Troppe richieste, riprovo tra poco.";
  return "Caricamento non riuscito.";
}
