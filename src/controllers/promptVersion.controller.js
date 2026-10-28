import promptVersionDbService from "../db_services/promptVersion.service.js";

const listPromptVersions = async (req, res, next) => {
  const { bridge_id } = req.params;
  const { version_id, page, limit } = req.query;
  const org_id = String(req.profile.org.id);

  const { prompt_versions, total } = await promptVersionDbService.listPromptVersions({ org_id, bridge_id, version_id, page, limit });

  res.locals = {
    success: true,
    message: "Prompt versions fetched successfully",
    prompt_versions,
    total,
    page,
    limit
  };
  req.statusCode = 200;
  return next();
};

export default {
  listPromptVersions
};
