export class PresignError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

type Signed = { url: string; expiresIn: number };

async function presign(body: {
  op: "put" | "get";
  key: string;
  contentType?: string;
  contentLength?: number;
}): Promise<Signed> {
  let response: Response;
  try {
    response = await fetch("/api/storage/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PresignError("network", 0);
  }
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; code?: string; url?: string; expiresIn?: number } | null;
  if (!response.ok || !payload?.url) {
    throw new PresignError(payload?.code || "presign_failed", response.status);
  }
  return { url: payload.url, expiresIn: payload.expiresIn ?? 600 };
}

export function isPermanentPresignError(error: PresignError) {
  return error.status === 400 || error.status === 413 || error.code === "too_big" || error.code === "bad_key";
}

export async function putRemote(key: string, body: Blob, contentType: string) {
  const signed = await presign({
    op: "put",
    key,
    contentType,
    contentLength: body.size,
  });
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method: "PUT",
      body,
      headers: { "Content-Type": contentType },
    });
  } catch {
    throw new PresignError("network", 0);
  }
  if (!response.ok) throw new PresignError("put_failed", response.status);
}

export async function fetchRemotePhoto(key: string) {
  try {
    const signed = await presign({ op: "get", key });
    const response = await fetch(signed.url);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}
