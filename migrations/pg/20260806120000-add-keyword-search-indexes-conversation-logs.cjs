"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction, so we issue raw
  // SQL (sequelize-cli does not wrap migrations in a transaction by default).
  // Backs the 5-field keyword box search (user, llm_message, message_id,
  // thread_id, batch_data->>'batch_id') in findKeywordSearchResults /
  // KEYWORD_SEARCH_BATCH_ID (src/db_services/history.service.js) with trigram
  // (ILIKE '%term%') indexes on the free-text columns and text_pattern_ops
  // (LIKE 'prefix%') indexes on the id-like columns.
  async up(queryInterface) {
    await queryInterface.sequelize.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cl_user_trgm
       ON conversation_logs USING gin ("user" gin_trgm_ops);`
    );

    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cl_llm_msg_trgm
       ON conversation_logs USING gin (llm_message gin_trgm_ops);`
    );

    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cl_message_id
       ON conversation_logs (message_id text_pattern_ops);`
    );

    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cl_thread_id
       ON conversation_logs (thread_id text_pattern_ops);`
    );

    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cl_variables_gin
       ON conversation_logs USING gin (variables);`
    );

    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cl_variables_text_trgm
       ON conversation_logs USING gin ((variables::text) gin_trgm_ops);`
    );

    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cl_batch_id_trgm
       ON conversation_logs USING gin ((batch_data->>'batch_id') gin_trgm_ops);`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_cl_batch_id_trgm;`);
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_cl_variables_text_trgm;`);
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_cl_variables_gin;`);
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_cl_thread_id;`);
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_cl_message_id;`);
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_cl_llm_msg_trgm;`);
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_cl_user_trgm;`);
  }
};
