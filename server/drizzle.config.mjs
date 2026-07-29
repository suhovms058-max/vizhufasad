import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.mjs",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://vizhufasad:vizhufasad_local@localhost:5432/vizhufasad",
  },
  strict: true,
  verbose: true,
});
