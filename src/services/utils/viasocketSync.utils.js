import axios from "axios";
import Helper from "./helper.utils.js";

const getViasocketEmbedToken = ({ org_id, folder_id = null, user_id = null, isEmbedUser = false }) => {
  let viasocket_embed_user_id = String(org_id);
  if (user_id && isEmbedUser && folder_id) {
    viasocket_embed_user_id = `${viasocket_embed_user_id}_${folder_id}_${user_id}`;
  }

  return Helper.generate_token(
    {
      org_id: process.env.ORG_ID,
      project_id: process.env.PROJECT_ID,
      user_id: viasocket_embed_user_id
    },
    process.env.ACCESS_KEY
  );
};

// Version document lookup removed — not needed when not sending static variables.

// Note: static variable extraction and sending removed intentionally.

const syncToolToViasocketEmbed = async (tool, org_id, tokenContext = {}) => {
  if (!tool?.script_id) {
    return { success: false, reason: "Missing script_id" };
  }
  const embedToken = getViasocketEmbedToken({ org_id, ...tokenContext });
  const url = `https://flow-api.viasocket.com/projects/updateflowembed/${tool.script_id}`;
  const payload = {
    AISchema: {
      properties: tool.fields || {},
      required: tool.required || tool.required_params || []
    }
  };
  const response = await axios.put(url, payload, {
    headers: {
      "Content-Type": "application/json",
      authorization: embedToken
    }
  });

  console.log(`Viasocket updateflowembed response for ${tool.script_id}:`, response?.data);

  return { success: true };
};

export { getViasocketEmbedToken, syncToolToViasocketEmbed };
