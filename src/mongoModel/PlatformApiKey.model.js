import mongoose from "mongoose";

// The platform's own provider keys, one row per service, that wallet-billed
// traffic runs on. gtwy-ai reads this collection live.
const PlatformApiKeySchema = new mongoose.Schema(
  {
    service: {
      type: String,
      required: true,
      unique: true
    },
    apikey: {
      // Helper.encrypt output (hex) — never store plaintext here.
      type: String,
      required: true
    },
    updated_by: {
      type: String,
      default: ""
    }
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "platform_apikeys" }
);

const PlatformApiKeyModel = mongoose.model("PlatformApiKey", PlatformApiKeySchema);

export default PlatformApiKeyModel;
