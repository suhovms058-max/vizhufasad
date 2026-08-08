import assert from "node:assert/strict";
import test from "node:test";
import { isMinioCompatibility } from "../src/infra/storage.mjs";

test("MinIO compatibility remains explicit behind an HTTPS reverse proxy", () => {
  assert.equal(isMinioCompatibility({
    S3_ENDPOINT: "https://storage.example.test",
    S3_COMPATIBILITY_MODE: "minio",
  }), true);
  assert.equal(isMinioCompatibility({ S3_ENDPOINT: "https://s3.example.test" }), false);
  assert.equal(isMinioCompatibility({ S3_ENDPOINT: "http://127.0.0.1:9000" }), true);
});
