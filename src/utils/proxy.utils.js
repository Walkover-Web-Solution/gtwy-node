import axios from "axios";
import { generateIdentifier } from "../services/utils/utility.service.js";
import { createOrFindUserAndCompany } from "../services/proxy.service.js";
import { findInCache, storeInCache, deleteInCache } from "../cache_service/index.js";
import { embed_cache } from "../configs/constant.js";

async function getallOrgs() {
  try {
    const response = await axios.get(`https://routes.msg91.com/api/${process.env.PUBLIC_REFERENCEID}/getCompanies?itemsPerPage=17321`, {
      headers: {
        authkey: process.env.ADMIN_API_KEY
      }
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching organizations:", error.message);
    return [];
  }
}

const createOrGetUser = async (checkToken, decodedToken, orgTokenFromDb) => {
  const cacheKeyUser = embed_cache.keys.user(decodedToken.user_id, decodedToken.org_id);
  const cachedUser = await findInCache(cacheKeyUser);

  if (cachedUser) {
    try {
      return JSON.parse(cachedUser);
    } catch {
      await deleteInCache(cacheKeyUser);
    }
  }
  const userDetails = {
    name: generateIdentifier(14, "emb", false),
    email: `${decodedToken.org_id}${checkToken.user_id}@gtwy.ai`,
    meta: { type: "embed" }
  };
  const orgDetials = {
    name: orgTokenFromDb?.name,
    is_readable: true,
    meta: {
      status: "2" // here 2 indicates that user is guest in this org and on visiting viasocket normally, this org should not be visible to users whose status is '2' with the org.
    }
  };
  const proxyObject = {
    feature_id: process.env.PUBLIC_REFERENCEID,
    Cuser: userDetails,
    company: orgDetials,
    role_id: process.env.PROXY_USER_ROLE_ID
  };
  const proxyResponse = await createOrFindUserAndCompany(proxyObject); // proxy api call
  const result = { proxyResponse, name: userDetails.name, email: userDetails.email };
  await storeInCache(cacheKeyUser, result);
  return result;
};

export { getallOrgs, createOrGetUser };
