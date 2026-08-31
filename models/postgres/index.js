import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import Sequelize from "sequelize";
import process from "process";
import * as url from "url";
import { logSlowCall } from "../../src/services/utils/slowCallLogger.js";
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

dotenv.config();

const basename = path.basename(new URL(import.meta.url).pathname);
const db = {};

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
  dialect: "postgres",
  host: process.env.DB_HOST,
  define: {
    freezeTableName: true
  },
  retry: {
    match: [/Deadlock/i, Sequelize.ConnectionError],
    max: 100,
    backoffBase: 3000,
    backoffExponent: 1.5
  },
  // Measure every query and warn on slow ones so we can tell when PG is the bottleneck.
  benchmark: true,
  logging: (sql, timingMs) => logSlowCall("pg", sql, timingMs)
});

const dbservice = async () => {
  try {
    await sequelize.sync();
    console.log("Connection has been established successfully with postgres.");
  } catch (error) {
    console.error("Unable to connect to the database:", error);
  }
};
dbservice();

const files = await fs.promises.readdir(__dirname);
for (const file of files) {
  if (file.indexOf(".") !== 0 && file !== basename && file.slice(-3) === ".js") {
    const model = await import(new URL(file, import.meta.url));
    const modelInstance = await model.default(sequelize, Sequelize.DataTypes);
    db[modelInstance.name] = modelInstance;
  }
}
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;
db.queryInterface = sequelize.getQueryInterface();
export default db;
