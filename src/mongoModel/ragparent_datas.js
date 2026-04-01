import mongoose from "mongoose";

const ragParentDataSchema = new mongoose.Schema({
  name: {
    type: String,
    required: false,
  },
  description: {
    type: String,
    required: false,
  },
  org_id: {
    type: String,
    required: true,
  },
  content :{
    type : mongoose.Schema.Types.Mixed,
  },  
  user_id: {
    type: String,
    required: false,
  },
  source: {
    type: new mongoose.Schema(
      {
        url  :{
          type :String 
        },
        type: {
          type: String,
          enum: ["file", "url"],
          required: true,
        },
        fileFormat: {
          type: String, 
          enum: ['csv', 'txt', 'script', 'unknown'], 
          required: true
        },
        data: {
          type: Object,
          required: true,
        },
        scriptId: {
          type: String, 
          required: false
        }, 
        fileId: {
          type: String, 
          required: false
        }, 
        nesting: {
          level: {
            type: Number, 
            enum: [0, 1, 2], 
            default: 0
          }, 
          parentDocId : {
            type: mongoose.Schema.Types.ObjectId
          }, 
          enabled: {
            type: Boolean,
            default: true
          }
        }
      },
      { _id: false } // Prevents automatic _id generation for subdocument
    ),
    required: true,
  },
  chunking_type: {
    type: String,
    enum: ["semantic", "manual", "recursive", "agentic", "auto"],
    required: true,
    default: "semantic"
  },
  is_chunking_type_auto: {
    type: Boolean, 
    default: false
  }, 
  chunk_size: {
    type: Number,
    required: true,
    default:520
  },
  chunk_overlap: {
    type: Number,
    required: true,
    default: 50
  },
  created_at : {
    type: Date,
    default: Date.now
  }, 
  metadata: {
    type: Object,
    default: {}
  }, 
  refreshedAt: {
    type: Date, 
    required: false, 
    default: null
  },
  folder_id: {
    type: String,
    required: false,
    default: null
  }
});

ragParentDataSchema.index({ org_id: 1 });

const ragParentDataModel = mongoose.model("rag_parent_datas", ragParentDataSchema);

export default ragParentDataModel;
