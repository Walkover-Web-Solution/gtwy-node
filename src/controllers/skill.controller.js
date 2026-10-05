import skillService from "../services/skill.service.js";

// Thin pass-through to the upstream skill service; the service throws ApiError on failure.

// Identity for the signed token, taken from the verified session.
const getAuth = (req) => ({
  userId: req.profile?.user?.id,
  orgId: req.profile?.org?.id
});

const getAllSkills = async (req, res, next) => {
  const skills = await skillService.listSkills(getAuth(req));

  res.locals = {
    success: true,
    message: "Get all skills of a org successfully",
    data: skills
  };
  req.statusCode = 200;
  return next();
};

const getSkill = async (req, res, next) => {
  const { skill_id } = req.params;
  const skill = await skillService.getSkill(skill_id, getAuth(req));

  res.locals = {
    success: true,
    message: "Skill fetched successfully",
    data: skill
  };
  req.statusCode = 200;
  return next();
};

const createSkill = async (req, res, next) => {
  const skill = await skillService.createSkill(req.body, getAuth(req));

  res.locals = {
    success: true,
    message: "Skill created successfully",
    data: skill
  };
  req.statusCode = 200;
  return next();
};

const updateSkill = async (req, res, next) => {
  const { skill_id } = req.params;
  const skill = await skillService.updateSkill(skill_id, req.body, getAuth(req));

  res.locals = {
    success: true,
    message: "Skill updated successfully",
    data: skill
  };
  req.statusCode = 200;
  return next();
};

const deleteSkill = async (req, res, next) => {
  const { skill_id } = req.params;
  const result = await skillService.deleteSkill(skill_id, getAuth(req));

  res.locals = {
    success: true,
    message: "Skill deleted successfully",
    data: result
  };
  req.statusCode = 200;
  return next();
};

export default {
  getAllSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill
};
