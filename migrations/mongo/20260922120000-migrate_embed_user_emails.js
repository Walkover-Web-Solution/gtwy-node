import axios from "axios";

// bulkUpdateCUsers caps a batch at 100 rows.
const BATCH_SIZE = 100;
const PAGE_SIZE = 200;
const MSG91_BASE = "https://routes.msg91.com/api";

const msg91Headers = () => ({ "Content-Type": "application/json", Authkey: process.env.ADMIN_API_KEY });

// The embed/proxy role id differs per environment: 18 in testing, 20 elsewhere.
const embedRoleId = () => (String(process.env.ENVIRONMENT).toLowerCase() === "testing" ? "18" : "20");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// proxy user_id -> every distinct (orgId, folderId) pair it's used under,
// straight from each agent's own folder_id/org_id, first-seen order.
// Before this fix, MSG91 deduped embed users by email — and the old email
// had no folder_id in it — so the SAME proxy user_id can legitimately be the
// creator on agents in more than one embed folder of the same org. Each such
// pair beyond the first gets its own brand-new MSG91 user (see
// resolveMultiFolderUsers) instead of continuing to share one.
async function buildUserFolderGroups(db) {
  const folders = await db
    .collection("folders")
    .find({ type: "embed" }, { projection: { org_id: 1 } })
    .toArray();
  const folderToOrg = new Map(folders.map((f) => [String(f._id), String(f.org_id)]));
  if (folderToOrg.size === 0) return { groups: new Map(), orgIds: [], emptyFolders: [] };

  const agents = await db
    .collection("configurations")
    .find({ folder_id: { $in: [...folderToOrg.keys()] } }, { projection: { user_id: 1, folder_id: 1 } })
    .toArray();

  const foldersWithAgents = new Set();
  const groups = new Map();
  for (const agent of agents) {
    if (!agent.user_id || !agent.folder_id) continue;
    const orgId = folderToOrg.get(String(agent.folder_id));
    if (!orgId) continue;
    foldersWithAgents.add(String(agent.folder_id));
    const userId = String(agent.user_id);
    const folderId = String(agent.folder_id);
    const pairs = groups.get(userId) || [];
    if (!pairs.some((p) => p.orgId === orgId && p.folderId === folderId)) pairs.push({ orgId, folderId });
    groups.set(userId, pairs);
  }

  // A folder with no agent has no proxy user_id to look up, so no embed user
  // can ever be mapped to it.
  const emptyFolders = [...folderToOrg.entries()]
    .filter(([folderId]) => !foldersWithAgents.has(folderId))
    .map(([folderId, orgId]) => ({ folderId, orgId }));

  return { groups, orgIds: [...new Set(folderToOrg.values())], emptyFolders };
}

async function fetchEmbedUsers(orgId) {
  const users = [];
  for (let page = 1; ; page++) {
    const response = await axios.get(`${MSG91_BASE}/${process.env.PUBLIC_REFERENCEID}/getDetails`, {
      params: { company_id: orgId, role_ids: embedRoleId(), pageNo: page, itemsPerPage: PAGE_SIZE },
      headers: msg91Headers()
    });
    const payload = response.data?.data;
    const rows = Array.isArray(payload?.data) ? payload.data : null;
    if (rows === null)
      throw new Error(`getDetails org ${orgId} page ${page}: expected data.data array, got ${JSON.stringify(payload).slice(0, 200)}`);
    users.push(...rows);
    const total = Number(payload.totalEntityCount);
    if (Number.isFinite(total) ? users.length >= total : rows.length < PAGE_SIZE) break;
  }
  return users;
}

async function fetchOrgName(orgId, cache) {
  if (cache.has(orgId)) return cache.get(orgId);
  const response = await axios.get(`${MSG91_BASE}/${process.env.PUBLIC_REFERENCEID}/getCompanies`, {
    params: { id: orgId },
    headers: msg91Headers()
  });
  const name = response.data?.data?.data?.[0]?.name ?? null;
  cache.set(orgId, name);
  return name;
}

// The opaque encrypted user id is always the last underscore-delimited
// segment of the email's local part, in both the old format
// (`${orgId}${userId}`, no separator, so the whole remainder is the id) and
// the new one (`${orgId}_${folderId}_${userId}`).
function extractUserIdFromEmail(email, orgId) {
  if (typeof email !== "string" || !email.endsWith("@gtwy.ai")) return null;
  const local = email.slice(0, -"@gtwy.ai".length);
  if (!local.startsWith(orgId)) return null;
  const rest = local.slice(orgId.length);
  const parts = rest.split("_").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

// Old email (no separator at all — confirmed against real MSG91 data, e.g.
// "1277675FBB5914A68706FD755DB1@gtwy.ai" = org_id "1277" + user_id
// "675FBB5914A68706FD755DB1"): `${org_id}${userId}@gtwy.ai`.
// New email must be EXACTLY the format createOrGetUser now writes
// (src/utils/proxy.utils.js):
// `${decodedToken.org_id}_${decodedToken.folder_id}_${checkToken.user_id}@gtwy.ai`.
// `userId` here is that same opaque encrypted user_id segment — never
// re-derived, only carried over into the new format as-is.
function planEmailUpdate(email, orgId, folderId) {
  if (typeof email !== "string" || !email.endsWith("@gtwy.ai")) return { skip: "not a gtwy.ai embed email" };
  const local = email.slice(0, -"@gtwy.ai".length);
  if (!local.startsWith(orgId)) return { skip: "email org_id prefix does not match mapped org_id" };
  const rest = local.slice(orgId.length);
  // The new format always has an underscore right after org_id
  // (`${orgId}_${folderId}_...`); the old format never does.
  if (rest.startsWith("_")) return { skip: "already migrated" };
  const userId = rest;
  if (!userId) return { skip: "no user_id segment after org_id" };
  return { newEmail: `${orgId}_${folderId}_${userId}@gtwy.ai` };
}

// meta is updated for every embed user unconditionally — no email-migration
// condition gates it. It's a full replace on MSG91's side, so the existing
// value is spread first and only unique_identifier is added/overwritten.
//
// A user whose proxy id is shared across more than one folder keeps its
// current email tied to the FIRST (org_id, folder_id) pair found (`primary`);
// every other pair becomes a multiFolderTask, handled separately by
// resolveMultiFolderUsers.
async function planForOrg(orgId, groups) {
  const users = await fetchEmbedUsers(orgId);
  const planned = [];
  const unmapped = [];
  const multiFolderTasks = [];
  for (const user of users) {
    const pairs = (groups.get(String(user.id)) || []).filter((p) => p.orgId === orgId);
    const existingMeta = user.meta && typeof user.meta === "object" ? user.meta : {};
    const uniqueIdentifier = extractUserIdFromEmail(user.email, orgId);
    const meta = { ...existingMeta, unique_identifier: uniqueIdentifier };

    if (pairs.length === 0) {
      unmapped.push({ id: user.id, email: user.email });
      planned.push({ id: user.id, oldEmail: user.email, newEmail: null, meta });
      continue;
    }

    const [primary, ...extras] = pairs;
    const result = planEmailUpdate(user.email, primary.orgId, primary.folderId);
    planned.push({ id: user.id, oldEmail: user.email, newEmail: result.skip ? null : result.newEmail, meta });

    for (const extra of extras) {
      multiFolderTasks.push({ oldUserId: user.id, oldEmail: user.email, orgId: extra.orgId, folderId: extra.folderId });
    }
  }
  return { planned, unmapped, multiFolderTasks };
}

// Admin/management-plane batch update — up to 100 c_user rows in one call,
// all-or-nothing per MSG91's docs. A 409 means a row is locked by a
// concurrent update, not a data problem — retry the identical payload.
async function bulkUpdateCUsers(referenceId, users) {
  const response = await axios.post(`${MSG91_BASE}/bulkUpdateCUsers`, { reference_id: referenceId, users }, { headers: msg91Headers() });
  return response.data;
}

async function updateSingleUser(userId, email, meta) {
  const Cuser = { meta };
  if (email) Cuser.email = email;
  await axios.put(`${MSG91_BASE}/${process.env.PUBLIC_REFERENCEID}/updateDetails`, { user_id: userId, Cuser }, { headers: msg91Headers() });
}

async function applyBatch(referenceId, batch, delayMs) {
  const succeeded = [];
  const failed = [];

  const tryBulk = async (items, attempt = 1) => {
    try {
      await bulkUpdateCUsers(
        referenceId,
        items.map((i) => ({ id: i.id, ...(i.newEmail ? { email: i.newEmail } : {}), meta: i.meta }))
      );
      succeeded.push(...items);
    } catch (error) {
      const status = error.response?.status;
      if (status === 409 && attempt <= 3) {
        await sleep(500 * attempt);
        return tryBulk(items, attempt + 1);
      }
      if (items.length === 1) {
        failed.push({ ...items[0], error: error.response?.data?.errors ?? error.message });
        return;
      }
      // All-or-nothing: fall back to one-at-a-time so a single bad row
      // doesn't block the rest of the batch.
      for (const item of items) {
        try {
          await updateSingleUser(item.id, item.newEmail, item.meta);
          succeeded.push(item);
        } catch (singleError) {
          failed.push({ ...item, error: singleError.response?.data?.errors ?? singleError.message });
        }
        if (delayMs > 0) await sleep(delayMs);
      }
    }
  };

  await tryBulk(batch);
  return { succeeded, failed };
}

// Creates a brand-new MSG91 embed user for a folder that was wrongly sharing
// someone else's proxy user_id. Same shape createOrGetUser posts in
// src/utils/proxy.utils.js, just without the cache read/write around it.
// meta carries unique_identifier too, same as every other user this
// migration touches — this new user shouldn't be the one exception.
async function createEmbedUser(orgId, email, orgName, uniqueIdentifier) {
  const proxyObject = {
    feature_id: process.env.PUBLIC_REFERENCEID,
    Cuser: { name: `emb${Math.random().toString(36).slice(2, 16)}`, email, meta: { type: "embed", unique_identifier: uniqueIdentifier } },
    company: { name: orgName, is_readable: true, meta: { status: "2" } },
    role_id: embedRoleId()
  };
  const response = await axios.post(`${MSG91_BASE}/createCUsers`, proxyObject, { headers: msg91Headers() });
  return response.data;
}

async function rewireFolderUser(db, { orgId, folderId, oldUserId, newUserId }) {
  const filter = { org_id: orgId, folder_id: folderId, user_id: oldUserId };
  const update = { $set: { user_id: newUserId } };
  const [configurations, apikeys, apicalls] = await Promise.all([
    db.collection("configurations").updateMany(filter, update),
    db.collection("apikeycredentials").updateMany(filter, update),
    db.collection("apicalls").updateMany(filter, update)
  ]);
  return { configurations: configurations.modifiedCount, apikeycredentials: apikeys.modifiedCount, apicalls: apicalls.modifiedCount };
}

async function resolveMultiFolderUsers(db, tasks, delayMs) {
  const orgNameCache = new Map();
  const succeeded = [];
  const failed = [];

  for (const task of tasks) {
    try {
      const rawUserId = extractUserIdFromEmail(task.oldEmail, task.orgId);
      if (!rawUserId) throw new Error(`could not extract user_id from email "${task.oldEmail}"`);

      const newEmail = `${task.orgId}_${task.folderId}_${rawUserId}@gtwy.ai`;
      const orgName = await fetchOrgName(task.orgId, orgNameCache);
      const created = await createEmbedUser(task.orgId, newEmail, orgName, rawUserId);
      const newUserId = created?.data?.user?.id;
      if (!newUserId) throw new Error(`createCUsers response had no data.user.id: ${JSON.stringify(created).slice(0, 200)}`);

      const rewired = await rewireFolderUser(db, {
        orgId: task.orgId,
        folderId: task.folderId,
        oldUserId: String(task.oldUserId),
        newUserId: String(newUserId)
      });
      succeeded.push({ ...task, newUserId: String(newUserId), newEmail, rewired });
    } catch (error) {
      failed.push({ ...task, error: error.response?.data?.errors ?? error.message });
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  return { succeeded, failed };
}

/**
 * Migration: backfill folder_id into existing embed users' MSG91 emails,
 * stamp every embed user's meta with its unique_identifier, and split apart
 * any proxy user that ended up shared across more than one embed folder.
 *
 * Embed users used to be created with
 *   email = `${org_id}${encryptedUserId}@gtwy.ai`  (no separator)
 * They are now created with
 *   email = `${org_id}_${folder_id}_${encryptedUserId}@gtwy.ai`
 * (see src/utils/proxy.utils.js, createOrGetUser). Users created before that
 * change still have the old, separator-less email; this rewrites them to the
 * new form so old and new users are addressed the same way.
 *
 * Finding the right folder_id(s) for a stale user:
 *   1. every `folders` doc with type "embed" gives a (folder_id, org_id) pair
 *   2. every `configurations` (agent) doc whose folder_id is one of those
 *      folders gives (proxy user_id -> org_id, folder_id) — that user_id is
 *      the MSG91 c_user id the agent was created under
 *   3. MSG91 users with the embed role id (18 in testing, 20 elsewhere) are
 *      fetched per org and matched against that map by id
 *
 * A folder with no agent at all is skipped (logged as emptyFolders) since it
 * has no proxy user_id to map.
 *
 * SHARED USERS: because the old email had no folder_id, MSG91's dedupe-by-
 * email could make one proxy user_id the creator on agents in MORE THAN ONE
 * embed folder of the same org. Only the first (org_id, folder_id) pair
 * found keeps using that existing user (its email is migrated as above).
 * Every other pair gets its own BRAND NEW MSG91 user, created with the
 * correct `${org_id}_${folder_id}_${userId}@gtwy.ai` email straight away, and
 * every local reference to the old shared user_id scoped to that folder — in
 * `configurations`, `apikeycredentials` and `apicalls` — is repointed to the
 * new user_id. (`configuration_versions` is deliberately excluded — see the
 * comment on rewireFolderUser: its user_id isn't reliably the embed proxy id.)
 *
 * Independently of all that, EVERY embed user fetched — mapped or not,
 * already-migrated email or not — has its meta updated: existing meta is
 * spread as-is, plus a unique_identifier key set to the encrypted user id
 * segment already present in its email. This is unconditional, not gated on
 * whether the email itself needed changing.
 *
 * Idempotent for the email side: a user whose email already has the
 * three-segment form is left alone, so re-running (e.g. after transient
 * MSG91 failures) is safe. A folder that's already been split off (its local
 * docs no longer carry the old shared user_id) simply won't match the rewire
 * filter on a second run. The meta update always runs again on re-run.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const missing = ["PUBLIC_REFERENCEID", "ADMIN_API_KEY"].filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`missing env: ${missing.join(", ")}`);

  const { groups, orgIds, emptyFolders } = await buildUserFolderGroups(db);
  console.log(
    `embed folders: ${orgIds.length} org(s), ${groups.size} proxy user id(s) mapped, ${emptyFolders.length} folder(s) skipped (no agent yet)`
  );

  const planned = [];
  const unmapped = [];
  const multiFolderTasks = [];
  for (const orgId of orgIds) {
    const result = await planForOrg(orgId, groups);
    planned.push(...result.planned);
    unmapped.push(...result.unmapped);
    multiFolderTasks.push(...result.multiFolderTasks);
  }
  const emailChanges = planned.filter((item) => item.newEmail).length;
  console.log(
    `planned: ${planned.length} user(s) to update (meta on all, email on ${emailChanges}); ${unmapped.length} unmapped (meta-only); ` +
      `${multiFolderTasks.length} shared-folder task(s) to split off into new users`
  );

  let succeeded = 0;
  const failed = [];
  for (let i = 0; i < planned.length; i += BATCH_SIZE) {
    const batch = planned.slice(i, i + BATCH_SIZE);
    const result = await applyBatch(process.env.PUBLIC_REFERENCEID, batch, 150);
    succeeded += result.succeeded.length;
    failed.push(...result.failed);
  }
  if (failed.length) console.error(`failed to update ${failed.length} user(s):`, failed);
  console.log(`embed user email/meta migration done: ${succeeded} updated, ${failed.length} failed.`);

  if (multiFolderTasks.length) {
    const multi = await resolveMultiFolderUsers(db, multiFolderTasks, 150);
    if (multi.failed.length) console.error(`failed to split off ${multi.failed.length} shared-folder user(s):`, multi.failed);
    console.log(`shared-folder split done: ${multi.succeeded.length} new user(s) created and rewired, ${multi.failed.length} failed.`);
  }
};

/**
 * @returns {Promise<void>}
 */
export const down = async () => {
  // No rollback: emails/meta are rewritten in MSG91 (an external system) and
  // new MSG91 users are created and local references repointed to them — none
  // of the pre-migration state can be reconstructed once overwritten.
};
