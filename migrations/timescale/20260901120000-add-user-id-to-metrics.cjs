"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE metrics_raw_data
      ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
    `);

    await queryInterface.sequelize.query(`
      SELECT remove_continuous_aggregate_policy('fifteen_min_data_aggregate', if_exists => true);
    `);
    await queryInterface.sequelize.query(`
      DROP MATERIALIZED VIEW IF EXISTS fifteen_min_data_aggregate;
    `);
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
          user_id,
          time_bucket('15 minutes', created_at) as interval,
          COUNT(*) FILTER (where success = true) AS success_count,
          SUM(latency) AS latency_sum,
          SUM(cost) AS cost_sum,
          SUM(total_tokens) AS total_token_count,
          COUNT(*) AS record_count
      FROM metrics_raw_data
      GROUP BY
          org_id, bridge_id, version_id, interval, service, apikey_id, model, thread_id, time_zone, user_id;
    `);
    await queryInterface.sequelize.query(`
      SELECT add_continuous_aggregate_policy('fifteen_min_data_aggregate',
          start_offset => INTERVAL '1 hour',
          end_offset => INTERVAL '0',
          schedule_interval => INTERVAL '15 minutes',
          initial_start => '2024-12-24 00:30:00+00'
      );
    `);
    await queryInterface.sequelize.query(`
      SELECT set_chunk_time_interval('fifteen_min_data_aggregate', INTERVAL '1 day');
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data
      ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
    `);
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS unique_constraint_org_service_model_created_at;
    `);
    await queryInterface.addIndex("fifteen_minute_data", {
      fields: ["org_id", "service", "bridge_id", "version_id", "thread_id", "apikey_id", "model", "user_id", "created_at"],
      unique: true,
      name: "unique_constraint_org_service_model_created_at"
    });

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_fifteen_minute_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO fifteen_minute_data
            (org_id, apikey_id, service, model,
             latency_sum, success_count, record_count, created_at, total_token_count, cost_sum, thread_id, version_id, bridge_id, time_zone, user_id)
        SELECT
            org_id, apikey_id, service, model,
            latency_sum, success_count, record_count, interval, total_token_count, cost_sum, thread_id, version_id, bridge_id, time_zone, user_id
        FROM fifteen_min_data_aggregate
        WHERE interval > (SELECT COALESCE(MAX(created_at), 'epoch'::timestamp) FROM fifteen_minute_data)
        ON CONFLICT (org_id, service, bridge_id, version_id, thread_id, apikey_id, model, user_id, created_at)
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
      SELECT remove_continuous_aggregate_policy('daily_data_aggregate', if_exists => true);
    `);
    await queryInterface.sequelize.query(`
      DROP MATERIALIZED VIEW IF EXISTS daily_data_aggregate;
    `);
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
          user_id,
          time_bucket('1 day', created_at) as interval,
          SUM(success_count) AS success_count,
          SUM(latency_sum) AS latency_sum,
          SUM(cost_sum) AS cost_sum,
          SUM(record_count) AS record_count,
          SUM(total_token_count) AS total_token_count
        FROM fifteen_minute_data where time_zone = 'Asia/Kolkata'
        GROUP BY
          org_id, bridge_id, version_id, interval, service, apikey_id, model, thread_id, user_id;
    `);
    await queryInterface.sequelize.query(`
      SELECT add_continuous_aggregate_policy('daily_data_aggregate',
          start_offset => INTERVAL '3 days',
          end_offset => INTERVAL '0',
          schedule_interval => INTERVAL '1 day',
          initial_start => '2024-12-24 18:30:00+00'::timestamptz
      );
    `);
    await queryInterface.sequelize.query(`
      SELECT set_chunk_time_interval('daily_data_aggregate', INTERVAL '1 day');
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data
      ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
    `);
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS unique_constraint_daily_org_service_model_created_at;
    `);
    await queryInterface.addIndex("daily_data", {
      fields: ["org_id", "service", "bridge_id", "version_id", "thread_id", "apikey_id", "model", "user_id", "created_at"],
      unique: true,
      name: "unique_constraint_daily_org_service_model_created_at"
    });

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_daily_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO daily_data
            (org_id, apikey_id, service, model,
              latency_sum, success_count, record_count, created_at, total_token_count, cost_sum, thread_id, version_id, bridge_id, user_id)
        SELECT
            org_id, apikey_id, service, model,
            latency_sum, success_count, record_count, interval, total_token_count, cost_sum, thread_id, version_id, bridge_id, user_id
        FROM daily_data_aggregate
        WHERE interval > (SELECT COALESCE(MAX(created_at), 'epoch'::timestamp) FROM daily_data)
        ON CONFLICT (org_id, service, bridge_id, version_id, thread_id, apikey_id, model, user_id, created_at)
        DO UPDATE SET
        cost_sum = daily_data.cost_sum + EXCLUDED.cost_sum,
        latency_sum = daily_data.latency_sum + EXCLUDED.latency_sum,
        record_count = daily_data.record_count + EXCLUDED.record_count,
        success_count = daily_data.success_count + EXCLUDED.success_count,
        total_token_count = daily_data.total_token_count + EXCLUDED.total_token_count;
        END;
        $$;
    `);
  },

  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_daily_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO daily_data
            (org_id, apikey_id , service, model,
              latency_sum, success_count, record_count, created_at, total_token_count, cost_sum, thread_id, version_id, bridge_id)
        SELECT
            org_id, apikey_id, service, model,
            latency_sum, success_count, record_count, interval, total_token_count, cost_sum, thread_id, version_id, bridge_id
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

    await queryInterface.removeIndex("daily_data", "unique_constraint_daily_org_service_model_created_at");
    await queryInterface.addIndex("daily_data", {
      fields: ["org_id", "service", "bridge_id", "version_id", "thread_id", "apikey_id", "model", "created_at"],
      unique: true,
      name: "unique_constraint_daily_org_service_model_created_at"
    });
    await queryInterface.removeColumn("daily_data", "user_id");

    await queryInterface.sequelize.query(`
      SELECT remove_continuous_aggregate_policy('daily_data_aggregate', if_exists => true);
    `);
    await queryInterface.sequelize.query(`
      DROP MATERIALIZED VIEW IF EXISTS daily_data_aggregate;
    `);
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
          SUM(total_token_count) AS total_token_count
        FROM fifteen_minute_data where time_zone = 'Asia/Kolkata'
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
    await queryInterface.sequelize.query(`
      SELECT set_chunk_time_interval('daily_data_aggregate', INTERVAL '1 day');
    `);

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION insert_into_fifteen_minute_data(job_id int, config jsonb)
      RETURNS void LANGUAGE plpgsql AS
      $$
      BEGIN
        INSERT INTO fifteen_minute_data
            (org_id, apikey_id, service, model,
             latency_sum, success_count, record_count, created_at, total_token_count, cost_sum, thread_id, version_id, bridge_id, time_zone)
        SELECT
            org_id, apikey_id, service, model,
            latency_sum, success_count, record_count, interval, total_token_count, cost_sum, thread_id, version_id, bridge_id, time_zone
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

    await queryInterface.removeIndex("fifteen_minute_data", "unique_constraint_org_service_model_created_at");
    await queryInterface.addIndex("fifteen_minute_data", {
      fields: ["org_id", "service", "bridge_id", "version_id", "thread_id", "apikey_id", "model", "created_at"],
      unique: true,
      name: "unique_constraint_org_service_model_created_at"
    });
    await queryInterface.removeColumn("fifteen_minute_data", "user_id");

    await queryInterface.sequelize.query(`
      SELECT remove_continuous_aggregate_policy('fifteen_min_data_aggregate', if_exists => true);
    `);
    await queryInterface.sequelize.query(`
      DROP MATERIALIZED VIEW IF EXISTS fifteen_min_data_aggregate;
    `);
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
    await queryInterface.sequelize.query(`
      SELECT set_chunk_time_interval('fifteen_min_data_aggregate', INTERVAL '1 day');
    `);

    await queryInterface.removeColumn("metrics_raw_data", "user_id");
  }
};
