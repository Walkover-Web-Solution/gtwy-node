import mongoose from "mongoose";

const fieldValueSchema = new mongoose.Schema(
  {
    description: { type: String, default: "" },
    type: { type: String, default: "string" },
    enum: { type: [String], default: () => [] },
    items: { type: mongoose.Schema.Types.Mixed, default: undefined },
    required: { type: [String], default: () => [] },
    properties: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
  },
  { _id: false }
);

const apiCall = new mongoose.Schema(
  {
    org_id: {
      type: String,
      required: true
    },
    bridge_ids: {
      type: [String],
      default: () => []
    },
    version_ids: {
      type: [String],
      default: () => []
    },
    script_id: {
      type: String,
      required: true
    },
    fields: {
      type: Map,
      of: fieldValueSchema,
      default: () => ({})
    },
    old_fields: {
      type: Map,
      of: fieldValueSchema,
      default: () => ({})
    },
    required: {
      type: [String],
      default: () => []
    },
    description: {
      type: String,
      default: ""
    },
    title: {
      type: String,
      default: ""
    },
    folder_id: {
      type: String,
      default: ""
    },
    user_id: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);
apiCall.index({ org_id: 1, script_id: 1 });

const apiCallModel = mongoose.model("apicall", apiCall);
export default apiCallModel;
