"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // Fallback backfill for daily_data using IST day bucket and normalized keys.
    await queryInterface.sequelize.query(`
      WITH daily_source AS (
        SELECT
          NULLIF(TRIM(org_id), '') AS org_id,
          NULLIF(TRIM(bridge_id), '') AS bridge_id,
          NULLIF(TRIM(version_id), '') AS version_id,
          NULLIF(TRIM(thread_id), '') AS thread_id,
          NULLIF(TRIM(apikey_id), '') AS apikey_id,
          NULLIF(TRIM(service), '') AS service,
          NULLIF(TRIM(model), '') AS model,
          (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
          SUM(COALESCE(input_tokens, 0)) AS input_tokens,
          SUM(COALESCE(output_tokens, 0)) AS output_tokens
        FROM fifteen_minute_data
        GROUP BY
          NULLIF(TRIM(org_id), ''),
          NULLIF(TRIM(bridge_id), ''),
          NULLIF(TRIM(version_id), ''),
          NULLIF(TRIM(thread_id), ''),
          NULLIF(TRIM(apikey_id), ''),
          NULLIF(TRIM(service), ''),
          NULLIF(TRIM(model), ''),
          (created_at AT TIME ZONE 'Asia/Kolkata')::date
      )
      UPDATE daily_data d
      SET
        input_tokens = s.input_tokens,
        output_tokens = s.output_tokens
      FROM daily_source s
      WHERE (d.created_at AT TIME ZONE 'Asia/Kolkata')::date = s.day_ist
        AND NULLIF(TRIM(d.org_id), '') IS NOT DISTINCT FROM s.org_id
        AND NULLIF(TRIM(d.bridge_id), '') IS NOT DISTINCT FROM s.bridge_id
        AND NULLIF(TRIM(d.version_id), '') IS NOT DISTINCT FROM s.version_id
        AND NULLIF(TRIM(d.thread_id), '') IS NOT DISTINCT FROM s.thread_id
        AND NULLIF(TRIM(d.apikey_id), '') IS NOT DISTINCT FROM s.apikey_id
        AND NULLIF(TRIM(d.service), '') IS NOT DISTINCT FROM s.service
        AND NULLIF(TRIM(d.model), '') IS NOT DISTINCT FROM s.model
        AND (d.input_tokens IS NULL OR d.output_tokens IS NULL);
    `);
  },

  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    // No-op: data backfill migration is not safely reversible.
  }
};
