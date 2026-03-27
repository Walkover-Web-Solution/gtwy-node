import AlertModel from "../mongoModel/Alerting.model.js";
async function get_webhook_data(org_id) {
  try {
    const webhook_data = await AlertModel.find({
      org_id: org_id
    });
    return {
      webhook_data: webhook_data || []
    };
  } catch (error) {
    throw new Error(`Error in get_webhook_data: ${error.message}`);
  }
}

export { get_webhook_data };
