"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction, so we issue raw
  // SQL (sequelize-cli does not wrap migrations in a transaction by default).
  // message_id is a globally-unique crypto.randomUUID(), so a plain btree index
  // turns the message lookups into single-row index scans instead of full
  // sequential scans. Backs the SELECT ... WHERE message_id = $1, the feedback
  // UPDATE ... WHERE message_id (updateStatus), and findMessageByMessageId.
  // Kept non-unique to stay safe against any legacy/NULL/duplicate values.
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_logs_message_id
       ON conversation_logs (message_id);`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_conv_logs_message_id;`);
  }
};
