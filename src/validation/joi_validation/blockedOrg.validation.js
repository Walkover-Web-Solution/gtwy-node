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
    // Optional; another org than the caller's is allowed for internal staff only
    org_id: Joi.string(),
    user_id: Joi.string().required(),
    reason: Joi.string().allow(null, "")
  })
};

const unblockUser = {
  params: Joi.object().keys({
    user_id: Joi.string().required()
  }),
  query: Joi.object().keys({
    org_id: Joi.string()
  })
};

const listBlockedUsers = {
  query: Joi.object().keys({
    org_id: Joi.string()
  })
};

export default { blockOrg, unblockOrg, blockUser, unblockUser, listBlockedUsers };
