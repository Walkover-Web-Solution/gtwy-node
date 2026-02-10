import Joi from "joi";

const clearRedisCache = {
  body: Joi.object()
    .keys({
      id: Joi.string().optional(),
      ids: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional()
    })
    .unknown(true)
};

const getRedisCache = {
  params: Joi.object()
    .keys({
      id: Joi.string().required()
    })
    .unknown(true)
};

const callAi = {
  body: Joi.object()
    .keys({
      type: Joi.string()
        .valid("structured_output", "gpt_memory", "improve_prompt", "optimize_prompt", "generate_test_cases", "generate_summary", "generate_json")
        .required(),
      json_schema: Joi.alternatives().conditional("type", {
        is: "structured_output",
        then: Joi.alternatives().try(Joi.object(), Joi.string().allow("").optional()).optional(),
        otherwise: Joi.forbidden()
      }),
      query: Joi.alternatives().conditional("type", {
        switch: [
          { is: "structured_output", then: Joi.string().required() },
          { is: "optimize_prompt", then: Joi.string().optional() }
        ],
        otherwise: Joi.forbidden()
      }),
      thread_id: Joi.alternatives().conditional("type", {
        switch: [
          { is: "structured_output", then: Joi.string().optional() },
          { is: "gpt_memory", then: Joi.string().required() },
          { is: "optimize_prompt", then: Joi.string().optional() }
        ],
        otherwise: Joi.forbidden()
      }),
      bridge_id: Joi.alternatives().conditional("type", {
        switch: [
          { is: "gpt_memory", then: Joi.string().required() },
          { is: "optimize_prompt", then: Joi.string().required() },
          { is: "generate_test_cases", then: Joi.string().required() }
        ],
        otherwise: Joi.forbidden()
      }),
      sub_thread_id: Joi.alternatives().conditional("type", {
        is: "gpt_memory",
        then: Joi.string().required(),
        otherwise: Joi.forbidden()
      }),
      version_id: Joi.alternatives().conditional("type", {
        switch: [
          { is: "gpt_memory", then: Joi.string().optional() },
          { is: "optimize_prompt", then: Joi.string().optional() },
          { is: "generate_test_cases", then: Joi.string().optional() },
          { is: "generate_summary", then: Joi.string().optional() }
        ],
        otherwise: Joi.forbidden()
      }),
      variables: Joi.alternatives().conditional("type", {
        is: "improve_prompt",
        then: Joi.object().required(),
        otherwise: Joi.forbidden()
      }),
      example_json: Joi.alternatives().conditional("type", {
        is: "generate_json",
        then: Joi.alternatives().try(Joi.string(), Joi.object()).required(),
        otherwise: Joi.forbidden()
      })
    })
    .unknown(true)
};

const generateToken = {
  body: Joi.object()
    .keys({
      type: Joi.string().valid("rag", "org", "embed", "embed_preview", "rag_embed_preview").required()
    })
    .unknown(true)
};

export default {
  clearRedisCache,
  getRedisCache,
  callAi,
  generateToken
};
