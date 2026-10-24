import Joi from "joi";

const blockOrg = {
  body: Joi.object().keys({
    org_id: Joi.string().required(),
    reason: Joi.string().allow(null, "")
  })
};

const unblockOrg = {
  params: Joi.object().keys({
    org_id: Joi.string().required()
  })
};

const blockUser = {
  body: Joi.object().keys({
    org_id: Joi.string().required(),
    user_id: Joi.string().required(),
    reason: Joi.string().allow(null, "")
  })
};

const unblockUser = {
  params: Joi.object().keys({
    org_id: Joi.string().required(),
    user_id: Joi.string().required()
  })
};

const listBlockedUsers = {
  query: Joi.object().keys({
    org_id: Joi.string()
  })
};

export default { blockOrg, unblockOrg, blockUser, unblockUser, listBlockedUsers };
