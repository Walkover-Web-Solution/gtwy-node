"use strict";

/** @type {import('sequelize-cli').Migration} */
//
// !!! READ BEFORE RUNNING !!!
//
// The billing idempotency design (docs/billing-idempotency-outbox-credit-system.md
// §3) requires message_id to be UNIQUE so the idempotent write (INSERT ... ON
// CONFLICT (message_id)) can dedup redeliveries. A prior migration
// (20260618140000) deliberately created a NON-unique index, noting message_id
// "may have legacy/NULL/duplicate values." Adding a unique index while such
// duplicates exist will FAIL and leave an INVALID index behind (a failed
// CREATE UNIQUE INDEX CONCURRENTLY is not auto-cleaned).
//
// PRE-FLIGHT (run manually against a prod-sized copy first):
//   -- must return zero rows before this migration can succeed:
//   SELECT message_id, count(*) FROM conversation_logs
//   WHERE message_id IS NOT NULL
//   GROUP BY message_id HAVING count(*) > 1;
// If it returns rows, dedup them first (this migration does NOT delete data).
//
// The index is PARTIAL (WHERE message_id IS NOT NULL) so legacy NULL rows do
// not block it — only genuine duplicate non-null values would.
//
module.exports = {
  async up(queryInterface) {
    // Defensively drop any leftover INVALID index from a prior failed attempt.
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS uq_conv_logs_message_id;`);
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_conv_logs_message_id
       ON conversation_logs (message_id)
       WHERE message_id IS NOT NULL;`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS uq_conv_logs_message_id;`);
  }
};
