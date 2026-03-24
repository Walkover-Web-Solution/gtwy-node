import mongoose from "mongoose";

const ApikeyCredentials = new mongoose.Schema({
  org_id: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  service: {
    type: String,
    required: true
  },
  apikey: {
    type: String,
    required: true
  },
  folder_id: {
    type: String,
    default: ""
  },
  user_id: {
    type: String,
    default: ""
  },
  bridge_ids: {
    type: [String],
    default: () => []
  },
  version_ids: {
    type: [String],
    default: () => []
  },
  apikey_limit: {
    type: Number,
    default: 0
  },
  apikey_usage: {
    type: Number,
    default: 0
  },
  apikey_limit_reset_period: {
    type: String,
    enum: ["monthly", "weekly", "daily"],
    default: "monthly"
  },
  apikey_limit_start_date: {
    type: Date,
    default: Date.now
  },
  last_used: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    default: null
  }
});

ApikeyCredentials.index({ name: 1, org_id: 1, folder_id: 1 }, { unique: true });

const ApikeyCredential = mongoose.model("ApikeyCredentials", ApikeyCredentials);
export default ApikeyCredential;
