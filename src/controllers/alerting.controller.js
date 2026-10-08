import alertingDbservices from "../db_services/alerting.service.js";
import { removeLegacyAlert, syncLegacyAlert } from "../services/notifications/legacyAlerts.service.js";

async function createAlert(req, res, next) {
  const org_id = req.profile?.org?.id;
  const { webhookConfiguration, name, bridges, alertType, limit } = req.body;

  res.locals = await alertingDbservices.create({
    org_id,
    webhookConfiguration,
    name,
    bridges,
    alertType,
    limit
  });
  // Mirror into notification channels + rules while both alert systems run.
  await syncLegacyAlert(res.locals);
  req.statusCode = 201;
  return next();
}

async function getAllAlerts(req, res, next) {
  const org_id = req.profile?.org?.id;

  const alerts = await alertingDbservices.getAll(org_id);
  if (alerts.success) {
    res.locals = {
      success: true,
      data: alerts.data
    };
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      message: alerts.error || "No alerts found"
    };
    req.statusCode = 404;
    return next();
  }
}

async function deleteAlert(req, res, next) {
  const { id } = req.body;

  const result = await alertingDbservices.deleteAlert(id);
  if (result.success) await removeLegacyAlert(id, req.profile?.org?.id);

  if (!result.success) {
    res.locals = {
      success: false,
      message: result.error || "Alert not found"
    };
    req.statusCode = 404;
    return next();
  }

  res.locals = {
    success: true,
    message: "Alert successfully deleted"
  };
  req.statusCode = 200;
  return next();
}

async function updateAlert(req, res, next) {
  const { id } = req.params;
  const { webhookConfiguration, bridges, name, alertType } = req.body;

  const alertData = await alertingDbservices.getById(id);
  if (!alertData.success) {
    res.locals = {
      success: false,
      message: "Alert not found"
    };
    req.statusCode = 404;
    return next();
  }

  let alert = alertData.data;
  if (name) {
    alert.name = name;
  }
  if (webhookConfiguration) {
    const { url, headers } = webhookConfiguration;
    if (url) {
      alert.webhookConfiguration.url = url;
    }
    if (headers) {
      alert.webhookConfiguration.headers = headers;
    }
  }
  if (bridges) {
    alert.bridges = bridges;
  }
  if (alertType) {
    alert.alertType = alertType;
  }

  const updatedAlert = await alertingDbservices.updateAlert(id, alert);
  if (updatedAlert.success) {
    await syncLegacyAlert(updatedAlert.data);
    res.locals = updatedAlert;
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      message: updatedAlert.error || "Failed to update alert"
    };
    req.statusCode = 400;
    return next();
  }
}

export default {
  createAlert,
  getAllAlerts,
  deleteAlert,
  updateAlert
};
