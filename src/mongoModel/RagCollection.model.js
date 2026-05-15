import mongoose from "mongoose";

const ragCollectionSchema = new mongoose.Schema({
  collection_id: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  org_id: {
    type: String,
    required: true
  },
  resource_ids: {
    type: [String],
    default: []
  },
  settings: {
    denseModel: String,
    chunkSize: Number,
    chunkOverlap: Number,
    sparseModel: String,
    strategy: String,
    rerankerModel: String
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

ragCollectionSchema.index({ org_id: 1 });

const RagCollectionModel = mongoose.model("rag_collections", ragCollectionSchema);

export default RagCollectionModel;
