"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // Speeds agent run log listing and CSV export: scope (org_id, bridge_id) then
  // ORDER BY created_at DESC (findAgentRunsPaginated / fetchAgentRunsExportBatch).
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
