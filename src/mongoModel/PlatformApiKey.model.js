import mongoose from "mongoose";

// The PLATFORM's own provider keys — the keys wallet-billed traffic runs on.
// One row per service, apikey stored encrypted with Helper.encrypt (the same
// method customer apikeys use). Python decrypts the whole collection into
// memory at startup and refreshes it via a change stream, so an update here
// reaches the request gate within a moment. Collection name is explicit —
// Python reads db["platform_apikeys"] directly.
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
