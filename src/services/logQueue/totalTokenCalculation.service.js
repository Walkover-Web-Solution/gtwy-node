import configurationModel from "../../mongoModel/Configuration.model.js";
import logger from "../../logger.js";

async function totalTokenCalculation({ tokens, bridge_id }) {
  try {
    const new_tokens = (tokens?.inputTokens || 0) + (tokens?.outputTokens || 0);

    const bridge_data = await configurationModel.findOne({ _id: bridge_id }, { total_tokens: 1 }).lean();

    const current_total = bridge_data?.total_tokens || 0;
    const updated_total = current_total + new_tokens;

    await configurationModel.updateOne({ _id: bridge_id }, { $set: { total_tokens: updated_total } });
  } catch (err) {
    logger.error(`Error in totalTokenCalculation: ${err.message}`);
  }
}

export { totalTokenCalculation };
