import * as skillService from "../db_services/skill.service.js";

const createSkill = async (req, res, next) => {
  const { name, description, content, org_id, created_by } = req.body;

  const result = await skillService.createSkill({
    name,
    description,
    content,
    org_id,
    created_by
  });

  if (result.success) {
    res.locals = result;
    req.statusCode = 201;
    return next();
  } else {
    res.locals = {
      success: false,
      error: result.error
    };
    req.statusCode = 400;
    return next();
  }
};

const getSkillsByOrg = async (req, res, next) => {
  const { org_id } = req.query;

  const result = await skillService.getSkillsByOrg(org_id);

  if (result.success) {
    res.locals = result;
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      error: result.error
    };
    req.statusCode = 400;
    return next();
  }
};

const getSkillById = async (req, res, next) => {
  const { id } = req.params;
  const org_id = req.profile?.org?.id;

  const result = await skillService.getSkillById(id, org_id);

  if (result.success) {
    res.locals = result;
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      error: result.error
    };
    req.statusCode = 404;
    return next();
  }
};

const updateSkill = async (req, res, next) => {
  const { id } = req.params;
  const org_id = req.profile?.org?.id;
  const { name, description, content, updated_by } = req.body;

  const result = await skillService.updateSkill(id, org_id, {
    name,
    description,
    content,
    updated_by
  });

  if (result.success) {
    res.locals = result;
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      error: result.error
    };
    req.statusCode = 404;
    return next();
  }
};

const deleteSkill = async (req, res, next) => {
  const { id } = req.params;
  const org_id = req.profile?.org?.id;

  const result = await skillService.deleteSkill(id, org_id);

  if (result.success) {
    res.locals = result;
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      error: result.error
    };
    req.statusCode = 404;
    return next();
  }
};

export { createSkill, getSkillsByOrg, getSkillById, updateSkill, deleteSkill };
