import ServiceModel from "../mongoModel/Service.model.js";

const serviceExists = async (service_name) => {
  return !!(await ServiceModel.exists({ service_name }));
};

const createService = async (serviceData) => {
  const service = new ServiceModel(serviceData);
  const result = await service.save();
  return result.toObject();
};

export default { serviceExists, createService };
