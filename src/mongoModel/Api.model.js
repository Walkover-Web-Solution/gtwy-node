import mongoose from "mongoose";
const ApikeyCredentials = new mongoose.Schema({
  org_id: {
    type: String,
    default: ""
  },
  name: {
    type: String,
    default: ""
  },
  service: {
    type: String,
    default: ""
  },
  apikey: {
    type: String,
    default: ""
  },
  comment: {
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
  },
  version_ids: {
    type: Array,
    default: []
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
    default: null
  },
  last_used: {
    type: Date,
    default: null
  }
});
ApikeyCredentials.index({ name: 1, org_id: 1, folder_id: 1 }, { unique: true });
const ApikeyCredential = mongoose.model("ApikeyCredentials", ApikeyCredentials);
export default ApikeyCredential;
