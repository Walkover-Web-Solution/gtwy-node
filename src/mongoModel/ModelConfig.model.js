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
    status: { type: Number, default: 1 }
  },
  { strict: true }
);

ConfigurationSchema.index({ model_name: 1, service: 1 }, { unique: true });
const ModelsConfigModel = mongoose.model("modelConfiguration", ConfigurationSchema);
export default ModelsConfigModel;
