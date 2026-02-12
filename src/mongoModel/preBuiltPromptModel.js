import { object } from "joi";
import mongoose from "mongoose";

const preBuiltPromptSchema = new mongoose.Schema({
    org_id:{
        type:String,
        required:true
    },
    prebuilt_prompts: {
        type:object,
        default:{}
    }
});

const PreBuiltPromptModel = mongoose.model('PreBuiltPrompt', preBuiltPromptSchema);
export default PreBuiltPromptModel;
