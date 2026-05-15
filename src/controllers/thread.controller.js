// controllers/threadController.js
import { createThread, getThreads } from "../services/thread.service.js";
import { ResponseSender } from "../services/utils/customResponse.utils.js";
import { generateIdentifier } from "../services/utils/utility.service.js";
import configurationService from "../db_services/configuration.service.js";
import conversationDbService from "../db_services/conversation.service.js";

const responseSender = new ResponseSender();

// Create a new thread
async function createSubThreadController(req, res, next) {
  const { org_id } = req.profile;
  const { name = "", thread_id, subThreadId } = req.body;

  const sub_thread_id = subThreadId || generateIdentifier();
  if (!thread_id || !org_id || !sub_thread_id) {
    throw new Error("All fields are required");
  }
  const thread = await createThread({
    display_name: name || sub_thread_id,
    thread_id,
    org_id: org_id.toString(),
    sub_thread_id
  });
  res.locals = {
    thread,
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

  const thread = await createThread({
    display_name: display_name || name || sub_thread_id,
    thread_id,
    org_id: org_id.toString(),
    sub_thread_id,
    created_at: Date.now()
  });
  res.locals = {
    thread,
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
  const threads = await getThreads(bridge_org_id, thread_id, bridge_id);

  // Sort threads by latest conversation activity from PostgreSQL
  const sortedThreads = await conversationDbService.sortThreadsByLatestActivity(threads, bridge_org_id, bridge_id);

  res.locals = { threads: sortedThreads, success: true };
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
