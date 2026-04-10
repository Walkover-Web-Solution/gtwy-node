"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // Raw timeseries storage: keep total latency and split latency dimensions.
    await queryInterface.sequelize.query(`
      ALTER TABLE metrics_raw_data
      ADD COLUMN IF NOT EXISTS llm_latency FLOAT,
      ADD COLUMN IF NOT EXISTS tool_call_latency FLOAT,
      ADD COLUMN IF NOT EXISTS system_latency FLOAT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE metrics_raw_data
      ALTER COLUMN llm_latency SET DEFAULT 0,
      ALTER COLUMN tool_call_latency SET DEFAULT 0,
      ALTER COLUMN system_latency SET DEFAULT 0;
    `);

    // Aggregated tables used by dashboards/reports.
    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data
      ADD COLUMN IF NOT EXISTS input_tokens FLOAT,
      ADD COLUMN IF NOT EXISTS output_tokens FLOAT,
      ADD COLUMN IF NOT EXISTS llm_latency_sum FLOAT,
      ADD COLUMN IF NOT EXISTS tool_call_latency_sum FLOAT,
      ADD COLUMN IF NOT EXISTS system_latency_sum FLOAT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data
      ADD COLUMN IF NOT EXISTS input_tokens FLOAT,
      ADD COLUMN IF NOT EXISTS output_tokens FLOAT,
      ADD COLUMN IF NOT EXISTS llm_latency_sum FLOAT,
      ADD COLUMN IF NOT EXISTS tool_call_latency_sum FLOAT,
      ADD COLUMN IF NOT EXISTS system_latency_sum FLOAT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data
      ALTER COLUMN input_tokens SET DEFAULT 0,
      ALTER COLUMN output_tokens SET DEFAULT 0,
      ALTER COLUMN llm_latency_sum SET DEFAULT 0,
      ALTER COLUMN tool_call_latency_sum SET DEFAULT 0,
      ALTER COLUMN system_latency_sum SET DEFAULT 0;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data
      ALTER COLUMN input_tokens SET DEFAULT 0,
      ALTER COLUMN output_tokens SET DEFAULT 0,
      ALTER COLUMN llm_latency_sum SET DEFAULT 0,
      ALTER COLUMN tool_call_latency_sum SET DEFAULT 0,
      ALTER COLUMN system_latency_sum SET DEFAULT 0;
    `);
  },

  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data
      ALTER COLUMN input_tokens DROP DEFAULT,
      ALTER COLUMN output_tokens DROP DEFAULT,
      ALTER COLUMN llm_latency_sum DROP DEFAULT,
      ALTER COLUMN tool_call_latency_sum DROP DEFAULT,
      ALTER COLUMN system_latency_sum DROP DEFAULT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data
      ALTER COLUMN input_tokens DROP DEFAULT,
      ALTER COLUMN output_tokens DROP DEFAULT,
      ALTER COLUMN llm_latency_sum DROP DEFAULT,
      ALTER COLUMN tool_call_latency_sum DROP DEFAULT,
      ALTER COLUMN system_latency_sum DROP DEFAULT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE metrics_raw_data
      ALTER COLUMN llm_latency DROP DEFAULT,
      ALTER COLUMN tool_call_latency DROP DEFAULT,
      ALTER COLUMN system_latency DROP DEFAULT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data
      DROP COLUMN IF EXISTS llm_latency_sum,
      DROP COLUMN IF EXISTS tool_call_latency_sum,
      DROP COLUMN IF EXISTS system_latency_sum,
      DROP COLUMN IF EXISTS input_tokens,
      DROP COLUMN IF EXISTS output_tokens;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data
      DROP COLUMN IF EXISTS llm_latency_sum,
      DROP COLUMN IF EXISTS tool_call_latency_sum,
      DROP COLUMN IF EXISTS system_latency_sum,
      DROP COLUMN IF EXISTS input_tokens,
      DROP COLUMN IF EXISTS output_tokens;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE metrics_raw_data
      DROP COLUMN IF EXISTS llm_latency,
      DROP COLUMN IF EXISTS tool_call_latency,
      DROP COLUMN IF EXISTS system_latency;
    `);
  }
};
