import mongoose from "mongoose";

const agentMemorySchema = new mongoose.Schema({
  resource_id: { type: String, required: true, index: true },
  agent_id: { type: String, required: true, index: true },
  canonical_question: { type: String, required: true },
  original_answer: { type: String, default: null },
  frequency: { type: Number, default: 1 },
  created_at: { type: Date, default: Date.now },
  last_seen: { type: Date, default: Date.now }
});

// Create compound index for efficient lookups
agentMemorySchema.index({ agent_id: 1, resource_id: 1 });

const AgentMemory = mongoose.models.AgentMemory || mongoose.model("AgentMemory", agentMemorySchema, "agent_memories");

export default AgentMemory;
