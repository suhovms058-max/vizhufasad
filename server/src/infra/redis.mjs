import { createClient } from "redis";

let client;

export async function getRedis() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 3_000),
        reconnectStrategy: false,
      },
    });
    client.on("error", (error) => console.error("Redis connection error", error.message));
  }
  if (!client.isOpen) await client.connect();
  return client;
}

export async function checkRedis() {
  const result = await (await getRedis()).ping();
  if (result !== "PONG") throw new Error("Unexpected Redis ping response");
}

export async function closeRedis() {
  if (client?.isOpen) await client.quit();
  client = undefined;
}
