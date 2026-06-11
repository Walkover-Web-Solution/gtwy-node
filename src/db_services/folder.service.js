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

async function createFolder(folderData) {
  const { name, org_id, type = "agent", config = null } = folderData;
  const existingFolder = await Folder.findOne({
    org_id,
    name: { $regex: new RegExp(`^${name.trim()}$`, "i") }
  });
  if (existingFolder) {
    throw new Error("Folder name already exists");
  }
  const folder = await Folder.create({
    name,
    org_id,
    type,
    config
  });
  return folder;
}

async function updateFolder(folder_id, org_id, updateData) {
  const { name, config, type } = updateData;
  const folder = await Folder.findOne({ _id: folder_id, org_id });
  if (!folder) throw new Error("Folder not found");

  if (name !== undefined && name !== folder.name) {
    const existingFolder = await Folder.findOne({
      org_id,
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
      _id: { $ne: folder_id }
    });
    if (existingFolder) {
      throw new Error("Folder name already exists");
    }
    folder.name = name;
  }
  if (config !== undefined) folder.config = config;
  if (type !== undefined) folder.type = type;
  await folder.save();
  return folder;
}

async function deleteFolder(folder_id, org_id) {
  const folder = await Folder.findOne({ _id: folder_id, org_id });
  if (folder.type === "embed") {
    throw new Error("Cannot delete a folder of type 'embed'");
  }
  await Folder.deleteOne({ _id: folder_id, org_id });
  return { success: true };
}

async function getAllFolders(org_id) {
  const data = await Folder.find({ org_id, type: { $ne: "embed" } });
  return data;
}

async function getFolderIdsByOrgAndType(org_id, type) {
  const folders = await Folder.find({ org_id, type }, "_id").lean();
  return folders.map((folder) => folder._id.toString());
}

export default {
  getFolderData,
  createFolder,
  updateFolder,
  deleteFolder,
  getAllFolders,
  getFolderIdsByOrgAndType
};
