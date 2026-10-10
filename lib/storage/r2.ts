import {
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type CORSRule,
} from "@aws-sdk/client-s3";
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

let corsAttempted = false;

/**
 * The phone loads the GLB with fetch, so the private bucket must answer GET
 * with CORS. Photo uploads already need their own rule; this only adds GET
 * when it is missing and leaves existing rules in place.
 */
export async function ensureBrowserGetCors() {
  if (corsAttempted) return;
  corsAttempted = true;
  const env = readEnv();
  const client = clientFor(env);
  try {
    let rules: CORSRule[] = [];
    try {
      const current = await client.send(new GetBucketCorsCommand({ Bucket: env.bucket }));
      rules = current.CORSRules ?? [];
    } catch {
      return;
    }
    const allowsGet = rules.some((rule) => {
      const methods = (rule.AllowedMethods ?? []).map((method) => method.toUpperCase());
      const origins = rule.AllowedOrigins ?? [];
      return (methods.includes("GET") || methods.includes("*")) && origins.includes("*");
    });
    if (allowsGet) return;
    rules.push({
      AllowedOrigins: ["*"],
      AllowedMethods: ["GET", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
      MaxAgeSeconds: 3600,
    });
    await client.send(new PutBucketCorsCommand({ Bucket: env.bucket, CORSConfiguration: { CORSRules: rules } }));
  } catch {
    /* A token without bucket CORS rights still serves presigned URLs. */
  } finally {
    client.destroy();
  }
}

export async function readObjectRecord(key: string) {
  const env = readEnv();
  const client = clientFor(env);
  try {
    const object = await client.send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
    const text = (await object.Body?.transformToString()) ?? "";
    return { text, etag: object.ETag ?? "" };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number }; name?: string }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (status === 404 || name === "NoSuchKey" || name === "NotFound") return null;
    throw error;
  } finally {
    client.destroy();
  }
}

/** Last-writer-wins unless ifMatch or ifNoneMatch is set. A failed precondition returns conflict. */
export async function putObjectText(
  key: string,
  body: string,
  precondition?: { ifMatch: string } | { ifNoneMatch: "*" },
) {
  const env = readEnv();
  const client = clientFor(env);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: env.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
        IfMatch: precondition && "ifMatch" in precondition ? precondition.ifMatch : undefined,
        IfNoneMatch: precondition && "ifNoneMatch" in precondition ? precondition.ifNoneMatch : undefined,
      }),
    );
    return "ok" as const;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number }; name?: string }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (status === 412 || name === "PreconditionFailed") return "conflict" as const;
    throw error;
  } finally {
    client.destroy();
  }
}

export async function listCommonPrefixes(prefix: string) {
  const env = readEnv();
  const client = clientFor(env);
  const prefixes: string[] = [];
  let token: string | undefined;
  try {
    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: env.bucket,
          Prefix: prefix,
          Delimiter: "/",
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const item of listed.CommonPrefixes ?? []) {
        if (item.Prefix) prefixes.push(item.Prefix);
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return prefixes;
  } finally {
    client.destroy();
  }
}

export async function listObjects(prefix: string) {
  const env = readEnv();
  const client = clientFor(env);
  try {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: env.bucket, Prefix: prefix, MaxKeys: 200 }));
    return (listed.Contents ?? []).flatMap((item) => (item.Key ? [{ key: item.Key, size: item.Size ?? 0 }] : []));
  } finally {
    client.destroy();
  }
}

export async function readObjectText(key: string) {
  const env = readEnv();
  const client = clientFor(env);
  try {
    const object = await client.send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
    return (await object.Body?.transformToString()) ?? null;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number }; name?: string }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (status === 404 || name === "NoSuchKey" || name === "NotFound") return null;
    throw error;
  } finally {
    client.destroy();
  }
}

export async function presignGet(input: {
  key: string;
  expiresIn: number;
  contentType?: string;
  downloadName?: string;
}) {
  const env = readEnv();
  const client = clientFor(env);
  try {
    const command = new GetObjectCommand({
      Bucket: env.bucket,
      Key: input.key,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: input.downloadName
        ? `attachment; filename="${input.downloadName.replace(/[^A-Za-z0-9._-]+/g, "")}"`
        : undefined,
    });
    const url = await getSignedUrl(client, command, { expiresIn: input.expiresIn });
    return { url, expiresIn: input.expiresIn };
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
