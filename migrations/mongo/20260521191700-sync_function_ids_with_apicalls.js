import mongoose from "mongoose";

export const up = async (db) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const configurationCollection = db.collection("configurations");
    const versionCollection = db.collection("configuration_versions");
    const apicallCollection = db.collection("apicalls");

    // Step 1: Get all configurations with function_ids
    const configurations = await configurationCollection.find({ function_ids: { $exists: true, $ne: [] } }).toArray();

    console.log(`Found ${configurations.length} configurations with function_ids`);

    // Step 2: Update apicalls with bridge_ids from configurations
    for (const config of configurations) {
      const configId = config._id.toString();
      const functionIds = config.function_ids || [];

      for (const functionId of functionIds) {
        const funcIdStr = functionId.toString ? functionId.toString() : functionId;
        await apicallCollection.updateOne(
          { _id: new mongoose.Types.ObjectId(funcIdStr) },
          {
            $addToSet: { bridge_ids: configId }
          },
          { session }
        );
      }
    }

    console.log("Updated apicalls with bridge_ids from configurations");

    // Step 3: Get all versions with function_ids
    const versions = await versionCollection.find({ function_ids: { $exists: true, $ne: [] } }).toArray();

    console.log(`Found ${versions.length} versions with function_ids`);

    // Step 4: Update apicalls with version_ids from versions
    for (const version of versions) {
      const versionId = version._id.toString();
      const functionIds = version.function_ids || [];

      for (const functionId of functionIds) {
        const funcIdStr = functionId.toString ? functionId.toString() : functionId;
        await apicallCollection.updateOne(
          { _id: new mongoose.Types.ObjectId(funcIdStr) },
          {
            $addToSet: { version_ids: versionId }
          },
          { session }
        );
      }
    }

    console.log("Updated apicalls with version_ids from versions");

    // Step 5: Clean up orphaned bridge_ids and version_ids
    const apicalls = await apicallCollection.find({}).toArray();

    console.log(`Checking ${apicalls.length} apicalls for orphaned references`);

    for (const apicall of apicalls) {
      const apicallId = apicall._id;
      let updatedBridgeIds = apicall.bridge_ids || [];
      let updatedVersionIds = apicall.version_ids || [];
      let hasChanges = false;

      // Check bridge_ids - remove if bridge doesn't contain this function_id
      const validBridgeIds = [];
      for (const bridgeId of updatedBridgeIds) {
        const bridgeIdObj = new mongoose.Types.ObjectId(bridgeId);
        const bridge = await configurationCollection.findOne(
          {
            _id: bridgeIdObj,
            function_ids: apicallId
          },
          { session }
        );

        if (bridge) {
          validBridgeIds.push(bridgeId);
        } else {
          hasChanges = true;
          console.log(`Removing orphaned bridge_id ${bridgeId} from apicall ${apicallId}`);
        }
      }

      // Check version_ids - remove if version doesn't contain this function_id
      const validVersionIds = [];
      for (const versionId of updatedVersionIds) {
        const versionIdObj = new mongoose.Types.ObjectId(versionId);
        const version = await versionCollection.findOne(
          {
            _id: versionIdObj,
            function_ids: apicallId
          },
          { session }
        );

        if (version) {
          validVersionIds.push(versionId);
        } else {
          hasChanges = true;
          console.log(`Removing orphaned version_id ${versionId} from apicall ${apicallId}`);
        }
      }

      // Update apicall if there are changes
      if (hasChanges) {
        await apicallCollection.updateOne(
          { _id: apicallId },
          {
            $set: {
              bridge_ids: validBridgeIds,
              version_ids: validVersionIds
            }
          },
          { session }
        );
      }
    }

    console.log("Cleaned up orphaned bridge_ids and version_ids");

    await session.commitTransaction();
    console.log("Migration completed successfully");
  } catch (error) {
    await session.abortTransaction();
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await session.endSession();
  }
};

export const down = async (db) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // const configurationCollection = db.collection("configurations");
    // const versionCollection = db.collection("configuration_versions");
    const apicallCollection = db.collection("apicalls");

    // Rollback: Clear all bridge_ids and version_ids from apicalls
    // This is a simple rollback - in production you might want to store original values
    await apicallCollection.updateMany(
      {},
      {
        $set: {
          bridge_ids: [],
          version_ids: []
        }
      },
      { session }
    );

    await session.commitTransaction();
    console.log("Rollback completed successfully");
  } catch (error) {
    await session.abortTransaction();
    console.error("Rollback failed:", error);
    throw error;
  } finally {
    await session.endSession();
  }
};
