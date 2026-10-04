import { HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PRESIGN_SECONDS } from "./keys";

export type StorageCode = "ok" | "missing_env" | "bad_account" | "denied" | "unreachable";

export class StorageConfigError extends Error {
  code: "missing_env" | "bad_account";

  constructor(code: "missing_env" | "bad_account") {
    super(code);
    this.code = code;
  }
}

type R2Env = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function readEnv(): R2Env {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucket = process.env.R2_BUCKET?.trim() ?? "";
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new StorageConfigError("missing_env");
  }
  if (!/^[0-9a-f]{32}$/i.test(accountId)) {
    throw new StorageConfigError("bad_account");
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function clientFor(env: R2Env) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function codeFromAws(error: unknown): "denied" | "unreachable" {
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  if (status === 401 || status === 403) return "denied";
  return "unreachable";
}

export async function checkBucket(): Promise<{ ok: true; code: "ok" } | { ok: false; code: StorageCode }> {
  let env: R2Env;
  try {
    env = readEnv();
  } catch (error) {
    if (error instanceof StorageConfigError) return { ok: false, code: error.code };
    return { ok: false, code: "unreachable" };
  }

  const client = clientFor(env);
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.bucket }));
    await client.send(new ListObjectsV2Command({ Bucket: env.bucket, MaxKeys: 1 }));
    return { ok: true, code: "ok" };
  } catch (error) {
    return { ok: false, code: codeFromAws(error) };
  } finally {
    client.destroy();
  }
}

export async function presignObject(input: {
  op: "put" | "get";
  key: string;
  contentType?: string;
  contentLength?: number;
}) {
  const env = readEnv();
  const client = clientFor(env);
  try {
    const command =
      input.op === "put"
        ? new PutObjectCommand({
            Bucket: env.bucket,
            Key: input.key,
            ContentType: input.contentType,
          })
        : new GetObjectCommand({
            Bucket: env.bucket,
            Key: input.key,
          });
    const url = await getSignedUrl(client, command, { expiresIn: PRESIGN_SECONDS });
    return { url, expiresIn: PRESIGN_SECONDS };
  } finally {
    client.destroy();
  }
}
