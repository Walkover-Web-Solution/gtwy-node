import ConfigurationServices from "../db_services/configuration.service.js";
import folderService from "../db_services/folder.service.js";
import FolderModel from "../mongoModel/GtwyEmbed.model.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import { createProxyToken, getOrganizationById, updateOrganizationData } from "../services/proxy.service.js";
import { generateIdentifier } from "../services/utils/utility.service.js";
import { cleanupCache } from "../services/utils/redis.utils.js";
import { deleteInCache, findInCache } from "../cache_service/index.js";
import { cost_types, redis_keys, embed_cache } from "../configs/constant.js";
import { generateAuthToken } from "../services/utils/utility.service.js";
import jwt from "jsonwebtoken";

const embedLogin = async (req, res) => {
  const { name: embeduser_name, email: embeduser_email } = req.Embed;
  const embedDetails = {
    user_id: req.Embed.user_id,
    company_id: req?.Embed?.org_id,
    company_name: req.Embed.org_name,
    tokenType: "embed",
    embeduser_name,
    embeduser_email,
    folder_id: req.Embed.folder_id
  };
  const Tokendata = {
    user: {
      id: req.Embed.user_id,
      name: embeduser_name,
      email: embeduser_email,
      meta: {
        type: "embed"
      }
    },
    org: {
      id: req.Embed.org_id,
      name: req.Embed.org_name
    },
    extraDetails: {
      type: "embed",
      folder_id: req.Embed.folder_id
    }
  };

  const [folder] = await Promise.all([folderService.getFolderData(req.Embed.folder_id), createProxyToken(embedDetails)]);

  const config = folder?.config || {};
  const apikey_object_id = folder?.apikey_object_id;
  const response = {
    ...req?.Embed,
    user_id: req.Embed.user_id,
    token: generateAuthToken(Tokendata.user, Tokendata.org, { extraDetails: Tokendata.extraDetails }),
    config: { ...config, apikey_object_id }
  };
  return res.status(200).json({ data: response, message: "logged in successfully" });
};

const createEmbed = async (req, res, next) => {
  try {
    const {
      name,
      config,
      apikey_object_id,
      folder_limit,
      folder_limit_reset_period,
      folder_limit_start_date,
      type,
      tools_id,
      pre_tool_id,
      variables_path
    } = req.body;
    const org_id = req.profile.org.id;
    const folder_type = type ? type : "embed";

    const folderConfig = {
      ...config,
      ...(tools_id && { tools_id }),
      ...(pre_tool_id && { pre_tool_id }),
      ...(variables_path && { variables_path })
    };

    const folder = await FolderModel.create({
      name,
      org_id,
      type: folder_type,
      config: folderConfig,
      apikey_object_id,
      folder_limit,
      folder_limit_reset_period,
      folder_limit_start_date
    });
    res.locals = { data: { ...folder.toObject(), folder_id: folder._id } };
    req.statusCode = 200;
    return next();
  } catch (e) {
    res.locals = { success: false, message: "Error in creating embed: " + e.message };
    req.statusCode = 400;
    return next();
  }
};

const getAllEmbed = async (req, res, next) => {
  const org_id = req.profile.org.id;
  const data = await FolderModel.find({ org_id });

  const foldersWithUsage = await Promise.all(
    data.map(async (folder) => {
      const folderObject = folder.toObject();
      const folderId = folder._id.toString();

      let folder_usage = folderObject.folder_usage;
      const cacheKey = `${redis_keys.folderusedcost_}${folderId}`;
      const cachedValue = await findInCache(cacheKey);

      if (cachedValue) {
        const parsed = JSON.parse(cachedValue);
        folder_usage = parsed.usage_value;
      }

      return { ...folderObject, folder_id: folder._id, folder_usage };
    })
  );

  res.locals = { data: foldersWithUsage };
  req.statusCode = 200;
  return next();
};

const updateEmbed = async (req, res, next) => {
  try {
    const {
      folder_id,
      config,
      apikey_object_id,
      folder_limit,
      folder_usage,
      folder_limit_reset_period,
      variables_path,
      tools_id,
      pre_tool_id,
      name
    } = req.body;
    const org_id = req.profile.org.id;

    const folder = await FolderModel.findOne({ _id: folder_id, org_id });
    if (!folder) {
      res.locals = { success: false, message: "Folder not found" };
      req.statusCode = 404;
      return next();
    }

    // Find all bridge objects using folder_id and delete from cache
    const bridgeObjects = await configurationModel.find({ folder_id: folder_id });
    if (bridgeObjects?.length > 0) {
      for (const bridgeObject of bridgeObjects) {
        // Delete cache using object id
        await deleteInCache(bridgeObject._id.toString());

        // Delete cache for all version_ids for this object
        // Access versions from _doc since direct access returns undefined
        const versionIds = bridgeObject._doc?.versions;
        if (versionIds?.length > 0) {
          await deleteInCache(versionIds);
        }
      }
    }

    const updatedConfig = {
      ...config,
      ...(tools_id !== undefined && { tools_id }),
      ...(pre_tool_id !== undefined && { pre_tool_id }),
      ...(variables_path !== undefined && { variables_path })
    };

    folder.config = updatedConfig;
    folder.apikey_object_id = apikey_object_id;
    if (folder_limit >= 0) {
      folder.folder_limit = folder_limit;
    }
    if (folder_usage == 0) {
      folder.folder_usage = 0;
    }
    if (folder_limit_reset_period) {
      folder.folder_limit_reset_period = folder_limit_reset_period;
      folder.folder_limit_start_date = new Date();
    }
    if (name) {
      folder.name = name;
    }
    await folder.save();
    await cleanupCache(cost_types.folder, folder_id, org_id);
    if (folder_usage == 0) {
      await deleteInCache(`${redis_keys.folderusedcost_}${folder_id}`);
    }
    await deleteInCache(embed_cache.keys.folder(folder_id));
    res.locals = { data: { ...folder.toObject(), folder_id: folder._id } };
    req.statusCode = 200;
    return next();
  } catch (e) {
    res.locals = { success: false, message: "Error in updating embed: " + e.message };
    req.statusCode = 400;
    return next();
  }
};

const genrateToken = async (req, res, next) => {
  let gtwyAccessToken;
  const data = await getOrganizationById(req.profile.org.id);
  gtwyAccessToken = data?.meta?.gtwyAccessToken;
  if (!gtwyAccessToken) {
    gtwyAccessToken = generateIdentifier(32);
    await updateOrganizationData(req.profile.org.id, {
      meta: {
        ...data?.meta,
        gtwyAccessToken
      }
    });
  }

  const { folder_id, user_id, type } = req.body;
  let embedToken = null;

  if (type === "embed_preview" && folder_id && user_id) {
    const payload = {
      org_id: req.profile.org.id,
      folder_id,
      user_id
    };
    // Sign with HS256 using gtwyAccessToken as secret
    embedToken = jwt.sign(payload, gtwyAccessToken, { algorithm: "HS256" });
  } else if (type === "rag_embed_preview" && folder_id && user_id) {
    const payload = {
      org_id: req.profile.org.id,
      folder_id,
      user_id
    };

    // Sign with HS256 using auth_token as secret
    const auth_token = data?.meta?.auth_token;
    if (auth_token) {
      embedToken = jwt.sign(payload, auth_token, { algorithm: "HS256" });
    }
  } else if (type === "chatbot_embed_preview" && folder_id && user_id) {
    const payload = {
      org_id: req.profile.org.id,
      chatbot_id: folder_id,
      user_id
    };
    const orgAccessToken = data?.meta?.orgAccessToken;
    if (orgAccessToken) {
      embedToken = jwt.sign(payload, orgAccessToken, { algorithm: "HS256" });
    }
  }

  res.locals = { embedToken, gtwyAccessToken };
  req.statusCode = 200;
  return next();
};

const getEmbedDataByUserId = async (req, res, next) => {
  try {
    const user_id = req.profile.user.id;
    const org_id = req.profile.org.id;
    const { agent_id } = req.query;

    const data = await ConfigurationServices.getAgentsByUserId(org_id, user_id, agent_id);

    res.locals = {
      success: true,
      message: "Get Agents data successfully",
      data
    };

    req.statusCode = 200;
    return next();
  } catch (e) {
    res.locals = { success: false, message: "Error in getting embed data: " + e.message };
    req.statusCode = 400;
    return next();
  }
};
const updateAgentMetadataController = async (req, res, next) => {
  try {
    const { agent_id } = req.params;
    const org_id = String(req.profile.org.id);
    const { name, meta } = req.body;

    const agent = await ConfigurationServices.getAgentsWithTools(agent_id, org_id);
    if (!agent.bridges) {
      res.locals = { success: false, message: "Agent not found" };
      req.statusCode = 404;
      return next();
    }

    const update_fields = { updatedAt: new Date() };
    if (name !== undefined) update_fields.name = name;
    if (meta !== undefined) update_fields.meta = meta;

    await ConfigurationServices.updateAgent(agent_id, update_fields);

    res.locals = {
      success: true,
      message: "Agent metadata updated successfully",
      agent: { ...agent.bridges, ...update_fields }
    };
    req.statusCode = 200;
    return next();
  } catch (e) {
    res.locals = { success: false, message: e.message };
    req.statusCode = 400;
    return next();
  }
};

export default {
  embedLogin,
  createEmbed,
  getAllEmbed,
  genrateToken,
  updateEmbed,
  getEmbedDataByUserId,
  updateAgentMetadataController
};
