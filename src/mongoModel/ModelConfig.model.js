import mongoose from "mongoose";

const ConfigurationSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      required: true
    },
    model_name: {
      type: String,
      required: true
    },
    configuration: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    outputConfig: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    validationConfig: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    status: { type: Number, default: 1 },
    disabled_at: { type: Date, default: null },
    display_name: { type: String, required: false },
    org_id: { type: String, required: false },
    // Usable on the free plan (wallet-paid runs). Python reads it live via
    // model_config_document; flipped per model from the admin API.
    free_tier: { type: Boolean, default: false }
  },
  { strict: true }
);

ConfigurationSchema.index({ model_name: 1, service: 1 }, { unique: true });
ConfigurationSchema.index({ disabled_at: 1 }, { expireAfterSeconds: 2592000, partialFilterExpression: { status: 0 } }); // Deletes after 30 Days if status is 0
const ModelsConfigModel = mongoose.model("modelConfiguration", ConfigurationSchema);
export default ModelsConfigModel;
