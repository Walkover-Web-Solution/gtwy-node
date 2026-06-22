"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction, so we issue raw
  // SQL (sequelize-cli does not wrap migrations in a transaction by default).
  // This composite index backs getAllAgentsWithLastPublishers
  // (src/db_services/configuration.service.js): the org_id + type equality
  // filters lead, and (bridge_id, time DESC) matches the
  // DISTINCT ON (bridge_id) ... ORDER BY bridge_id, time DESC shape, letting
  // Postgres pick the latest row per bridge from a single ordered index scan
  // instead of a full sequential scan + sort.
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ubch_org_type_bridge_time
       ON user_bridge_config_history (org_id, type, bridge_id, time DESC);`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_ubch_org_type_bridge_time;`);
  }
};
