"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction, so we issue raw
  // SQL (sequelize-cli does not wrap migrations in a transaction by default).
  // This composite index backs the bridge-scoped feedback totals aggregate and
  // the recent-threads list (ordered by MAX(updated_at) DESC) in
  // findRecentThreadsByBridgeId (src/db_services/history.service.js).
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_logs_org_bridge_updated
       ON conversation_logs (org_id, bridge_id, updated_at DESC);`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_conv_logs_org_bridge_updated;`);
  }
};
