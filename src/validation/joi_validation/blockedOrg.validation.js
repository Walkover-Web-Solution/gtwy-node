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

export default { blockOrg, unblockOrg };
