/**
 * Migration: purge the stale nd_org_billing_plan_* keys from Redis.
 *
 * WHY. Two processes wrote this key with different lifetime policies. Node did
 * a bare SET with NO TTL; gtwy-ai writes it with ex=3600, but only on a cache
 * MISS — it never revalidates a key that already exists. So every key Node ever
 * wrote is immortal, and DELETE /api/utils/redis deliberately refuses nd_
 * prefixed keys, which left a wrong plan unfixable without redis-cli.
 *
 * Node now DELETES the key instead of writing it (invalidatePlanCache), so no
 * new immortal keys are created. This clears the ones already out there.
 *
 * ORDERING is the whole point of doing it here. dockerStart runs
 * `migrate-mongo up` and only then starts the app, so the purge lands after the
 * old writer is gone and before the new code serves a request. Run it any
 * earlier and the running old build simply re-mints the keys.
 *
 * Deleting rather than expiring is deliberate: an EXPIRE would preserve a
 * possibly-wrong value for its duration, while a DEL forces gtwy-ai to re-read
 * from Mongo — which is the source of truth — on the very next request. These
 * keys are a pure read-through cache and cost nothing to regenerate. (That is
 * also why the key is misclassified: by this repo's own convention nd_ means
 * "cannot be regenerated", and this plainly can. Renaming it to cd_ needs a
 * coordinated two-repo dual-read window, so it is left alone here.)
 *
 * Safe to re-run: a second pass simply finds nothing.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

const PLAN_KEY_PATTERN = "nd_org_billing_plan_*";

export const up = async () => {
  // Imported inside up() so merely loading the migration file does not open a
  // Redis connection — migrate-mongo imports every migration to build its list.
  const { default: client } = await import("../../src/services/cache.service.js");

  // The cache_service helpers add REDIS_PREFIX themselves, but they are built
  // for request-time use and cap out at 10k keys with sleeps every 1000. Here
  // we want an exact, unbounded sweep of one narrow pattern, so scan directly.
  const REDIS_PREFIX = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_`;
  const match = `${REDIS_PREFIX}${PLAN_KEY_PATTERN}`;

  // Redis may not be up yet on a cold boot. Wait briefly rather than either
  // hanging the deploy or silently recording a purge that never happened.
  for (let i = 0; i < 20 && !client.isReady; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!client.isReady) {
    // Throwing leaves the migration unrecorded so the next deploy retries.
    // A stale plan is a real billing-gate error; skipping quietly is not an
    // acceptable outcome.
    throw new Error("Redis is not ready — cannot purge stale org plan cache keys");
  }

  const keys = [];
  for await (const key of client.scanIterator({ MATCH: match, COUNT: 500 })) {
    keys.push(key);
  }

  if (keys.length === 0) {
    console.log(`No ${PLAN_KEY_PATTERN} keys found — nothing to purge.`);
    return;
  }

  // Chunked so one enormous DEL cannot block the Redis event loop.
  let deleted = 0;
  const CHUNK = 500;
  for (let i = 0; i < keys.length; i += CHUNK) {
    deleted += await client.del(keys.slice(i, i + CHUNK));
  }

  console.log(
    `Purged ${deleted}/${keys.length} stale ${PLAN_KEY_PATTERN} keys. ` +
      "gtwy-ai repopulates each from org_billing, with its own TTL, on the next request for that org."
  );
};

// Nothing to undo: these keys are a cache, and gtwy-ai rebuilds them on demand.
export const down = async () => {
  console.log("purge_stale_org_plan_cache is a cache sweep — nothing to reverse.");
};
