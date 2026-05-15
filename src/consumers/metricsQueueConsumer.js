import logger from "../logger.js";
import { processMetrics, saveMetrics } from "../services/logQueue/saveMetrics.service.js";

const BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 300_000; // 5 minutes

class MetricsBatcher {
  constructor() {
    this.buffer = [];
    this.pendingMessages = [];
    this.flushTimer = null;
  }

  async flush(trigger) {
    if (this.pendingMessages.length === 0) return;

    const rowsToInsert = this.buffer.splice(0);
    const msgsToAck = this.pendingMessages.splice(0);

    logger.info(`[MetricsQueue] Flushing ${msgsToAck.length} messages (${rowsToInsert.length} rows) — trigger: ${trigger}`);

    try {
      await saveMetrics(rowsToInsert);
      msgsToAck.forEach(({ message, channel }) => channel.ack(message));
      logger.info(`[MetricsQueue] Flush complete — ${rowsToInsert.length} rows inserted`);
    } catch (err) {
      logger.error(`[MetricsQueue] Flush failed: ${err.message}`);
      msgsToAck.forEach(({ message, channel }) => channel.nack(message, false, false));
    }
  }

  scheduleFlush() {
    if (!this.flushTimer) {
      logger.info(`[MetricsQueue] Timer flush scheduled in ${FLUSH_INTERVAL_MS / 1000}s`);
      this.flushTimer = setTimeout(async () => {
        this.flushTimer = null;
        await this.flush("timer");
      }, FLUSH_INTERVAL_MS);
    }
  }

  async process(message, channel) {
    try {
      const data = JSON.parse(message.content.toString());
      const normalized = processMetrics(data.save_metrics || data.save_batch_metrics);
      this.buffer.push(...normalized);
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
      logger.error(`[MetricsQueue] Error processing message: ${err.message}`);
      channel.nack(message, false, false);
    }
  }
}

const batcher = new MetricsBatcher();

async function metricsQueueProcessor(message, channel) {
  await batcher.process(message, channel);
}

export { metricsQueueProcessor };
