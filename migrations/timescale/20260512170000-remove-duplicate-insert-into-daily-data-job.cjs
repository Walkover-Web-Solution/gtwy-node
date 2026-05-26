"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // Remove duplicate `insert_into_daily_data` scheduled jobs.
    // Multiple jobs sharing the same proc_name caused the additive upsert
    // in insert_into_daily_data to double-count cost_sum / total_token_count / etc.
    // Keep the lowest job_id (original), delete the rest.
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
          job_to_keep INTEGER;
          job_id_to_delete INTEGER;
      BEGIN
          SELECT MIN(job_id)
          INTO job_to_keep
          FROM timescaledb_information.jobs
          WHERE proc_name = 'insert_into_daily_data';

          IF job_to_keep IS NULL THEN
              RAISE NOTICE 'No insert_into_daily_data job found; nothing to delete.';
          ELSE
              FOR job_id_to_delete IN
                  SELECT job_id
                  FROM timescaledb_information.jobs
                  WHERE proc_name = 'insert_into_daily_data'
                    AND job_id <> job_to_keep
              LOOP
                  RAISE NOTICE 'Deleting duplicate insert_into_daily_data job_id=%', job_id_to_delete;

                  PERFORM delete_job(job_id_to_delete);
              END LOOP;
          END IF;
      END $$;
    `);
  },
  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    // Best-effort restore. The original initial_start cannot be recovered;
    // TimescaleDB will compute the next run based on schedule_interval.
    await queryInterface.sequelize.query(`
      SELECT add_job('insert_into_daily_data', '1 day');
    `);
  }
};
