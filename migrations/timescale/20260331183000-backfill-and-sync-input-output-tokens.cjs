"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // Backfill missing token columns in fifteen_minute_data from raw metrics.
    await queryInterface.sequelize.query(`
      WITH bucketed_raw AS (
        SELECT
          org_id,
          bridge_id,
          version_id,
          thread_id,
          apikey_id,
          service,
          model,
          time_zone,
          time_bucket('15 minutes', created_at) AS interval,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens
        FROM metrics_raw_data
        GROUP BY
          org_id, bridge_id, version_id, thread_id, apikey_id, service, model, time_zone, interval
      )
      UPDATE fifteen_minute_data t
      SET
        input_tokens = b.input_tokens,
        output_tokens = b.output_tokens
      FROM bucketed_raw b
      WHERE t.created_at = b.interval
        AND t.org_id IS NOT DISTINCT FROM b.org_id
        AND t.bridge_id IS NOT DISTINCT FROM b.bridge_id
        AND t.version_id IS NOT DISTINCT FROM b.version_id
        AND t.thread_id IS NOT DISTINCT FROM b.thread_id
        AND t.apikey_id IS NOT DISTINCT FROM b.apikey_id
        AND t.service IS NOT DISTINCT FROM b.service
        AND t.model IS NOT DISTINCT FROM b.model
        AND t.time_zone IS NOT DISTINCT FROM b.time_zone
        AND (t.input_tokens IS NULL OR t.output_tokens IS NULL);
    `);

    // Backfill missing token columns in daily_data from fifteen_minute_data.
    await queryInterface.sequelize.query(`
      WITH bucketed_daily AS (
        SELECT
          org_id,
          bridge_id,
          version_id,
          thread_id,
          apikey_id,
          service,
          model,
          time_bucket('1 day', created_at) AS interval,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens
        FROM fifteen_minute_data
        GROUP BY
          org_id, bridge_id, version_id, thread_id, apikey_id, service, model, interval
      )
      UPDATE daily_data d
      SET
        input_tokens = b.input_tokens,
        output_tokens = b.output_tokens
      FROM bucketed_daily b
      WHERE d.created_at = b.interval
        AND d.org_id IS NOT DISTINCT FROM b.org_id
        AND d.bridge_id IS NOT DISTINCT FROM b.bridge_id
        AND d.version_id IS NOT DISTINCT FROM b.version_id
        AND d.thread_id IS NOT DISTINCT FROM b.thread_id
        AND d.apikey_id IS NOT DISTINCT FROM b.apikey_id
        AND d.service IS NOT DISTINCT FROM b.service
        AND d.model IS NOT DISTINCT FROM b.model
        AND (d.input_tokens IS NULL OR d.output_tokens IS NULL);
    `);

    // Keep future inserts in sync: update scheduled function for fifteen_minute_data.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_fifteen_minute_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO fifteen_minute_data
            (org_id, apikey_id, service, model,
             latency_sum, success_count, record_count, created_at, total_token_count, cost_sum,
             input_tokens, output_tokens,
             thread_id, version_id, bridge_id, time_zone)
        SELECT
            org_id, apikey_id, service, model,
            latency_sum, success_count, record_count, interval, total_token_count, cost_sum,
            input_tokens, output_tokens,
            thread_id, version_id, bridge_id, time_zone
        FROM fifteen_min_data_aggregate
        WHERE interval > (SELECT COALESCE(MAX(created_at), 'epoch'::timestamp) FROM fifteen_minute_data)
        ON CONFLICT (org_id, service, bridge_id, apikey_id, thread_id, version_id, model, created_at)
        DO UPDATE SET
            latency_sum = fifteen_minute_data.latency_sum + EXCLUDED.latency_sum,
            cost_sum = fifteen_minute_data.cost_sum + EXCLUDED.cost_sum,
            record_count = fifteen_minute_data.record_count + EXCLUDED.record_count,
            total_token_count = fifteen_minute_data.total_token_count + EXCLUDED.total_token_count,
            input_tokens = COALESCE(fifteen_minute_data.input_tokens, 0) + COALESCE(EXCLUDED.input_tokens, 0),
            output_tokens = COALESCE(fifteen_minute_data.output_tokens, 0) + COALESCE(EXCLUDED.output_tokens, 0),
            success_count = fifteen_minute_data.success_count + EXCLUDED.success_count;
      END;
      $$;
    `);

    // Keep future inserts in sync: update scheduled function for daily_data.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_daily_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO daily_data
            (org_id, apikey_id, service, model,
             latency_sum, success_count, record_count, created_at, total_token_count, cost_sum,
             input_tokens, output_tokens,
             thread_id, version_id, bridge_id)
        SELECT
            org_id, apikey_id, service, model,
            latency_sum, success_count, record_count, interval, total_token_count, cost_sum,
            input_tokens, output_tokens,
            thread_id, version_id, bridge_id
        FROM daily_data_aggregate
        WHERE interval > (SELECT COALESCE(MAX(created_at), 'epoch'::timestamp) FROM daily_data)
        ON CONFLICT (org_id, service, bridge_id, apikey_id, thread_id, version_id, model, created_at)
        DO UPDATE SET
            cost_sum = daily_data.cost_sum + EXCLUDED.cost_sum,
            latency_sum = daily_data.latency_sum + EXCLUDED.latency_sum,
            record_count = daily_data.record_count + EXCLUDED.record_count,
            success_count = daily_data.success_count + EXCLUDED.success_count,
            total_token_count = daily_data.total_token_count + EXCLUDED.total_token_count,
            input_tokens = COALESCE(daily_data.input_tokens, 0) + COALESCE(EXCLUDED.input_tokens, 0),
            output_tokens = COALESCE(daily_data.output_tokens, 0) + COALESCE(EXCLUDED.output_tokens, 0);
      END;
      $$;
    `);
  },

  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    // Revert only function signatures/logic to previous behavior without input/output token handling.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_fifteen_minute_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO fifteen_minute_data
            (org_id, apikey_id, service, model,
             latency_sum, success_count, record_count, created_at, total_token_count, cost_sum,
             thread_id, version_id, bridge_id, time_zone)
        SELECT
            org_id, apikey_id, service, model,
            latency_sum, success_count, record_count, interval, total_token_count, cost_sum,
            thread_id, version_id, bridge_id, time_zone
        FROM fifteen_min_data_aggregate
        WHERE interval > (SELECT COALESCE(MAX(created_at), 'epoch'::timestamp) FROM fifteen_minute_data)
        ON CONFLICT (org_id, service, bridge_id, apikey_id, thread_id, version_id, model, created_at)
        DO UPDATE SET
            latency_sum = fifteen_minute_data.latency_sum + EXCLUDED.latency_sum,
            cost_sum = fifteen_minute_data.cost_sum + EXCLUDED.cost_sum,
            record_count = fifteen_minute_data.record_count + EXCLUDED.record_count,
            total_token_count = fifteen_minute_data.total_token_count + EXCLUDED.total_token_count,
            success_count = fifteen_minute_data.success_count + EXCLUDED.success_count;
      END;
      $$;
    `);

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_daily_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO daily_data
            (org_id, apikey_id, service, model,
             latency_sum, success_count, record_count, created_at, total_token_count, cost_sum,
             thread_id, version_id, bridge_id)
        SELECT
            org_id, apikey_id, service, model,
            latency_sum, success_count, record_count, interval, total_token_count, cost_sum,
            thread_id, version_id, bridge_id
        FROM daily_data_aggregate
        WHERE interval > (SELECT COALESCE(MAX(created_at), 'epoch'::timestamp) FROM daily_data)
        ON CONFLICT (org_id, service, bridge_id, apikey_id, thread_id, version_id, model, created_at)
        DO UPDATE SET
            cost_sum = daily_data.cost_sum + EXCLUDED.cost_sum,
            latency_sum = daily_data.latency_sum + EXCLUDED.latency_sum,
            record_count = daily_data.record_count + EXCLUDED.record_count,
            success_count = daily_data.success_count + EXCLUDED.success_count,
            total_token_count = daily_data.total_token_count + EXCLUDED.total_token_count;
      END;
      $$;
    `);
  }
};
