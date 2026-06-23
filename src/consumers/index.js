import dotenv from "dotenv";
import logger from "../logger.js";
import rabbitmqService from "../services/rabbitmq.service.js";
import { logQueueProcessor } from "./logQueueConsumer.js";
import { metricsQueueProcessor } from "./metricsQueueConsumer.js";

dotenv.config();
const CONSUMERS = [
  {
    queueName: process.env.LOG_QUEUE_NAME,
    process: logQueueProcessor,
    batchSize: 10
  },
  {
    queueName: process.env.METRICS_QUEUE_NAME,
    process: metricsQueueProcessor,
    batchSize: 100
  }
];

class Consumer {
  constructor(obj, connectionString) {
    this.queueName = obj.queueName;
    this.processor = obj.process;
    this.bufferSize = obj.batchSize || 1; // Default value if prefetch is not provided
    this.logInInterval = obj.logInInterval || null;
    this.rabbitService = rabbitmqService(connectionString)
      .on("connect", (connection) => this.setup(connection))
      .on("retry", () => logger.warn(`[CONSUMER] ${this.queueName} - RabbitMQ connection retry in progress...`))
      .on("error", (error) => logger.error("[CONSUMER] Error in consumer connection:", error));

    // If the connection is already established (event fired before we registered),
    // call setup immediately so we don't miss it.
    if (this.rabbitService.status()) {
      this.setup(this.rabbitService.connection);
    }
  }

  async setup(connection) {
    logger.info(`Rabbitmq connected! - ${this.queueName}`);
    this.connection ||= connection;
    this.channel ||= await this.connection.createChannel();
    this.channel.prefetch(this.bufferSize);
    await this.channel.assertQueue(this.queueName, { durable: true });
    if (this.logInInterval) this.logInInterval(this.channel);
    this.start();
  }

  start() {
    this.inFlight = 0;
    this.channel
      .consume(
        this.queueName,
        async (message) => {
          if (!message) return this.setup(); // message is null means the queue is closed or deleted.
          this.inFlight++;
          try {
            await this.processor(message, this.channel);
          } catch (error) {
            logger.error(`${this.queueName} Error in consuming`, error);
          } finally {
            this.inFlight--;
          }
        },
        { noAck: false }
      )
      .then(({ consumerTag }) => {
        this.consumerTag = consumerTag;
      })
      .catch((error) => {
        logger.error(`${this.queueName} Failed to start consumer:`, error);
      });

    this.channel.on("error", async (error) => {
      logger.error(`${this.queueName} RabbitMQ connection error:`, error);
    });

    this.channel.on("close", () => {
      logger.error(`${this.queueName} RabbitMQ Channel closed:`);

      delete this.channel;
      this.setup();
    });
  }
}
const activeConsumers = [];

function init() {
  CONSUMERS.forEach((consumer) => {
    activeConsumers.push(new Consumer(consumer));
  });
}

export async function stopConsumers() {
  await Promise.all(
    activeConsumers.map(async (c) => {
      try {
        // Cancel delivery of new messages without closing the channel
        if (c.channel && c.consumerTag) {
          await c.channel.cancel(c.consumerTag);
        }

        // Wait for in-flight messages to finish acking (up to 30s)
        const deadline = Date.now() + 30_000;
        while (c.inFlight > 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (c.inFlight > 0) {
          logger.warn(`[CONSUMER] ${c.queueName} - ${c.inFlight} messages still in-flight after timeout`);
        }

        if (c.channel) await c.channel.close();
        if (c.connection) await c.connection.close();
      } catch (err) {
        logger.error(`[CONSUMER] Error stopping ${c.queueName}:`, err);
      }
    })
  );
}

init();
