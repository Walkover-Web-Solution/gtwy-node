/**
 * Moderation states for a showcase submission. Entries land as PENDING and only
 * reach the public wall once a maintainer moves them to APPROVED.
 *
 * Stored as numbers, so the values are part of the persisted data — append new
 * states, never renumber the existing ones.
 */
export const SHOWCASE_STATUS = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2
};

export default { SHOWCASE_STATUS };
