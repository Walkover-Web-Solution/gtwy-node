"use strict";

/** @type {import('sequelize-cli').Migration} */
// Billing outbox columns for the Lago credit system. See
// docs/billing-idempotency-outbox-credit-system.md §3. These are additive,
// nullable/defaulted columns — safe to add online without a table rewrite.
// The Python execution plane stamps cost_data / dispatch_status onto these
// (decision Q1: Python UPDATEs the Node-written conversation_logs row).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("conversation_logs", "cost_data", {
      type: Sequelize.JSONB,
      allowNull: true
    });
    await queryInterface.addColumn("conversation_logs", "dispatch_status", {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: "pending" // pending | dispatched | failed | dead_letter
    });
    await queryInterface.addColumn("conversation_logs", "dispatch_attempts", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0
    });
    await queryInterface.addColumn("conversation_logs", "lago_response", {
      type: Sequelize.JSONB,
      allowNull: true
    });

    // Partial index so the billing poller's scan of pending rows is an index
    // scan, not a seq scan over the whole (high-volume) table.
    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_logs_dispatch_pending
       ON conversation_logs (dispatch_status)
       WHERE dispatch_status = 'pending';`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_conv_logs_dispatch_pending;`);
    await queryInterface.removeColumn("conversation_logs", "lago_response");
    await queryInterface.removeColumn("conversation_logs", "dispatch_attempts");
    await queryInterface.removeColumn("conversation_logs", "dispatch_status");
    await queryInterface.removeColumn("conversation_logs", "cost_data");
  }
};
