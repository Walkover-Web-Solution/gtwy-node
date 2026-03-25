import dotenv from "dotenv";
dotenv.config();

import { migrateAlerts } from "./migrations/mongo/alerts.js";
import { migrateResponseTypes } from "./migrations/mongo/responseTypes.js";
import { migrateApiCalls } from "./migrations/mongo/apiCalls.js";
import { migrateApikeyCredentials } from "./migrations/mongo/apiKeyCredentials.js";
import { migrateConfigurations } from "./migrations/mongo/configurationAndVersions.js";

const MIGRATIONS = [
  { name: "alerts", fn: migrateAlerts },
  { name: "responseTypes", fn: migrateResponseTypes },
  { name: "apiCalls", fn: migrateApiCalls },
  { name: "apiKeyCredentials", fn: migrateApikeyCredentials },
  { name: "configurations", fn: migrateConfigurations }
];

const target = process.argv[2];
const toRun = target ? MIGRATIONS.filter((m) => m.name === target) : MIGRATIONS;

if (target && toRun.length === 0) {
  console.error(`Unknown migration: "${target}". Valid: ${MIGRATIONS.map((m) => m.name).join(", ")}`);
  process.exit(1);
}

for (const { name, fn } of toRun) {
  console.log(`\n${"=".repeat(60)}\nRunning: ${name}\n${"=".repeat(60)}`);
  await fn();
  console.log(`\n✓ ${name} completed`);
}

console.log("\n✓ All migrations completed successfully");
process.exit(0);
