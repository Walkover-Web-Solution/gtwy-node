"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction, so we issue raw
  // SQL (sequelize-cli does not wrap migrations in a transaction by default).
  //
  // Backs the agent-analytics aggregations in src/db_services/analytics.service.js
  // (summary, requests-over-time, response-time percentiles, cost-over-time) and
  // getFilterOptions — every one of them filters on
  //   bridge_id = ? AND org_id = ? AND created_at BETWEEN ? AND ?
  // The sibling idx_conv_logs_org_bridge_updated matches the first two columns
  // but then has to filter by created_at manually, which on a busy bridge reads
  // the whole bridge for every analytics request. This composite lets the
  // planner do a single range scan over just the time window.
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_logs_org_bridge_created
       ON conversation_logs (org_id, bridge_id, created_at DESC);`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_conv_logs_org_bridge_created;`);
  }
};
