import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { checkDatabase, closeDatabase } from "../src/db/client.mjs";
import { checkRedis, closeRedis } from "../src/infra/redis.mjs";
import {
  createDownloadUrl, ensurePrivateBucket, getStorageBucket, putPrivateObject,
} from "../src/infra/storage.mjs";

const enabled = ["DATABASE_URL", "REDIS_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"]
  .every((name) => process.env[name]);

test("PostgreSQL, Redis and private object storage are reachable", { skip: !enabled }, async (context) => {
  context.after(async () => {
    await Promise.all([closeDatabase(), closeRedis()]);
  });
  await Promise.all([checkDatabase(), checkRedis(), ensurePrivateBucket()]);
  const key = `smoke/${crypto.randomUUID()}.txt`;
  await putPrivateObject({ key, body: Buffer.from("private facade artifact"), contentType: "text/plain" });

  const unsigned = await fetch(`${process.env.S3_ENDPOINT}/${getStorageBucket()}/${key}`);
  assert.ok([401, 403].includes(unsigned.status), `unsigned object returned ${unsigned.status}`);

  const signed = await fetch(await createDownloadUrl(key, 60));
  assert.equal(signed.status, 200);
  assert.equal(await signed.text(), "private facade artifact");
});
