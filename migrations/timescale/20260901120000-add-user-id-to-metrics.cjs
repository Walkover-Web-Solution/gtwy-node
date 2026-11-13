"use strict";

const { MongoClient } = require("mongodb");

/**
 * Add user_id to metrics tables + continuous aggregates.
 *
 * Safety steps before dropping CAs:
 * 1) Flush any CA-only buckets into fifteen_minute_data / daily_data (ON CONFLICT DO NOTHING)
 *    so materialization is not lost when views are dropped.
 * 2) Add nullable user_id columns.
 * 3) Backfill user_id from Mongo configurations / configuration_versions
 *    (prefer version.user_id, else bridge/configuration.user_id via bridge_id).
 * 4) Recreate unique indexes, CAs, transfer functions, and retention policies.
 *
 * Requires: MONGODB_CONNECTION_URI, MONGODB_DATABASE_NAME (for backfill).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // -------------------------------------------------------------------------
    // 1) Preserve CA-only buckets before DROP (no double-count: DO NOTHING)
    // -------------------------------------------------------------------------
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM timescaledb_information.continuous_aggregates
          WHERE view_name = 'fifteen_min_data_aggregate'
        ) THEN
          INSERT INTO fifteen_minute_data
              (org_id, apikey_id, service, model,
               latency_sum, success_count, record_count, created_at, total_token_count, cost_sum,
               thread_id, version_id, bridge_id, time_zone)
          SELECT
              org_id, apikey_id, service, model,
              latency_sum, success_count, record_count, interval, total_token_count, cost_sum,
              thread_id, version_id, bridge_id, time_zone
          FROM fifteen_min_data_aggregate
          ON CONFLICT (org_id, service, bridge_id, apikey_id, thread_id, version_id, model, created_at)
          DO NOTHING;
        END IF;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM timescaledb_information.continuous_aggregates
          WHERE view_name = 'daily_data_aggregate'
        ) THEN
          INSERT INTO daily_data
              (org_id, apikey_id, service, model,
               latency_sum, success_count, record_count, created_at, total_token_count, cost_sum,
               thread_id, version_id, bridge_id)
          SELECT
              org_id, apikey_id, service, model,
              latency_sum, success_count, record_count, interval, total_token_count, cost_sum,
              thread_id, version_id, bridge_id
          FROM daily_data_aggregate
          ON CONFLICT (org_id, service, bridge_id, apikey_id, thread_id, version_id, model, created_at)
          DO NOTHING;
        END IF;
      END $$;
    `);

    // -------------------------------------------------------------------------
    // 2) Add user_id columns
    // -------------------------------------------------------------------------
    await queryInterface.sequelize.query(`
      ALTER TABLE metrics_raw_data
      ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data
      ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data
      ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
    `);

    // -------------------------------------------------------------------------
    // 3) Backfill user_id from Mongo bridge / version docs
    // -------------------------------------------------------------------------
    await backfillUserIdsFromMongo(queryInterface);

    // -------------------------------------------------------------------------
    // 4) Recreate unique indexes including user_id
    // -------------------------------------------------------------------------
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS unique_constraint_org_service_model_created_at;
    `);
    await queryInterface.addIndex("fifteen_minute_data", {
      fields: ["org_id", "service", "bridge_id", "version_id", "thread_id", "apikey_id", "model", "user_id", "created_at"],
      unique: true,
      name: "unique_constraint_org_service_model_created_at"
    });

    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS unique_constraint_daily_org_service_model_created_at;
    `);
    await queryInterface.addIndex("daily_data", {
      fields: ["org_id", "service", "bridge_id", "version_id", "thread_id", "apikey_id", "model", "user_id", "created_at"],
      unique: true,
      name: "unique_constraint_daily_org_service_model_created_at"
    });

    // -------------------------------------------------------------------------
    // 5) Recreate fifteen-min continuous aggregate + policy + retention
    // -------------------------------------------------------------------------
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
      SELECT add_retention_policy('fifteen_min_data_aggregate', INTERVAL '1 day');
    `);

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

    // -------------------------------------------------------------------------
    // 6) Recreate daily continuous aggregate + policy + retention
    // -------------------------------------------------------------------------
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
      SELECT add_retention_policy('daily_data_aggregate', INTERVAL '3 days');
    `);

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
      SELECT remove_retention_policy('daily_data_aggregate', if_exists => true);
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
      SELECT add_retention_policy('daily_data_aggregate', INTERVAL '3 days');
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
      SELECT remove_retention_policy('fifteen_min_data_aggregate', if_exists => true);
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
    await queryInterface.sequelize.query(`
      SELECT add_retention_policy('fifteen_min_data_aggregate', INTERVAL '1 day');
    `);

    await queryInterface.removeColumn("metrics_raw_data", "user_id");
  }
};

/**
 * Load bridge/version user_id from Mongo and update metrics tables.
 * Prefer version_id match, else bridge_id (configuration) match.
 */
async function backfillUserIdsFromMongo(queryInterface) {
  const mongoUrl = process.env.MONGODB_CONNECTION_URI;
  if (!mongoUrl) {
    throw new Error("MONGODB_CONNECTION_URI env var is required to backfill metrics user_id from bridge data");
  }

  const mongoClient = new MongoClient(mongoUrl);
  try {
    console.log("[metrics user_id] Connecting to MongoDB for bridge/version user_id backfill...");
    await mongoClient.connect();
    const db = mongoClient.db(process.env.MONGODB_DATABASE_NAME);

    const bridgeDocs = await db
      .collection("configurations")
      .find({ user_id: { $exists: true, $ne: null } }, { projection: { _id: 1, user_id: 1 } })
      .toArray();

    const versionDocs = await db
      .collection("configuration_versions")
      .find({ user_id: { $exists: true, $ne: null } }, { projection: { _id: 1, user_id: 1 } })
      .toArray();

    console.log(`[metrics user_id] Loaded ${bridgeDocs.length} bridges and ${versionDocs.length} versions from Mongo`);

    // Staging tables (not TEMP) so they survive across pooled connections; dropped in finally.
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS _metrics_bridge_user_map_migration;`);
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS _metrics_version_user_map_migration;`);
    await queryInterface.sequelize.query(`
      CREATE TABLE _metrics_bridge_user_map_migration (
        bridge_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL
      );
    `);
    await queryInterface.sequelize.query(`
      CREATE TABLE _metrics_version_user_map_migration (
        version_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL
      );
    `);

    await bulkInsertMap(queryInterface, "_metrics_bridge_user_map_migration", "bridge_id", bridgeDocs);
    await bulkInsertMap(queryInterface, "_metrics_version_user_map_migration", "version_id", versionDocs);

    const tables = ["metrics_raw_data", "fifteen_minute_data", "daily_data"];

    // Prefer version.user_id when version_id is present
    for (const table of tables) {
      const [, versionMeta] = await queryInterface.sequelize.query(`
        UPDATE ${table} AS m
        SET user_id = v.user_id
        FROM _metrics_version_user_map_migration AS v
        WHERE m.user_id IS NULL
          AND m.version_id IS NOT NULL
          AND m.version_id = v.version_id;
      `);
      console.log(`[metrics user_id] ${table}: backfilled ${versionMeta?.rowCount ?? 0} row(s) from version_id`);
    }

    // Fallback to bridge/configuration.user_id via bridge_id
    for (const table of tables) {
      const [, bridgeMeta] = await queryInterface.sequelize.query(`
        UPDATE ${table} AS m
        SET user_id = b.user_id
        FROM _metrics_bridge_user_map_migration AS b
        WHERE m.user_id IS NULL
          AND m.bridge_id IS NOT NULL
          AND m.bridge_id = b.bridge_id;
      `);
      console.log(`[metrics user_id] ${table}: backfilled ${bridgeMeta?.rowCount ?? 0} row(s) from bridge_id`);
    }
  } finally {
    try {
      await queryInterface.sequelize.query(`DROP TABLE IF EXISTS _metrics_bridge_user_map_migration;`);
      await queryInterface.sequelize.query(`DROP TABLE IF EXISTS _metrics_version_user_map_migration;`);
    } catch (cleanupErr) {
      console.warn(`[metrics user_id] staging table cleanup failed: ${cleanupErr.message}`);
    }
    await mongoClient.close();
  }
}

async function bulkInsertMap(queryInterface, tableName, idColumn, docs) {
  const BATCH = 500;
  const rows = [];
  for (const doc of docs) {
    const id = doc._id != null ? String(doc._id) : null;
    const userId = doc.user_id != null ? String(doc.user_id) : null;
    if (!id || !userId) continue;
    rows.push({ id, userId });
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const values = chunk.map((_, idx) => `(:id${idx}, :user${idx})`).join(", ");
    const replacements = {};
    chunk.forEach((row, idx) => {
      replacements[`id${idx}`] = row.id;
      replacements[`user${idx}`] = row.userId;
    });
    await queryInterface.sequelize.query(
      `INSERT INTO ${tableName} (${idColumn}, user_id) VALUES ${values}
       ON CONFLICT (${idColumn}) DO UPDATE SET user_id = EXCLUDED.user_id`,
      { replacements }
    );
  }
}
