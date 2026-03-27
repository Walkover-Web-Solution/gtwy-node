import ChatbotDbService from "../db_services/chatBot.service.js";
import configurationService from "../db_services/configuration.service.js";
import { getOrganizationById, updateOrganizationData } from "../services/proxy.service.js";
import token from "../services/commonService/generateToken.js";
import { generateIdentifier } from "../services/utils/utility.service.js";
import { generateToken } from "../services/utils/users.service.js";
import mongoose from "mongoose";

const getAllChatBots = async (req, res, next) => {
  const org_id = req.profile.org.id;
  const userId = req.profile.user.id;

  let chatbots = await ChatbotDbService.getAll(org_id);

  let defaultChatbot = chatbots.find((chatbot) => chatbot.type === "default");

  if (!defaultChatbot) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      defaultChatbot = await ChatbotDbService.create(
        {
          orgId: org_id,
          title: "Default Chatbot",
          type: "default",
          createdBy: userId,
          updatedBy: userId
        },
        session
      );
      await ChatbotDbService.create(
        {
          orgId: org_id,
          title: req.params.name || "chatbot1",
          type: "chatbot",
          createdBy: userId,
          updatedBy: userId
        },
        session
      );
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  chatbots = await ChatbotDbService.getAll(org_id);
  const orgData = (await getOrganizationById(org_id)) || {};
  let accessKey = orgData?.meta?.orgAccessToken;
  if (!accessKey) {
    accessKey = generateIdentifier(32);
    await updateOrganizationData(org_id, { meta: { ...(orgData?.meta || {}), orgAccessToken: accessKey } });
  }

  const chatbot_token = token.generateToken({
    payload: { org_id, chatbot_id: defaultChatbot.id, user_id: req.profile.user.id },
    accessKey: accessKey
  });

  // Filter out the default chatbot from the chatbots array
  const filteredChatbots = chatbots.filter((chatbot) => chatbot.type !== "default");

  res.locals = { result: { chatbots: filteredChatbots }, chatbot_token };
  req.statusCode = 200;
  return next();
};

const getOneChatBot = async (req, res, next) => {
  const { botId } = req.params;

  const chatbot = await ChatbotDbService.getOne(botId);

  if (!chatbot) {
    res.locals = { success: false, message: "Chatbot not found" };
    req.statusCode = 404;
    return next();
  }

  res.locals = { success: true, chatbot };
  req.statusCode = 200;
  return next();
};

const updateChatBotConfig = async (req, res, next) => {
  const { botId } = req.params;
  const { config } = req.body;

  const chatBotData = await ChatbotDbService.updateChatbotConfig(botId, config);

  if (!chatBotData) {
    res.locals = { success: false, message: "Chatbot not found" };
    req.statusCode = 404;
    return next();
  }

  res.locals = chatBotData;
  req.statusCode = 200;
  return next();
};

const loginUser = async (req, res, next) => {
  // {'userId': user_id, "userEmail": user_email, 'ispublic': is_public}
  const { chatbot_id, user_id, org_id, variables, ispublic } = req.chatBot;
  let chatBotConfig = {};

  if (ispublic) {
    const dataToSend = {
      config: {
        buttonName: "",
        height: "100",
        heightUnit: "%",
        width: "100",
        widthUnit: "%",
        type: "popup",
        themeColor: "#000000"
      },
      userId: req.chatBot.userId,
      token: `Bearer ${generateToken({ user_id: req.chatBot.userId, userEmail: req.chatBot.userEmail, org_id: "public", variables, ispublic })}`,
      chatbot_id: "Public_Agents"
    };
    res.locals = { data: dataToSend, success: true };
    req.statusCode = 200;
    return next();
  }

  if (chatbot_id) {
    const configResult = await ChatbotDbService.getChatBotConfig(chatbot_id);

    if (!configResult) {
      res.locals = { success: false, message: "Chatbot not found" };
      req.statusCode = 404;
      return next();
    }
    chatBotConfig = configResult;
  }

  if (!chatBotConfig || chatBotConfig.orgId !== org_id?.toString()) {
    res.locals = { success: false, message: "chat bot id is not valid" };
    req.statusCode = 401;
    return next();
  }

  const dataToSend = {
    config: chatBotConfig.config,
    userId: user_id,
    token: `Bearer ${generateToken({ user_id, org_id, variables })}`,
    chatbot_id
  };
  res.locals = { data: dataToSend, success: true };
  req.statusCode = 200;
  return next();
};

const createOrgToken = async (req, res, next) => {
  const orgId = req.profile.org.id;
  const orgData = await getOrganizationById(orgId);
  let orgAccessToken = orgData?.meta?.orgAccessToken;
  if (!orgAccessToken) {
    orgAccessToken = generateIdentifier(32);
    await updateOrganizationData(orgId, { meta: { ...(orgData?.meta || {}), orgAccessToken } });
  }
  res.locals = { orgAccessToken };
  req.statusCode = 200;
  return next();
};

const addorRemoveBridgeInChatBot = async (req, res, next) => {
  const { botId, agentId, action } = req.body;

  // Check if chatbot exists
  const existingChatbot = await ChatbotDbService.findById(botId);
  if (!existingChatbot) {
    res.locals = { success: false, message: "Chatbot not found" };
    req.statusCode = 404;
    return next();
  }

  // Perform add or remove operation
  let updatedChatBot;
  if (action === "add") {
    updatedChatBot = await ChatbotDbService.addBridge(botId, agentId);
  } else {
    updatedChatBot = await ChatbotDbService.removeBridge(botId, agentId);
  }

  if (!updatedChatBot) {
    res.locals = { success: false, message: "Failed to update bridge association" };
    req.statusCode = 500;
    return next();
  }

  res.locals = {
    success: true,
    message: `Bridge ${action === "add" ? "added to" : "removed from"} chatbot successfully`,
    chatbot: updatedChatBot
  };
  req.statusCode = 200;
  return next();
};

const createOrRemoveAction = async (req, res) => {
  const { agentId } = req.params;
  const { type } = req.query;
  const { actionJson, version_id } = req.body;
  let { actionId } = req.body;
  if (type !== "remove" && !actionId)
    // add for create and update the action
    actionId = generateIdentifier(12);
  const response =
    type === "add"
      ? await configurationService.addActionInAgent(agentId, actionId, actionJson, version_id)
      : await configurationService.removeActionInAgent(agentId, actionId, version_id);
  // filterDataOfBridgeOnTheBaseOfUI({ bridges: response }, bridgeId, false);
  return res.status(200).json({ success: true, data: response });
};
export { getAllChatBots, getOneChatBot, updateChatBotConfig, loginUser, createOrgToken, addorRemoveBridgeInChatBot, createOrRemoveAction };
