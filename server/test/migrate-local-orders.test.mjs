import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("legacy migration dry run is safe when source directories do not exist", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vizhufasad-migration-"));
  try {
    const script = fileURLToPath(new URL("../scripts/migrate-local-orders.mjs", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [script], {
      env: { ...process.env, DATA_DIR: dataDir },
      windowsHide: true,
    });
    assert.match(stdout, /Dry run: found 0 local order files/);
    assert.match(stdout, /No data changed/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
