import { checkDatabase } from "./db/client.mjs";
import { checkRedis } from "./infra/redis.mjs";
import { checkStorage } from "./infra/storage.mjs";

const checks = { database: checkDatabase, redis: checkRedis, storage: checkStorage };

async function runCheck(name, check) {
  const startedAt = Date.now();
  try {
    const timeoutMs = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 4_000);
    await Promise.race([
      check(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("health check timeout")), timeoutMs)),
    ]);
    return [name, { status: "up", latencyMs: Date.now() - startedAt }];
  } catch {
    return [name, { status: "down", latencyMs: Date.now() - startedAt }];
  }
}

export async function readiness(_request, response) {
  const entries = await Promise.all(Object.entries(checks).map(([name, check]) => runCheck(name, check)));
  const services = Object.fromEntries(entries);
  const ready = Object.values(services).every(({ status }) => status === "up");
  response.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    api: { status: "up" },
    services,
    timestamp: new Date().toISOString(),
  });
}

export function liveness(_request, response) {
  response.json({ status: "ok", api: { status: "up" }, timestamp: new Date().toISOString() });
}
