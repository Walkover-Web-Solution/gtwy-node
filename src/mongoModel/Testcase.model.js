import mongoose from "mongoose";

const testcaseSchema = new mongoose.Schema({
  bridge_id: {
    type: String,
    required: true
  },
  conversation: {
    type: Array,
    default: []
  },
  type: {
    type: String,
    enum: ["function", "response"],
    required: true
  },
  expected: {
    type: Object,
    required: true
  },
  matching_type: {
    type: String,
    enum: ["exact", "ai", "cosine"],
    required: true
  },
  variables: {
    type: Object,
    default: {}
  },
  execution: {
    lastExecutedAt: {
      type: Date,
      default: null
    }
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const testcaseModel = mongoose.model("testcases", testcaseSchema);

export default testcaseModel;
