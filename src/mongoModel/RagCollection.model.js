import mongoose from "mongoose";
import { cacheInvalidationPlugin } from "../cache_service/mongoosePlugin.js";
import { invalidateByTag } from "../cache_service/index.js";
import { tag_keys } from "../configs/tagKeys.js";

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

// Tag id is resource_id, not _id. Bust on $pull (remove) and on delete (iterate doc).
ragCollectionSchema.plugin(cacheInvalidationPlugin, {
  invalidate: (doc, ctx) => {
    const bust = (rid) => {
      if (rid) invalidateByTag(tag_keys.rag, rid).catch((e) => console.error("invalidateByTag(rag) failed:", e));
    };
    if (ctx?.op === "findOneAndDelete" || ctx?.op === "deleteOne" || ctx?.op === "deleteMany") {
      for (const rid of doc?.resource_ids || []) bust(rid);
      return;
    }
    const pulled = ctx?.update?.$pull?.resource_ids;
    if (pulled === undefined) return;
    if (Array.isArray(pulled)) for (const rid of pulled) bust(rid);
    else bust(pulled);
  }
});

const RagCollectionModel = mongoose.model("rag_collections", ragCollectionSchema);

export default RagCollectionModel;
