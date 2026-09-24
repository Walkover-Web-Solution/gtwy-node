/**
 * Period identifiers for usage counters.
 *
 * A usage counter carries its own period in its key (Redis) or row (Mongo)
 * instead of being zeroed by a scheduled job or reset by TTL expiry:
 *
 *   daily   -> "2026-08-25"   rolls at midnight
 *   weekly  -> "2026-W35"     rolls Monday, ISO week numbering
 *   monthly -> "2026-08"      rolls on the 1st
 *
 * A window resets because the *string changes* and the new key has never been
 * written -- nothing has to expire or be set to zero for the budget to be fresh.
 * Expiry becomes housekeeping: a stale key is never read again, so a late sweep
 * costs nothing.
 *
 * This is the Node twin of `src/services/utils/period_key.py` in the Python
 * service. The two MUST produce identical strings for the same instant -- both
 * repos assert against the same vectors, see periodKey.utils.test.js.
 */

// Every value below is read in UTC — that is what defines "the 1st" and "Monday",
// and it keeps the two services trivially consistent. Changing it means changing
// PERIOD_TIMEZONE in the Python helper to match.
//
// Matches the Mongo schema default and the `|| "monthly"` fallbacks elsewhere.
const DEFAULT_RESET_PERIOD = "monthly";

const RESET_PERIODS = ["daily", "weekly", "monthly"];

const pad = (n) => String(n).padStart(2, "0");

/**
 * ISO-8601 week and week-numbering year for a UTC instant.
 *
 * ISO weeks belong to the year containing their Thursday, which is why 31 Dec
 * and 1 Jan can share a week number -- and why we must not derive the year from
 * getUTCFullYear(). Splitting one week across two strings would give a customer
 * two budgets in the same week.
 */
const isoWeekParts = (date) => {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayIndex = (thursday.getUTCDay() + 6) % 7; // Mon = 0 ... Sun = 6
  thursday.setUTCDate(thursday.getUTCDate() - dayIndex + 3);

  const isoYear = thursday.getUTCFullYear();

  // Week 1 is the week containing 4 January, by definition.
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayIndex = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayIndex + 3);

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { isoYear, week };
};

/** Coerce a stored reset period to one we know how to format. */
const normalizeResetPeriod = (resetPeriod) => {
  const candidate = String(resetPeriod || "")
    .toLowerCase()
    .trim();
  if (RESET_PERIODS.includes(candidate)) return candidate;
  if (candidate) {
    console.warn(`periodKey: unknown resetPeriod "${candidate}"; treating as ${DEFAULT_RESET_PERIOD}`);
  }
  return DEFAULT_RESET_PERIOD;
};

/** The period string for `now` under `resetPeriod`. */
const periodKey = (resetPeriod, now = new Date()) => {
  const period = normalizeResetPeriod(resetPeriod);
  const date = now instanceof Date ? now : new Date(now);

  if (period === "daily") {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
  if (period === "weekly") {
    const { isoYear, week } = isoWeekParts(date);
    return `${isoYear}-W${pad(week)}`;
  }
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
};

/**
 * The current period string for every reset type.
 *
 * Admin actions (editing a cap, resetting usage) can change the reset period in
 * the same request, which would leave the key under the *old* format orphaned.
 * Covering all three is cheap on a rare action and removes the need to know
 * which format was in force beforehand.
 */
const allPeriodKeys = (now = new Date()) => RESET_PERIODS.map((period) => periodKey(period, now));

export { periodKey, allPeriodKeys };
