import {
  CreateBucketCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand,
  HeadBucketCommand, HeadObjectCommand, PutBucketCorsCommand, PutBucketPolicyCommand,
  PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client;

export function isMinioCompatibility(environment = process.env) {
  return String(environment.S3_COMPATIBILITY_MODE || "").toLowerCase() === "minio"
    || String(environment.S3_ENDPOINT || "").startsWith("http://");
}

function isUnsupportedMinioControl(error) {
  return isMinioCompatibility()
    && (error?.name === "NotImplemented" || error?.$metadata?.httpStatusCode === 501);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function getStorageClient() {
  client ??= new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: required("S3_ENDPOINT"),
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || "true") === "true",
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

export function getStorageBucket() {
  return required("S3_BUCKET");
}

export async function ensurePrivateBucket() {
  const storage = getStorageClient();
  const bucket = getStorageBucket();
  try {
    await storage.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound") throw error;
    await storage.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await storage.send(new PutBucketPolicyCommand({
    Bucket: bucket,
    Policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Sid: "DenyInsecureTransport",
        Effect: "Deny",
        Principal: "*",
        Action: "s3:*",
        Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
        Condition: { Bool: { "aws:SecureTransport": "false" } },
      }],
    }),
  })).catch((error) => {
    // MinIO may reject this AWS-only transport policy; anonymous access remains disabled.
    if (!isUnsupportedMinioControl(error)) throw error;
  });
  const allowedOrigins = String(process.env.S3_CORS_ORIGINS || process.env.SITE_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length) {
    await storage.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [{
            AllowedOrigins: allowedOrigins,
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 600,
          }],
        },
      }),
    ).catch((error) => {
      // MinIO configures browser CORS at server level via MINIO_API_CORS_ALLOW_ORIGIN.
      if (!isUnsupportedMinioControl(error)) throw error;
    });
  }
}

export async function putPrivateObject({ key, body, contentType, metadata }) {
  await getStorageClient().send(new PutObjectCommand({
    Bucket: getStorageBucket(), Key: key, Body: body, ContentType: contentType, Metadata: metadata,
  }));
  return { bucket: getStorageBucket(), key };
}

export async function createUploadUrl({
  key,
  contentType,
  contentLength,
  expiresIn = Number(process.env.S3_UPLOAD_URL_TTL_SECONDS || 600),
}) {
  const ttl = Math.max(60, Math.min(Number(expiresIn), 900));
  const command = new PutObjectCommand({
    Bucket: getStorageBucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  const url = await getSignedUrl(getStorageClient(), command, {
    expiresIn: ttl,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return {
    url,
    expiresIn: ttl,
    headers: { "Content-Type": contentType },
  };
}

export async function createDownloadUrl(key, expiresIn = Number(process.env.S3_SIGNED_URL_TTL_SECONDS || 300)) {
  const maxTtl = 3_600;
  const ttl = Math.max(1, Math.min(Number(expiresIn), maxTtl));
  return getSignedUrl(getStorageClient(), new GetObjectCommand({
    Bucket: getStorageBucket(), Key: key,
  }), { expiresIn: ttl });
}

export async function headPrivateObject(key) {
  const result = await getStorageClient().send(new HeadObjectCommand({
    Bucket: getStorageBucket(),
    Key: key,
  }));
  return {
    contentLength: Number(result.ContentLength || 0),
    contentType: result.ContentType || "application/octet-stream",
    metadata: result.Metadata || {},
  };
}

export async function getPrivateObjectBuffer(key, maxBytes) {
  const result = await getStorageClient().send(new GetObjectCommand({
    Bucket: getStorageBucket(),
    Key: key,
  }));
  const chunks = [];
  let bytes = 0;
  for await (const chunk of result.Body) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      result.Body.destroy?.();
      throw new Error("OBJECT_TOO_LARGE");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, bytes);
}

export async function deletePrivateObject(key) {
  if (!key) return;
  await getStorageClient().send(new DeleteObjectCommand({
    Bucket: getStorageBucket(),
    Key: key,
  }));
}

export async function deletePrivateObjects(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return;
  await getStorageClient().send(new DeleteObjectsCommand({
    Bucket: getStorageBucket(),
    Delete: { Objects: unique.map((Key) => ({ Key })), Quiet: true },
  }));
}

export async function checkStorage() {
  await getStorageClient().send(new HeadBucketCommand({ Bucket: getStorageBucket() }));
}
