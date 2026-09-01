/**
 * One-time import of the platform provider keys from env vars into the
 * platform_apikeys collection (encrypted with Helper.encrypt, same as
 * customer apikeys). After seeding, keys are managed through
 * PUT/GET/DELETE /api/platform-keys and the env vars become a fallback only.
 *
 * Reads the same env names Python's Config.PLATFORM_API_KEYS used, so this
 * can run wherever that .env lives.
 *
 * Usage:
 *   node scripts/seedPlatformApiKeys.js --dry-run   # show what would be written (masked)
 *   node scripts/seedPlatformApiKeys.js             # upsert all present keys
 */

import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const ENV_KEY_BY_SERVICE = {
  openai: process.env.PLATFORM_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  openai_completion: process.env.PLATFORM_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  anthropic: process.env.PLATFORM_ANTHROPIC_API_KEY,
  google: process.env.PLATFORM_GOOGLE_API_KEY,
  groq: process.env.PLATFORM_GROQ_API_KEY,
  mistral: process.env.PLATFORM_MISTRAL_API_KEY,
  grok: process.env.PLATFORM_GROK_API_KEY,
  open_router: process.env.PLATFORM_OPEN_ROUTER_API_KEY,
  deepgram: process.env.PLATFORM_DEEPGRAM_API_KEY,
  neev_cloud: process.env.PLATFORM_NEEV_CLOUD_API_KEY,
  moonshot: process.env.PLATFORM_MOONSHOT_API_KEY,
  deepseek: process.env.PLATFORM_DEEPSEEK_API_KEY,
  minimax: process.env.PLATFORM_MINIMAX_API_KEY
};

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const { default: Helper } = await import("../src/services/utils/helper.utils.js");
  const { default: PlatformApiKeyModel } = await import("../src/mongoModel/PlatformApiKey.model.js");

  const present = Object.entries(ENV_KEY_BY_SERVICE).filter(([, v]) => Boolean(v));
  const missing = Object.keys(ENV_KEY_BY_SERVICE).filter((k) => !ENV_KEY_BY_SERVICE[k]);

  console.log(`Found ${present.length} key(s) in env; missing: ${missing.join(", ") || "none"}`);
  for (const [service, key] of present) {
    console.log(`  ${service}: ${Helper.maskApiKey(key)}`);
  }
  if (dryRun) return;

  await mongoose.connect(process.env.MONGODB_CONNECTION_URI);
  for (const [service, key] of present) {
    const encrypted = await Helper.encrypt(key);
    await PlatformApiKeyModel.findOneAndUpdate(
      { service },
      { $set: { apikey: encrypted, updated_by: "seed-script" } },
      { upsert: true }
    );
    console.log(`  upserted ${service}`);
  }
  await mongoose.disconnect();
  console.log("Done. Verify with GET /api/platform-keys.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
