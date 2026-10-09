import NotificationModel from "../mongoModel/Notification.model.js";

function toResponseShape(doc, user_id) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    ...obj,
    read: (obj.read_by || []).includes(user_id)
  };
}

const MERGE_WINDOW_MS = 10 * 60 * 1000;

// Merges a repeat of a recent alert into its existing notification: count goes up, the text and
// time are refreshed and it becomes unread again, so a flapping agent shows one row, not dozens.
async function mergeIntoRecent(event) {
  return await NotificationModel.findOneAndUpdate(
    {
      org_id: event.org_id || null,
      dedupe_key: event.dedupe_key,
      updatedAt: { $gte: new Date(Date.now() - MERGE_WINDOW_MS) },
      event_id: { $ne: event.event_id },
      recent_event_ids: { $ne: event.event_id }
    },
    {
      $inc: { count: 1 },
      $set: {
        title: event.title,
        message: event.message,
        severity: event.severity,
        data: event.data || {},
        occurred_at: event.occurred_at,
        read_by: []
      },
      $push: { recent_event_ids: { $each: [event.event_id], $slice: -50 } }
    },
    { new: true, sort: { updatedAt: -1 } }
  );
}

// Stores the notification for an event. A duplicate event_id (e.g. a redelivered queue message)
// is reported, not stored or counted twice.
async function createFromEvent(event) {
  if (event.dedupe_key) {
    const merged = await mergeIntoRecent(event);
    if (merged) return { notification: merged, duplicate: false, merged: true };
    if (await NotificationModel.exists({ recent_event_ids: event.event_id })) {
      return { notification: null, duplicate: true, merged: false };
    }
  }
  try {
    const notification = await new NotificationModel({
      event_id: event.event_id,
      event_type: event.event_type,
      audience: event.audience,
      severity: event.severity,
      org_id: event.org_id || null,
      agent_id: event.agent_id || null,
      title: event.title,
      message: event.message,
      data: event.data || {},
      dedupe_key: event.dedupe_key || null,
      source: event.source || null,
      occurred_at: event.occurred_at
    }).save();
    return { notification, duplicate: false, merged: false };
  } catch (error) {
    if (error?.code === 11000) {
      return { notification: null, duplicate: true, merged: false };
    }
    throw error;
  }
}

async function getNotifications({ org_id, agent_id, scope, user_id, unread, severity, event_type, page = 1, limit = 20 }) {
  // A notification with org_id: null is a global broadcast — every org sees it
  // alongside its own, the same way agent_id: null is org-wide within an org.
  const query = { $or: [{ org_id: null }, { org_id }] };
  if (scope === "org") {
    // Strictly org-wide notifications (not tied to any specific agent).
    query.agent_id = null;
  } else if (agent_id) {
    query.agent_id = agent_id;
  }

  if (severity) query.severity = severity;
  if (event_type) query.event_type = event_type;
  // unread_count below ignores this filter, so the badge stays the true total.
  const listQuery = unread ? { ...query, read_by: { $ne: user_id } } : query;

  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    NotificationModel.find(listQuery).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    NotificationModel.countDocuments(listQuery),
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

async function markAllAsRead({ org_id, agent_id, scope, user_id }) {
  const orgOr = { $or: [{ org_id: null }, { org_id }] };
  if (scope === "all") {
    // Everything the user can see: org-wide, every agent's, and global broadcasts.
    const result = await NotificationModel.updateMany({ $and: [orgOr, { read_by: { $ne: user_id } }] }, { $addToSet: { read_by: user_id } });
    return { modifiedCount: result.modifiedCount };
  }
  // Marking read for an agent view clears both that agent's notifications and the
  // org-wide ones (since the UI shows them merged); without an agent, only org-wide.
  const agentOr = { $or: agent_id ? [{ agent_id: null }, { agent_id }] : [{ agent_id: null }] };

  const result = await NotificationModel.updateMany({ $and: [orgOr, agentOr, { read_by: { $ne: user_id } }] }, { $addToSet: { read_by: user_id } });
  return { modifiedCount: result.modifiedCount };
}

export default {
  createFromEvent,
  getNotifications,
  markAsRead,
  markAllAsRead
};
