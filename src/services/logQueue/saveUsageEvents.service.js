import logger from "../../logger.js";
import { timescalePool } from "../db.service.js";
import rabbitmqService from "../rabbitmq.service.js";

const FAILED_QUEUE_NAME = process.env.USAGE_EVENTS_FAILED_QUEUE_NAME || "usage_events_failed";

async function saveUsageEvents(events) {
  if (!events || events.length === 0) {
    return;
  }

  const client = await timescalePool.connect();

  try {
    const values = events
      .map(
        (event, idx) =>
          `(
        $${idx * 12 + 1}::uuid,
        $${idx * 12 + 2}::text,
        $${idx * 12 + 3}::text,
        $${idx * 12 + 4}::text,
        $${idx * 12 + 5}::text,
        $${idx * 12 + 6}::text,
        $${idx * 12 + 7}::text,
        $${idx * 12 + 8}::text,
        $${idx * 12 + 9}::integer,
        $${idx * 12 + 10}::integer,
        $${idx * 12 + 11}::numeric,
        $${idx * 12 + 12}::text
      )`
      )
      .join(",");

    const flatParams = events.flatMap((event) => [
      event.request_id,
      event.org_id,
      event.bridge_id,
      event.folder_id || null,
      event.apikey_id || null,
      event.service,
      event.model,
      event.status || "success",
      event.tokens_in || 0,
      event.tokens_out || 0,
      event.cost_usd || 0,
      event.timestamp || new Date().toISOString()
    ]);

    const query = `
      INSERT INTO usage_events (
        request_id,
        org_id,
        bridge_id,
        folder_id,
        apikey_id,
        service,
        model,
        status,
        tokens_in,
        tokens_out,
        cost_usd,
        timestamp
      )
      VALUES ${values}
      ON CONFLICT (request_id) DO NOTHING
    `;

    await client.query(query, flatParams);
    logger.info(`[SaveUsageEvents] Inserted ${events.length} usage events`);
  } catch (error) {
    logger.error(`[SaveUsageEvents] Error inserting events: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

async function publishFailedUsageEvents(events) {
  try {
    const service = rabbitmqService(process.env.QUEUE_CONNECTIONURL);

    return new Promise((resolve) => {
      service.on("connect", async (connection) => {
        try {
          const channel = await connection.createChannel();
          await channel.assertQueue(FAILED_QUEUE_NAME, { durable: true });

          for (const event of events) {
            const message = {
              content: Buffer.from(JSON.stringify(event)),
              options: { persistent: true }
            };
            await channel.sendToQueue(FAILED_QUEUE_NAME, message.content, message.options);
          }

          logger.info(`[PublishFailedUsageEvents] Published ${events.length} failed events to ${FAILED_QUEUE_NAME}`);
          resolve(true);
        } catch (err) {
          logger.error(`[PublishFailedUsageEvents] Error publishing failed events: ${err.message}`);
          resolve(false);
        }
      });

      service.on("error", (error) => {
        logger.error(`[PublishFailedUsageEvents] RabbitMQ error: ${error.message}`);
        resolve(false);
      });
    });
  } catch (err) {
    logger.error(`[PublishFailedUsageEvents] Unexpected error: ${err.message}`);
    return false;
  }
}

export { saveUsageEvents, publishFailedUsageEvents };
