"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // Update rollup job function: raw -> fifteen_minute_data
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_fifteen_minute_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO fifteen_minute_data
          (
            org_id, apikey_id, service, model,
            latency_sum, llm_latency_sum, tool_call_latency_sum, system_latency_sum,
            success_count, record_count, created_at, total_token_count, cost_sum,
            input_tokens, output_tokens,
            thread_id, version_id, bridge_id, time_zone
          )
        SELECT
          org_id,
          apikey_id,
          service,
          model,
          SUM(COALESCE(latency, 0)) AS latency_sum,
          SUM(COALESCE(llm_latency, 0)) AS llm_latency_sum,
          SUM(COALESCE(tool_call_latency, 0)) AS tool_call_latency_sum,
          SUM(COALESCE(system_latency, 0)) AS system_latency_sum,
          COUNT(*) FILTER (WHERE success = true) AS success_count,
          COUNT(*) AS record_count,
          time_bucket('15 minutes', created_at) AS created_at,
          SUM(COALESCE(total_tokens, 0)) AS total_token_count,
          SUM(COALESCE(cost, 0)) AS cost_sum,
          SUM(COALESCE(input_tokens, 0)) AS input_tokens,
          SUM(COALESCE(output_tokens, 0)) AS output_tokens,
          thread_id,
          version_id,
          bridge_id,
          time_zone
        FROM metrics_raw_data
        WHERE time_bucket('15 minutes', created_at) > (
          SELECT COALESCE(MAX(created_at), 'epoch'::timestamp) FROM fifteen_minute_data
        )
        GROUP BY
          org_id, apikey_id, service, model,
          thread_id, version_id, bridge_id, time_zone,
          time_bucket('15 minutes', created_at)
        ON CONFLICT (org_id, service, bridge_id, apikey_id, thread_id, version_id, model, created_at)
        DO UPDATE SET
          latency_sum = COALESCE(fifteen_minute_data.latency_sum, 0) + COALESCE(EXCLUDED.latency_sum, 0),
          llm_latency_sum = COALESCE(fifteen_minute_data.llm_latency_sum, 0) + COALESCE(EXCLUDED.llm_latency_sum, 0),
          tool_call_latency_sum = COALESCE(fifteen_minute_data.tool_call_latency_sum, 0) + COALESCE(EXCLUDED.tool_call_latency_sum, 0),
          system_latency_sum = COALESCE(fifteen_minute_data.system_latency_sum, 0) + COALESCE(EXCLUDED.system_latency_sum, 0),
          cost_sum = COALESCE(fifteen_minute_data.cost_sum, 0) + COALESCE(EXCLUDED.cost_sum, 0),
          record_count = COALESCE(fifteen_minute_data.record_count, 0) + COALESCE(EXCLUDED.record_count, 0),
          total_token_count = COALESCE(fifteen_minute_data.total_token_count, 0) + COALESCE(EXCLUDED.total_token_count, 0),
          input_tokens = COALESCE(fifteen_minute_data.input_tokens, 0) + COALESCE(EXCLUDED.input_tokens, 0),
          output_tokens = COALESCE(fifteen_minute_data.output_tokens, 0) + COALESCE(EXCLUDED.output_tokens, 0),
          success_count = COALESCE(fifteen_minute_data.success_count, 0) + COALESCE(EXCLUDED.success_count, 0);
      END;
      $$;
    `);

    // Update rollup job function: fifteen_minute_data -> daily_data
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_daily_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO daily_data
          (
            org_id, apikey_id, service, model,
            latency_sum, llm_latency_sum, tool_call_latency_sum, system_latency_sum,
            success_count, record_count, created_at, total_token_count, cost_sum,
            input_tokens, output_tokens,
            thread_id, version_id, bridge_id
          )
        SELECT
          org_id,
          apikey_id,
          service,
          model,
          SUM(COALESCE(latency_sum, 0)) AS latency_sum,
          SUM(COALESCE(llm_latency_sum, 0)) AS llm_latency_sum,
          SUM(COALESCE(tool_call_latency_sum, 0)) AS tool_call_latency_sum,
          SUM(COALESCE(system_latency_sum, 0)) AS system_latency_sum,
          SUM(COALESCE(success_count, 0)) AS success_count,
          SUM(COALESCE(record_count, 0)) AS record_count,
          time_bucket('1 day', created_at) AS created_at,
          SUM(COALESCE(total_token_count, 0)) AS total_token_count,
          SUM(COALESCE(cost_sum, 0)) AS cost_sum,
          SUM(COALESCE(input_tokens, 0)) AS input_tokens,
          SUM(COALESCE(output_tokens, 0)) AS output_tokens,
          thread_id,
          version_id,
          bridge_id
        FROM fifteen_minute_data
        WHERE time_bucket('1 day', created_at) > (
          SELECT COALESCE(MAX(created_at), 'epoch'::timestamp) FROM daily_data
        )
        GROUP BY
          org_id, apikey_id, service, model,
          thread_id, version_id, bridge_id,
          time_bucket('1 day', created_at)
        ON CONFLICT (org_id, service, bridge_id, apikey_id, thread_id, version_id, model, created_at)
        DO UPDATE SET
          latency_sum = COALESCE(daily_data.latency_sum, 0) + COALESCE(EXCLUDED.latency_sum, 0),
          llm_latency_sum = COALESCE(daily_data.llm_latency_sum, 0) + COALESCE(EXCLUDED.llm_latency_sum, 0),
          tool_call_latency_sum = COALESCE(daily_data.tool_call_latency_sum, 0) + COALESCE(EXCLUDED.tool_call_latency_sum, 0),
          system_latency_sum = COALESCE(daily_data.system_latency_sum, 0) + COALESCE(EXCLUDED.system_latency_sum, 0),
          cost_sum = COALESCE(daily_data.cost_sum, 0) + COALESCE(EXCLUDED.cost_sum, 0),
          record_count = COALESCE(daily_data.record_count, 0) + COALESCE(EXCLUDED.record_count, 0),
          success_count = COALESCE(daily_data.success_count, 0) + COALESCE(EXCLUDED.success_count, 0),
          total_token_count = COALESCE(daily_data.total_token_count, 0) + COALESCE(EXCLUDED.total_token_count, 0),
          input_tokens = COALESCE(daily_data.input_tokens, 0) + COALESCE(EXCLUDED.input_tokens, 0),
          output_tokens = COALESCE(daily_data.output_tokens, 0) + COALESCE(EXCLUDED.output_tokens, 0);
      END;
      $$;
    `);
  },

  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    // Restore previous function behavior (token rollups + overall latency only).
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
  }
};
