import {
  CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutBucketPolicyCommand,
  PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client;

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
    // Local MinIO over HTTP cannot use this AWS-only transport policy; bucket ACL stays private.
    if (!String(process.env.S3_ENDPOINT).startsWith("http://")) throw error;
  });
}

export async function putPrivateObject({ key, body, contentType, metadata }) {
  await getStorageClient().send(new PutObjectCommand({
    Bucket: getStorageBucket(), Key: key, Body: body, ContentType: contentType, Metadata: metadata,
  }));
  return { bucket: getStorageBucket(), key };
}

export async function createDownloadUrl(key, expiresIn = Number(process.env.S3_SIGNED_URL_TTL_SECONDS || 300)) {
  const maxTtl = 3_600;
  const ttl = Math.max(1, Math.min(Number(expiresIn), maxTtl));
  return getSignedUrl(getStorageClient(), new GetObjectCommand({
    Bucket: getStorageBucket(), Key: key,
  }), { expiresIn: ttl });
}

export async function checkStorage() {
  await getStorageClient().send(new HeadBucketCommand({ Bucket: getStorageBucket() }));
}
