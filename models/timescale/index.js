import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import Sequelize from "sequelize";
import process from "process";
import * as url from "url";
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const basename = path.basename(__filename);
dotenv.config();
const db = {};

try {
  const sequelize = new Sequelize(process.env.TIMESCALE_SERVICE_URL, {
    dialect: "postgres",
    protocol: "postgres",
    port: 35362,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    logging: true
  });

  const dbservice = async () => {
    try {
      await sequelize.sync();
      console.log("Connection has been established successfully with timescale.");
    } catch (error) {
      console.error("Unable to connect to the database:", error, 444);
    }
  };

  dbservice();

  await fs.promises.readdir(__dirname).then((files) =>
    files
      .filter((file) => file.indexOf(".") !== 0 && file !== basename && file.slice(-3) === ".js")
      .forEach(async (file) => {
        const model = await import(new URL(file, import.meta.url));
        const modelInstance = await model.default(sequelize, Sequelize.DataTypes);
        db[modelInstance.name] = modelInstance;
      })
  );

  Object.keys(db).forEach((modelName) => {
    if (db[modelName].associate) {
      db[modelName].associate(db);
    }
  });

  db.sequelize = sequelize;
  db.Sequelize = Sequelize;
} catch (error) {
  if (process.env.ENVIRONMENT != "local") console.error("Error while connecting to the Timescaledb:", error);
}
export default db;
