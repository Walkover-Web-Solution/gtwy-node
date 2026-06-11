import folderService from "../db_services/folder.service.js";

const createFolderController = async (req, res, next) => {
  const { name, config, type } = req.body;
  const org_id = req.profile.org.id;

  const folder = await folderService.createFolder({
    name,
    org_id,
    config,
    type
  });

  res.locals = { success: true, data: { ...folder.toObject(), folder_id: folder._id } };
  req.statusCode = 200;
  return next();
};

const getAllFoldersController = async (req, res, next) => {
  const org_id = req.profile.org.id;
  const folders = await folderService.getAllFolders(org_id);

  res.locals = { success: true, data: folders };
  req.statusCode = 200;
  return next();
};

const updateFolderController = async (req, res, next) => {
  const { folder_id, name, config, type } = req.body;
  const org_id = req.profile.org.id;

  const folder = await folderService.updateFolder(folder_id, org_id, {
    name,
    config,
    type
  });

  res.locals = { success: true, data: { ...folder.toObject(), folder_id: folder._id } };
  req.statusCode = 200;
  return next();
};

const deleteFolderController = async (req, res, next) => {
  const org_id = req.profile.org.id;
  const { folder_id } = req.params;

  await folderService.deleteFolder(folder_id, org_id);

  res.locals = { success: true, message: "Folder deleted successfully" };
  req.statusCode = 200;
  return next();
};

export default {
  createFolderController,
  getAllFoldersController,
  updateFolderController,
  deleteFolderController
};
