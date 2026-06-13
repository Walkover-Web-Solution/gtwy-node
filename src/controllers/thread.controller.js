// controllers/threadController.js
import { ResponseSender } from "../services/utils/customResponse.utils.js";
import { generateIdentifier } from "../services/utils/utility.service.js";
import configurationService from "../db_services/configuration.service.js";
import conversationDbService from "../db_services/conversation.service.js";
import { storeInCache } from "../cache_service/index.js";
import { redis_keys } from "../configs/constant.js";

const responseSender = new ResponseSender();
const PENDING_NAME_TTL = 172800; // 2 days — consumed by saveSubThreadIdAndName on first message

// Stash a chosen display name until the first message lands in conversation_logs.
// The key has no bridge_id because these endpoints don't know it.
async function storePendingDisplayName(org_id, thread_id, sub_thread_id, display_name) {
  if (!display_name || display_name === sub_thread_id) return;
  await storeInCache(`${redis_keys.sub_thread_pending_}${org_id}_${thread_id}_${sub_thread_id}`, display_name, PENDING_NAME_TTL);
}

// Create a new thread
async function createSubThreadController(req, res, next) {
  const { org_id } = req.profile;
  const { name = "", thread_id, subThreadId } = req.body;

  const sub_thread_id = subThreadId || generateIdentifier();
  if (!thread_id || !org_id || !sub_thread_id) {
    throw new Error("All fields are required");
  }
  const display_name = name || sub_thread_id;
  await storePendingDisplayName(org_id.toString(), thread_id, sub_thread_id, display_name);

  res.locals = {
    thread: {
      thread_id,
      sub_thread_id,
      display_name,
      org_id: org_id.toString(),
      created_at: new Date()
    },
    success: true
  };
  req.statusCode = 201;
  return next();
}

async function createSubThreadWithAiController(req, res, next) {
  const { org_id, user_id } = req.profile;
  const { name = "", thread_id, subThreadId, user = "", botId } = req.body;

  const sub_thread_id = subThreadId || generateIdentifier();
  let display_name;
  if (!thread_id || !org_id || !sub_thread_id) {
    throw new Error("All fields are required");
  }
  if (name === "") {
    // api call to AI
    display_name = await createSubThreadNameAI({ user });
  }
  if (botId) {
    const channelId = `${botId}${thread_id.trim() ? thread_id.trim() : user_id}${sub_thread_id.trim() ? sub_thread_id.trim() : user_id}`.replace(
      " ",
      "_"
    );
    responseSender.sendResponse({
      rtlLayer: true,
      data: { display_name: display_name, threadId: thread_id, subThreadId: subThreadId, created_at: new Date() },

      reqBody: {
        rtlOptions: {
          channel: channelId,
          ttl: 1,
          apikey: process.env.RTLAYER_AUTH
        }
      },
      headers: {}
    });
  }

  const finalDisplayName = display_name || name || sub_thread_id;
  await storePendingDisplayName(org_id.toString(), thread_id, sub_thread_id, finalDisplayName);

  res.locals = {
    thread: {
      thread_id,
      sub_thread_id,
      display_name: finalDisplayName,
      org_id: org_id.toString(),
      created_at: new Date()
    },
    success: true
  };
  req.statusCode = 201;
  return next();
}

// Get all threads
async function getAllSubThreadController(req, res, next) {
  const { thread_id } = req.params;
  const { slugName } = req.query;

  const org_id = req?.profile?.org_id || req?.profile?.org?.id;
  const data = await configurationService.getAgentIdBySlugname(org_id, slugName);
  const bridge_id = data?._id?.toString();
  const bridge_org_id = req?.chatBot?.ispublic ? data?.org_id : org_id;

  // Single PG query: sub-threads with display names, ordered by latest activity
  const threads = await conversationDbService.getSubThreadsWithActivity(bridge_org_id, thread_id, bridge_id);

  res.locals = { threads, success: true };
  req.statusCode = 200;
  return next();
}

async function createSubThreadNameAI({ user }) {
  const response = await fetch("https://proxy.viasocket.com/proxy/api/1258584/29gjrmh24/api/v2/model/chat/completion", {
    method: "POST",
    headers: {
      pauthkey: "1b13a7a038ce616635899a239771044c",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      user: `Generate thread Name for ${user}`,
      bridge_id: "6799c8413166c2fc4886669a",
      response_type: "text"
    })
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || "Unknown error");
  }
  return data.response?.data?.content || "";
}

export { createSubThreadController, createSubThreadWithAiController, getAllSubThreadController };
