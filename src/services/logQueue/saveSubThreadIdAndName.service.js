import { findInCache, storeInCache } from "../../cache_service/index.js";
import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { sendResponse } from "../utils/utility.service.js";
import { bridge_ids } from "../../configs/constant.js";
import Thread from "../../mongoModel/Thread.model.js";
import logger from "../../logger.js";

async function saveSubThreadIdAndName({ thread_id, sub_thread_id, org_id, thread_flag, response_format, bridge_id, user }) {
  const cache_key = `sub_thread_${org_id}_${bridge_id}_${thread_id}_${sub_thread_id}`;

  try {
    if (await findInCache(cache_key)) return;
  } catch (err) {
    logger.error(`Cache lookup failed for ${cache_key}: ${err.message}`);
  }

  const current_time = new Date();

  try {
    await Thread.findOneAndUpdate(
      { org_id, thread_id, sub_thread_id, bridge_id },
      {
        $set: { bridge_id },
        $setOnInsert: { org_id, thread_id, sub_thread_id, display_name: sub_thread_id, created_at: current_time }
      },
      { upsert: true }
    );
  } catch (err) {
    logger.error(`Mongo upsert failed for sub_thread ${sub_thread_id}: ${err.message}`);
    return;
  }

  let display_name = sub_thread_id;
  if (thread_flag) {
    try {
      const generated = await callAiMiddleware("generate description", bridge_ids.generate_description, { user }, null, "text");
      if (generated && generated !== sub_thread_id) {
        display_name = generated;
        await Thread.updateOne({ org_id, thread_id, sub_thread_id, bridge_id }, { $set: { display_name } });
      }
    } catch (err) {
      logger.error(`Display-name generation failed for ${sub_thread_id}: ${err.message}`);
    }
  }

  try {
    await storeInCache(cache_key, { org_id, bridge_id, thread_id, sub_thread_id, display_name, created_at: current_time.toISOString() }, 172800);
  } catch (err) {
    logger.error(`Cache store failed for ${cache_key}: ${err.message}`);
  }

  if (thread_flag && display_name !== sub_thread_id) {
    try {
      await sendResponse(response_format, {
        data: {
          display_name,
          sub_thread_id,
          thread_id,
          bridge_id,
          created_at: current_time.toISOString()
        }
      });
    } catch (err) {
      logger.error(`sendResponse failed for ${sub_thread_id}: ${err.message}`);
    }
  }
}

export { saveSubThreadIdAndName };
