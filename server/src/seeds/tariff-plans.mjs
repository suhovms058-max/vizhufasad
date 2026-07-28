import "dotenv/config";
import { sql } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../db/client.mjs";
import { tariffPlans } from "../db/schema.mjs";

const starterPlans = [
  { code: "STARTER_3", name: "Стартовый", description: "3 концепции фасада", priceMinor: 0, credits: 3, isActive: false },
  { code: "STANDARD_10", name: "Стандарт", description: "10 концепций фасада", priceMinor: 0, credits: 10, isActive: false },
  { code: "PRO_30", name: "Про", description: "30 концепций фасада", priceMinor: 0, credits: 30, isActive: false },
];

try {
  await getDatabase().insert(tariffPlans).values(starterPlans).onConflictDoUpdate({
    target: tariffPlans.code,
    set: {
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      credits: sql`excluded.credits`,
      isActive: false,
      updatedAt: new Date(),
    },
  });
  console.log(`Seeded ${starterPlans.length} inactive tariff plans`);
} finally {
  await closeDatabase();
}
