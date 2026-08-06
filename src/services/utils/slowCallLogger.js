import logger from "../../logger.js";

// Slow-call warning thresholds per service, in milliseconds.
// A call slower than its threshold is logged so we can tell which service is slow.
export const SLOW_CALL_THRESHOLDS = {
  redis: 300, //  300ms
  mongo: 1500, //  500ms
  pg: 500 //  500ms
};

// Hard maximum execution time per service, in milliseconds.
export const SERVICE_TIMEOUTS = {
  mongo: 60000, //  60s
  redis: 10000 //  10s
};

export const TIMEOUT_ERROR_MESSAGE = "Due to a technical issue we couldn't fulfil your request, please try again.";

// Default threshold used when a service has no explicit entry above.
const DEFAULT_THRESHOLD = 500;

/**
 * Logs a warning only when `elapsedMs` exceeds the threshold for `service`.
 * @param {string} service  key in SLOW_CALL_THRESHOLDS (e.g. "redis", "mongo", "pg")
 * @param {string} label    human readable operation name (query, command, key...)
 * @param {number} elapsedMs elapsed time in milliseconds
 */
export function logSlowCall(service, label, elapsedMs) {
  const threshold = SLOW_CALL_THRESHOLDS[service] ?? DEFAULT_THRESHOLD;
  if (elapsedMs > threshold) {
    logger.warn(`[SLOW] [${service}] ${label} took ${elapsedMs.toFixed(1)}ms (threshold ${threshold}ms)`);
  }
}

/**
 * Times an async operation and logs a warning when it is slow.
 * Returns the wrapped operation's result and never swallows its error.
 * @param {string} service   key in SLOW_CALL_THRESHOLDS
 * @param {string} label     operation name for the log line
 * @param {() => Promise<T>} fn  async operation to time
 * @returns {Promise<T>}
 */
export async function timeAsync(service, label, fn) {
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    logSlowCall(service, label, elapsedMs);
  }
}

/**
 * Awaits `promise` with the per-service ceiling from SERVICE_TIMEOUTS.
 * Rejects with a timeout error (and logs it) when the ceiling is breached.
 * @param {Promise<T>} promise  the in-flight operation
 * @param {string} service      key in SERVICE_TIMEOUTS (defaults to "mongo")
 * @param {string} [label]      operation name for the log line
 * @returns {Promise<T>}
 */
export function withTimeout(promise, service = "mongo", label = "") {
  const ms = SERVICE_TIMEOUTS[service];
  if (!ms) return Promise.resolve(promise);

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      logger.error(`[TIMEOUT] [${service}] ${label || "call"} exceeded ${ms}ms`);
      const err = new Error(TIMEOUT_ERROR_MESSAGE);
      err.code = "SERVICE_TIMEOUT";
      err.service = service;
      reject(err);
    }, ms);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}
