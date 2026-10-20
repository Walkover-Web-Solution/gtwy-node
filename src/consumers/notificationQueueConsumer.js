import logger from "../logger.js";
import queueProducer from "../services/queue.service.js";
import { processEvent, InvalidNotificationEventError } from "../services/notifications/hub.service.js";

// Same "-Failed" suffix the Python queues use for their dead-letter queues.
const failedQueueName = () => `${process.env.NOTIFICATION_QUEUE_NAME}-Failed`;

async function notificationQueueProcessor(message, channel) {
  let event;
  try {
    event = JSON.parse(message.content.toString());
    await processEvent(event);
    channel.ack(message);
  } catch (err) {
    const reason = err instanceof InvalidNotificationEventError ? "invalid_event" : "processing_error";
    logger.error(`[NotificationQueue] ${reason}: ${err.message}`);
    try {
      await queueProducer.publishToQueue(failedQueueName(), {
        reason,
        error: err.message,
        original: event ?? message.content.toString()
      });
      channel.ack(message);
    } catch (publishError) {
      logger.error(`[NotificationQueue] could not move message to ${failedQueueName()}: ${publishError.message}`);
      channel.nack(message, false, false);
    }
  }
}

export { notificationQueueProcessor };
