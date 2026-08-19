"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction, so we issue raw
  // SQL (sequelize-cli does not wrap migrations in a transaction by default).
  // Backs the monthly retention cron's bulk DELETE ... WHERE created_at < $1
  // on conversation_logs, which currently does a full table scan.
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_logs_created_at
       ON conversation_logs (created_at);`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_conv_logs_created_at;`);
  }
};
