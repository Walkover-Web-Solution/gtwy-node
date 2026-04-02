"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // Pass 1: strict key match on UTC day boundary from raw data.
    await queryInterface.sequelize.query(`
      WITH src AS (
        SELECT
          NULLIF(TRIM(org_id), '') AS org_id,
          NULLIF(TRIM(bridge_id), '') AS bridge_id,
          NULLIF(TRIM(version_id), '') AS version_id,
          NULLIF(TRIM(thread_id), '') AS thread_id,
          NULLIF(TRIM(apikey_id), '') AS apikey_id,
          NULLIF(TRIM(service), '') AS service,
          NULLIF(TRIM(model), '') AS model,
          (created_at AT TIME ZONE 'UTC')::date AS day_bucket,
          SUM(COALESCE(input_tokens, 0)) AS input_tokens,
          SUM(COALESCE(output_tokens, 0)) AS output_tokens
        FROM metrics_raw_data
        GROUP BY 1,2,3,4,5,6,7,8
      )
      UPDATE daily_data d
      SET
        input_tokens = s.input_tokens,
        output_tokens = s.output_tokens
      FROM src s
      WHERE (d.created_at AT TIME ZONE 'UTC')::date = s.day_bucket
        AND NULLIF(TRIM(d.org_id), '') IS NOT DISTINCT FROM s.org_id
        AND NULLIF(TRIM(d.bridge_id), '') IS NOT DISTINCT FROM s.bridge_id
        AND NULLIF(TRIM(d.version_id), '') IS NOT DISTINCT FROM s.version_id
        AND NULLIF(TRIM(d.thread_id), '') IS NOT DISTINCT FROM s.thread_id
        AND NULLIF(TRIM(d.apikey_id), '') IS NOT DISTINCT FROM s.apikey_id
        AND NULLIF(TRIM(d.service), '') IS NOT DISTINCT FROM s.service
        AND NULLIF(TRIM(d.model), '') IS NOT DISTINCT FROM s.model
        AND (d.input_tokens IS NULL OR d.output_tokens IS NULL);
    `);

    // Pass 2: strict key match on IST day boundary from raw data.
    await queryInterface.sequelize.query(`
      WITH src AS (
        SELECT
          NULLIF(TRIM(org_id), '') AS org_id,
          NULLIF(TRIM(bridge_id), '') AS bridge_id,
          NULLIF(TRIM(version_id), '') AS version_id,
          NULLIF(TRIM(thread_id), '') AS thread_id,
          NULLIF(TRIM(apikey_id), '') AS apikey_id,
          NULLIF(TRIM(service), '') AS service,
          NULLIF(TRIM(model), '') AS model,
          (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day_bucket,
          SUM(COALESCE(input_tokens, 0)) AS input_tokens,
          SUM(COALESCE(output_tokens, 0)) AS output_tokens
        FROM metrics_raw_data
        GROUP BY 1,2,3,4,5,6,7,8
      )
      UPDATE daily_data d
      SET
        input_tokens = s.input_tokens,
        output_tokens = s.output_tokens
      FROM src s
      WHERE (d.created_at AT TIME ZONE 'Asia/Kolkata')::date = s.day_bucket
        AND NULLIF(TRIM(d.org_id), '') IS NOT DISTINCT FROM s.org_id
        AND NULLIF(TRIM(d.bridge_id), '') IS NOT DISTINCT FROM s.bridge_id
        AND NULLIF(TRIM(d.version_id), '') IS NOT DISTINCT FROM s.version_id
        AND NULLIF(TRIM(d.thread_id), '') IS NOT DISTINCT FROM s.thread_id
        AND NULLIF(TRIM(d.apikey_id), '') IS NOT DISTINCT FROM s.apikey_id
        AND NULLIF(TRIM(d.service), '') IS NOT DISTINCT FROM s.service
        AND NULLIF(TRIM(d.model), '') IS NOT DISTINCT FROM s.model
        AND (d.input_tokens IS NULL OR d.output_tokens IS NULL);
    `);

    // Pass 3: safe-loose fallback (only where daily dims are already null).
    await queryInterface.sequelize.query(`
      WITH src AS (
        SELECT
          NULLIF(TRIM(org_id), '') AS org_id,
          NULLIF(TRIM(bridge_id), '') AS bridge_id,
          NULLIF(TRIM(service), '') AS service,
          NULLIF(TRIM(model), '') AS model,
          (created_at AT TIME ZONE 'UTC')::date AS day_bucket,
          SUM(COALESCE(input_tokens, 0)) AS input_tokens,
          SUM(COALESCE(output_tokens, 0)) AS output_tokens
        FROM metrics_raw_data
        GROUP BY 1,2,3,4,5
      )
      UPDATE daily_data d
      SET
        input_tokens = s.input_tokens,
        output_tokens = s.output_tokens
      FROM src s
      WHERE (d.created_at AT TIME ZONE 'UTC')::date = s.day_bucket
        AND NULLIF(TRIM(d.org_id), '') IS NOT DISTINCT FROM s.org_id
        AND NULLIF(TRIM(d.bridge_id), '') IS NOT DISTINCT FROM s.bridge_id
        AND NULLIF(TRIM(d.service), '') IS NOT DISTINCT FROM s.service
        AND NULLIF(TRIM(d.model), '') IS NOT DISTINCT FROM s.model
        AND d.version_id IS NULL
        AND d.thread_id IS NULL
        AND d.apikey_id IS NULL
        AND (d.input_tokens IS NULL OR d.output_tokens IS NULL);
    `);

    // Pass 4: safe-loose fallback on IST day boundary.
    await queryInterface.sequelize.query(`
      WITH src AS (
        SELECT
          NULLIF(TRIM(org_id), '') AS org_id,
          NULLIF(TRIM(bridge_id), '') AS bridge_id,
          NULLIF(TRIM(service), '') AS service,
          NULLIF(TRIM(model), '') AS model,
          (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day_bucket,
          SUM(COALESCE(input_tokens, 0)) AS input_tokens,
          SUM(COALESCE(output_tokens, 0)) AS output_tokens
        FROM metrics_raw_data
        GROUP BY 1,2,3,4,5
      )
      UPDATE daily_data d
      SET
        input_tokens = s.input_tokens,
        output_tokens = s.output_tokens
      FROM src s
      WHERE (d.created_at AT TIME ZONE 'Asia/Kolkata')::date = s.day_bucket
        AND NULLIF(TRIM(d.org_id), '') IS NOT DISTINCT FROM s.org_id
        AND NULLIF(TRIM(d.bridge_id), '') IS NOT DISTINCT FROM s.bridge_id
        AND NULLIF(TRIM(d.service), '') IS NOT DISTINCT FROM s.service
        AND NULLIF(TRIM(d.model), '') IS NOT DISTINCT FROM s.model
        AND d.version_id IS NULL
        AND d.thread_id IS NULL
        AND d.apikey_id IS NULL
        AND (d.input_tokens IS NULL OR d.output_tokens IS NULL);
    `);
  },

  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    // No-op: data backfill migration is not safely reversible.
  }
};
