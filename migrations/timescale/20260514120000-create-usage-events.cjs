/** @type {import('sequelize-cli').Migration} */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("usage_events", {
      id: {
        allowNull: false,
        autoIncrement: true,
        type: Sequelize.INTEGER
      },
      request_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true
      },
      org_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      bridge_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      folder_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      apikey_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      service: {
        type: Sequelize.STRING,
        allowNull: false
      },
      model: {
        type: Sequelize.STRING,
        allowNull: false
      },
      tokens_in: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      tokens_out: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      cost_usd: {
        type: Sequelize.DECIMAL(12, 6),
        allowNull: false,
        defaultValue: 0
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "success"
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW")
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW")
      }
    });

    await queryInterface.addIndex("usage_events", {
      fields: ["timestamp", "id"],
      name: "idx_usage_events_timestamp_id"
    });

    await queryInterface.addIndex("usage_events", {
      fields: ["request_id"],
      unique: true,
      name: "idx_usage_events_request_id"
    });

    await queryInterface.addIndex("usage_events", {
      fields: ["org_id"],
      name: "idx_usage_events_org_id"
    });

    await queryInterface.addIndex("usage_events", {
      fields: ["bridge_id"],
      name: "idx_usage_events_bridge_id"
    });

    await queryInterface.addIndex("usage_events", {
      fields: ["folder_id"],
      name: "idx_usage_events_folder_id"
    });

    await queryInterface.addIndex("usage_events", {
      fields: ["apikey_id"],
      name: "idx_usage_events_apikey_id"
    });

    await queryInterface.addIndex("usage_events", {
      fields: ["service"],
      name: "idx_usage_events_service"
    });

    await queryInterface.sequelize.query("SELECT create_hypertable('usage_events', by_range('timestamp', INTERVAL '1 day'), if_not_exists => TRUE);");

    await queryInterface.sequelize.query(
      "CREATE MATERIALIZED VIEW IF NOT EXISTS daily_usage_summary AS SELECT DATE_TRUNC('day', timestamp) as date, org_id, bridge_id, folder_id, apikey_id, service, COUNT(*) as request_count, SUM(tokens_in) as total_tokens_in, SUM(tokens_out) as total_tokens_out, SUM(cost_usd) as total_cost FROM usage_events GROUP BY DATE_TRUNC('day', timestamp), org_id, bridge_id, folder_id, apikey_id, service;"
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query("DROP MATERIALIZED VIEW IF EXISTS daily_usage_summary;");
    await queryInterface.dropTable("usage_events");
  }
};
