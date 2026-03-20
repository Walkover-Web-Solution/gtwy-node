import { findInCache, storeInCache } from "../../cache_service/index.js";
import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { sendResponse } from "../utils/utility.service.js";
import { bridge_ids } from "../../configs/constant.js";
import Thread from "../../mongoModel/Thread.model.js";
import logger from "../../logger.js";

async function saveSubThreadIdAndName({ thread_id, sub_thread_id, org_id, thread_flag, response_format, bridge_id, user }) {
  try {
    const cache_key = `sub_thread_${org_id}_${bridge_id}_${thread_id}_${sub_thread_id}`;

    const cached_result = await findInCache(cache_key);
    if (cached_result) {
      logger.info(`Found cached sub_thread_id for key: ${cache_key}`);
      return;
    }

    const variables = { user };
    let display_name = sub_thread_id;
    const current_time = new Date();

    if (thread_flag) {
      display_name = await callAiMiddleware("generate description", bridge_ids.generate_description, variables, null, "text");
    }

    await Thread.findOneAndUpdate(
      { org_id, thread_id, sub_thread_id },
      {
        $set: { bridge_id, display_name: display_name || sub_thread_id },
        $setOnInsert: { org_id, thread_id, sub_thread_id, created_at: current_time }
      },
      { upsert: true }
    );

    const cache_data = {
      org_id,
      bridge_id,
      thread_id,
      sub_thread_id,
      display_name,
      created_at: current_time.toISOString()
    };
    await storeInCache(cache_key, cache_data, 172800); // 48 hours

    if (display_name && display_name !== sub_thread_id) {
      const response = {
        data: {
          display_name,
          sub_thread_id,
          thread_id,
          bridge_id,
          created_at: current_time.toISOString()
        }
      };
      await sendResponse(response_format, response);
    }
  } catch (err) {
    logger.error(`Error in saving sub thread id and name: ${err.message}`);
  }
}

export { saveSubThreadIdAndName };
