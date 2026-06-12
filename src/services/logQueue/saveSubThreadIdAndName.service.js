import { findInCache, storeInCache, deleteInCache } from "../../cache_service/index.js";
import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { sendResponse } from "../utils/utility.service.js";
import { bridge_ids } from "../../configs/constant.js";
import models from "../../../models/index.js";
import logger from "../../logger.js";

/**
 * Resolve the display name for a sub-thread (cache -> pending name -> AI generation).
 * Returns the resolved display_name, or null when it equals the default (sub_thread_id) —
 * callers stamp the returned value onto conversation_logs rows before insert.
 */
async function saveSubThreadIdAndName({ thread_id, sub_thread_id, org_id, thread_flag, response_format, bridge_id, user }) {
  const cache_key = `sub_thread_${org_id}_${bridge_id}_${thread_id}_${sub_thread_id}`;

  // Cache hit -> name already resolved on a previous message
  try {
    const cached = await findInCache(cache_key);
    if (cached) {
      const parsed = JSON.parse(cached);
      const cachedName = parsed?.display_name;
      return cachedName && cachedName !== sub_thread_id ? cachedName : null;
    }
  } catch (err) {
    logger.error(`Cache lookup failed for ${cache_key}: ${err.message}`);
  }

  const current_time = new Date();
  let display_name = sub_thread_id;

  // Name pre-chosen via POST /api/thread before the first message (key has no bridge_id —
  // the create endpoints don't know it)
  const pending_key = `sub_thread_pending_${org_id}_${thread_id}_${sub_thread_id}`;
  try {
    const pending = await findInCache(pending_key);
    if (pending) {
      const pendingName = JSON.parse(pending);
      if (pendingName && typeof pendingName === "string" && pendingName !== sub_thread_id) {
        display_name = pendingName;
      }
      await deleteInCache(pending_key);
    }
  } catch (err) {
    logger.error(`Pending name lookup failed for ${pending_key}: ${err.message}`);
  }

  if (display_name === sub_thread_id && thread_flag) {
    try {
      const generated = await callAiMiddleware("generate description", bridge_ids.generate_description, { user }, null, "text");
      if (generated && generated !== sub_thread_id) {
        display_name = generated;
      }
    } catch (err) {
      logger.error(`Display-name generation failed for ${sub_thread_id}: ${err.message}`);
    }
  }

  // Persist non-default names on rows already inserted for this sub-thread
  // (orchestrator/batch paths can insert before the name is resolved)
  if (display_name !== sub_thread_id) {
    try {
      await models.pg.conversation_logs.update({ display_name }, { where: { org_id, bridge_id, thread_id, sub_thread_id } });
    } catch (err) {
      logger.error(`display_name update failed for sub_thread ${sub_thread_id}: ${err.message}`);
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

  return display_name !== sub_thread_id ? display_name : null;
}

export { saveSubThreadIdAndName };
