import Folder from "../mongoModel/GtwyEmbed.model.js";
import { embed_cache } from "../configs/constant.js";
import { findInCache, storeInCache, deleteInCache } from "../cache_service/index.js";

async function getFolderData(folder_id) {
  if (!folder_id) return null;

  const cacheKeyFolder = embed_cache.keys.folder(folder_id);
  const cachedFolder = await findInCache(cacheKeyFolder);

  if (cachedFolder) {
    try {
      return JSON.parse(cachedFolder);
    } catch {
      await deleteInCache(cacheKeyFolder);
    }
  }

  try {
    const folder = await Folder.findById(folder_id).lean();
    if (folder) {
      await storeInCache(cacheKeyFolder, folder);
    }
    return folder;
  } catch (error) {
    console.error("Error fetching folder data:", error);
    return null;
  }
}

export default {
  getFolderData
};
