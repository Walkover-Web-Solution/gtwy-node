import cron from "node-cron";
import Thread from "../mongoModel/Thread.model.js";
import models from "../../models/index.js";
import logger from "../logger.js";

const BATCH_SIZE = 1000;

async function drainOrphanCleanup() {
  let totalThreadsDeleted = 0;
  let totalRowsDrained = 0;

  while (true) {
    const rows = await models.pg.sequelize.query(`SELECT id, sub_thread_id FROM orphan_threads_cleanup ORDER BY id ASC LIMIT :limit`, {
      replacements: { limit: BATCH_SIZE },
      type: models.pg.sequelize.QueryTypes.SELECT
    });
    if (!rows.length) break;

    const ids = rows.map((r) => r.id);
    const subThreadIds = rows.map((r) => r.sub_thread_id).filter(Boolean);

    if (subThreadIds.length) {
      const result = await Thread.deleteMany({ sub_thread_id: { $in: subThreadIds } });
      totalThreadsDeleted += result.deletedCount || 0;
    }

    await models.pg.sequelize.query(`DELETE FROM orphan_threads_cleanup WHERE id IN (:ids)`, {
      replacements: { ids },
      type: models.pg.sequelize.QueryTypes.DELETE
    });
    totalRowsDrained += ids.length;

    if (rows.length < BATCH_SIZE) break;
  }

  logger.info(`cleanupOrphanedThreads: drained ${totalRowsDrained} staged rows, deleted ${totalThreadsDeleted} Mongo Thread docs`);
}

const initializeCleanupOrphanedThreadsCron = () => {
  cron.schedule("0 4 * * *", async () => {
    try {
      logger.info("Running cleanupOrphanedThreads...");
      await drainOrphanCleanup();
    } catch (err) {
      logger.error(`cleanupOrphanedThreads error: ${err.message}`);
    }
  });
};

export default initializeCleanupOrphanedThreadsCron;
export { drainOrphanCleanup };
