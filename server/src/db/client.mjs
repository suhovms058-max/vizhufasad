import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.mjs";

let pool;
let database;

export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 3_000),
  });
  return pool;
}

export function getDatabase() {
  database ??= drizzle(getPool(), { schema });
  return database;
}

export async function checkDatabase() {
  await getPool().query("select 1");
}

export async function closeDatabase() {
  if (pool) await pool.end();
  pool = undefined;
  database = undefined;
}
