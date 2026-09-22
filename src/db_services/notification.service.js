import NotificationModel from "../mongoModel/Notification.model.js";

function toResponseShape(doc, user_id) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    ...obj,
    read: (obj.read_by || []).includes(user_id)
  };
}

async function createNotification({ org_id, agent_id, type, title, message, data }) {
  const notification = await new NotificationModel({
    org_id: org_id || null,
    agent_id: agent_id || null,
    type,
    title,
    message,
    data: data || {}
  }).save();
  return notification;
}

async function getNotifications({ org_id, agent_id, scope, user_id, page = 1, limit = 20 }) {
  // A notification with org_id: null is a global broadcast — every org sees it
  // alongside its own, the same way agent_id: null is org-wide within an org.
  const query = { $or: [{ org_id: null }, { org_id }] };
  if (scope === "org") {
    // Strictly org-wide notifications (not tied to any specific agent).
    query.agent_id = null;
  } else if (agent_id) {
    query.agent_id = agent_id;
  }

  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    NotificationModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    NotificationModel.countDocuments(query),
    NotificationModel.countDocuments({ ...query, read_by: { $ne: user_id } })
  ]);

  return {
    data: notifications.map((n) => toResponseShape(n, user_id)),
    page,
    limit,
    total,
    unread_count: unreadCount
  };
}

async function markAsRead({ id, user_id, org_id }) {
  const notification = await NotificationModel.findOneAndUpdate(
    { _id: id, $or: [{ org_id: null }, { org_id }] },
    { $addToSet: { read_by: user_id } },
    { new: true }
  );
  if (!notification) {
    return { error: "notFound" };
  }
  return { data: toResponseShape(notification, user_id) };
}

async function markAllAsRead({ org_id, agent_id, user_id }) {
  const orgOr = { $or: [{ org_id: null }, { org_id }] };
  // Marking read for an agent view clears both that agent's notifications and the
  // org-wide ones (since the UI shows them merged); without an agent, only org-wide.
  const agentOr = { $or: agent_id ? [{ agent_id: null }, { agent_id }] : [{ agent_id: null }] };

  const result = await NotificationModel.updateMany({ $and: [orgOr, agentOr, { read_by: { $ne: user_id } }] }, { $addToSet: { read_by: user_id } });
  return { modifiedCount: result.modifiedCount };
}

async function broadcastNotification({ type, title, message, data }) {
  return await createNotification({ org_id: null, agent_id: null, type, title, message, data });
}

export default {
  createNotification,
  getNotifications,
  markAsRead,
  markAllAsRead,
  broadcastNotification
};
