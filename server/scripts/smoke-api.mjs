import "dotenv/config";
import { randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";

const port = randomInt(18_000, 19_000);
const child = spawn(process.execPath, ["index.mjs"], {
  cwd: new URL("../", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    AUTH_MAIL_MODE: "console",
    AUTH_HASH_SECRET: "stage8-api-smoke-only-not-a-production-secret-0123456789",
    FEATURE_STANDARD_GENERATION_ENABLED: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let diagnostics = "";
child.stderr.on("data", (chunk) => {
  diagnostics = `${diagnostics}${chunk}`.slice(-1_000);
});

async function stop() {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

try {
  let health;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // API is still starting.
    }
  }
  if (!health) throw new Error(`API_SMOKE_TIMEOUT ${diagnostics}`.trim());
  const dependencies = Object.fromEntries(
    Object.entries(health.services).map(([name, value]) => [name, value.status]),
  );
  console.log(JSON.stringify({ ok: true, status: health.status, dependencies }));
} finally {
  await stop();
}
