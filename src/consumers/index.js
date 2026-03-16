import dotenv from "dotenv";
import logger from "../logger.js";
import rabbitmqService from "../services/rabbitmq.service.js";
import { logQueueConsumerConfig } from "./logQueueConsumer.js";

dotenv.config();
const CONSUMER_ENABLED = process.env.CONSUMER_ENABLED?.toLowerCase() === "true";
const LOG_QUEUE_CONSUMER_ENABLED = process.env.LOG_QUEUE_CONSUMER_ENABLED?.toLowerCase() === "true";

// Configure consumers array
const CONSUMERS = [];

// Add log queue consumer if enabled
if (LOG_QUEUE_CONSUMER_ENABLED) {
  CONSUMERS.push(logQueueConsumerConfig);
}

class Consumer {
  constructor(obj, connectionString) {
    console.log("in contructor ");
    this.queueName = obj.queueName;
    this.processor = obj.process;
    this.bufferSize = obj.batchSize || 1; // Default value if prefetch is not provided
    this.logInInterval = obj.logInInterval || null;
    this.rabbitService = rabbitmqService(connectionString)
      .on("connect", (connection) => this.setup(connection))
      .on("error", (error) => console.log("[CONSUMER] Error in consumer connection:", error));
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
    this.channel.consume(
      this.queueName,
      async (message) => {
        if (!message) return this.setup(); // message is null means the queue is closed or deleted.
        try {
          await this.processor(message, this.channel);
        } catch (error) {
          console.log(`${this.queueName} Error in consuming`, error);
          throw error;
        }
      },
      { noAck: false }
    );

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
console.log(CONSUMER_ENABLED, process.env.DB_NAME, "CONSUMER  ADSF ");
if (CONSUMER_ENABLED) {
  (() => {
    CONSUMERS.forEach((consumer) => {
      new Consumer(consumer);
    });
  })();
}
