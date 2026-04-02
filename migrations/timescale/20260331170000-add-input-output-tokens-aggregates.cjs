"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // Add input_tokens and output_tokens columns to fifteen_minute_data
    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data ADD COLUMN IF NOT EXISTS input_tokens FLOAT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data ADD COLUMN IF NOT EXISTS output_tokens FLOAT;
    `);

    // Add input_tokens and output_tokens columns to daily_data
    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data ADD COLUMN IF NOT EXISTS input_tokens FLOAT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data ADD COLUMN IF NOT EXISTS output_tokens FLOAT;
    `);

    // Drop old continuous aggregates
    await queryInterface.sequelize.query(`
      DROP MATERIALIZED VIEW IF EXISTS fifteen_min_data_aggregate CASCADE;
    `);

    await queryInterface.sequelize.query(`
      DROP MATERIALIZED VIEW IF EXISTS daily_data_aggregate CASCADE;
    `);

    // Create new fifteen_min_data_aggregate with input/output tokens
    await queryInterface.sequelize.query(`
      CREATE MATERIALIZED VIEW fifteen_min_data_aggregate
      WITH (timescaledb.continuous) AS
      SELECT 
          org_id,
          apikey_id,
          service,
          model, 
          version_id,
          thread_id,
          bridge_id,
          time_zone,
          time_bucket('15 minutes', created_at) as interval,
          COUNT(*) FILTER (where success = true) AS success_count,
          SUM(latency) AS latency_sum,
          SUM(cost) AS cost_sum,
          SUM(total_tokens) AS total_token_count,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          COUNT(*) AS record_count
      FROM metrics_raw_data
      GROUP BY 
          org_id, bridge_id, version_id, interval, service, apikey_id, model, thread_id, time_zone;
    `);

    await queryInterface.sequelize.query(`
      SELECT add_continuous_aggregate_policy('fifteen_min_data_aggregate',
          start_offset => INTERVAL '1 hour',
          end_offset => INTERVAL '0',
          schedule_interval => INTERVAL '15 minutes',
          initial_start => '2024-12-24 00:30:00+00'
      );
    `);

    // Create new daily_data_aggregate with input/output tokens
    await queryInterface.sequelize.query(`
      CREATE MATERIALIZED VIEW daily_data_aggregate
      WITH (timescaledb.continuous) AS
      SELECT 
          org_id,
          apikey_id,
          service,
          model, 
          version_id,
          thread_id,
          bridge_id,
          time_bucket('1 day', created_at) as interval,
          SUM(success_count) AS success_count,
          SUM(latency_sum) AS latency_sum,
          SUM(cost_sum) AS cost_sum,
          SUM(record_count) AS record_count,
          SUM(total_token_count) AS total_token_count,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens
      FROM fifteen_minute_data
      GROUP BY 
          org_id, bridge_id, version_id, interval, service, apikey_id, model, thread_id;
    `);

    await queryInterface.sequelize.query(`
      SELECT add_continuous_aggregate_policy('daily_data_aggregate',
          start_offset => INTERVAL '3 days',
          end_offset => INTERVAL '0',
          schedule_interval => INTERVAL '1 day',
          initial_start => '2024-12-24 18:30:00+00'::timestamptz
      );
    `);
  },

  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    // Drop the new aggregates
    await queryInterface.sequelize.query(`
      DROP MATERIALIZED VIEW IF EXISTS fifteen_min_data_aggregate CASCADE;
    `);

    await queryInterface.sequelize.query(`
      DROP MATERIALIZED VIEW IF EXISTS daily_data_aggregate CASCADE;
    `);

    // Remove columns
    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data DROP COLUMN IF EXISTS input_tokens;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data DROP COLUMN IF EXISTS output_tokens;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data DROP COLUMN IF EXISTS input_tokens;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data DROP COLUMN IF EXISTS output_tokens;
    `);
  }
};
