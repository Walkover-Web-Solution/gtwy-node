import logger from "../logger.js";
import { saveUsageEvents, publishFailedUsageEvents } from "../services/logQueue/saveUsageEvents.service.js";

const BATCH_SIZE = 1000;
const FLUSH_INTERVAL_MS = 1000;

class UsageEventsBatcher {
  constructor() {
    this.buffer = [];
    this.pendingMessages = [];
    this.flushTimer = null;
  }

  async flush(trigger) {
    if (this.pendingMessages.length === 0) return;

    const rowsToInsert = this.buffer.splice(0);
    const msgsToAck = this.pendingMessages.splice(0);

    logger.info(`[UsageEventsQueue] Flushing ${msgsToAck.length} messages (${rowsToInsert.length} rows) — trigger: ${trigger}`);

    try {
      await saveUsageEvents(rowsToInsert);
      msgsToAck.forEach(({ message, channel }) => channel.ack(message));
      logger.info(`[UsageEventsQueue] Flush complete — ${rowsToInsert.length} rows inserted`);
    } catch (err) {
      logger.error(`[UsageEventsQueue] Flush failed: ${err.message}`);
      const shifted = await publishFailedUsageEvents(rowsToInsert, err);
      if (shifted) {
        msgsToAck.forEach(({ message, channel }) => channel.ack(message));
      } else {
        msgsToAck.forEach(({ message, channel }) => channel.nack(message, false, false));
      }
    }
  }

  scheduleFlush() {
    if (!this.flushTimer) {
      logger.info(`[UsageEventsQueue] Timer flush scheduled in ${FLUSH_INTERVAL_MS / 1000}s`);
      this.flushTimer = setTimeout(async () => {
        this.flushTimer = null;
        await this.flush("timer");
      }, FLUSH_INTERVAL_MS);
    }
  }

  async process(message, channel) {
    try {
      const data = JSON.parse(message.content.toString());
      this.buffer.push(data);
      this.pendingMessages.push({ message, channel });

      if (this.pendingMessages.length >= BATCH_SIZE) {
        if (this.flushTimer) {
          clearTimeout(this.flushTimer);
          this.flushTimer = null;
        }
        await this.flush("batch-full");
      } else {
        this.scheduleFlush();
      }
    } catch (err) {
      logger.error(`[UsageEventsQueue] Error processing message: ${err.message}`);
      channel.nack(message, false, false);
    }
  }
}

const batcher = new UsageEventsBatcher();

async function usageEventsQueueProcessor(message, channel) {
  await batcher.process(message, channel);
}

export { usageEventsQueueProcessor };
