import rabbitmqService from "./rabbitmq.service.js";
import logger from "../logger.js";
import { configDotenv } from "dotenv";

let rabbitConnection;
let rabbitChannel;
configDotenv();
const RABBIT_CONNECTION_STRING = process.env.QUEUE_CONNECTIONURL || "";

class RabbitMqProducer {
  static instance;

  constructor() {
    logger.info("[PRODUCER] Listening for connection...");
    this.rabbitService = rabbitmqService(RABBIT_CONNECTION_STRING).on("connect", (connection) => this.setupChannel(connection));

    // If the connection is already established (event fired before we registered),
    // set up the channel immediately so we don't miss it.
    if (this.rabbitService.status()) {
      this.setupChannel(this.rabbitService.connection);
    }
  }

  async setupChannel(connection) {
    try {
      logger.info("[PRODUCER] Connection received...");
      rabbitConnection = connection;
      logger.info("[PRODUCER] Creating channel...");
      rabbitChannel = await rabbitConnection.createChannel();
    } catch (error) {
      logger.error("[PRODUCER] Failed to create channel:", error);
      rabbitChannel = undefined;
    }
  }

  static getSingletonInstance() {
    RabbitMqProducer.instance ||= new RabbitMqProducer();
    return RabbitMqProducer.instance;
  }

  async publishToQueue(queueName, payload) {
    try {
      if (!rabbitChannel) {
        throw new Error("RabbitMQ producer channel is not ready");
      }
      logger.debug("[PRODUCER] Preparing payload...");
      payload = typeof payload === "string" ? payload : JSON.stringify(payload);
      const payloadBuffer = Buffer.from(payload);
      logger.debug(`[PRODUCER] Asserting '${queueName}' queue...`);
      rabbitChannel.assertQueue(queueName, { durable: true });
      logger.debug(`[PRODUCER] Producing to '${queueName}' queue...`);
      await rabbitChannel.sendToQueue(queueName, payloadBuffer);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }
}

export default RabbitMqProducer.getSingletonInstance();
