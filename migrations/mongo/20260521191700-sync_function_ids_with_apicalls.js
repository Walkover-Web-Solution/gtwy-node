export const up = async (db) => {
  console.log("=== Starting sync_function_ids_with_apicalls migration ===");

  console.log("[Step 0] Acquiring collection handles...");
  const configurationCollection = db.collection("configurations");
  const versionCollection = db.collection("configuration_versions");
  const apicallCollection = db.collection("apicalls");
  console.log("[Step 0] Collections ready: configurations, configuration_versions, apicalls");

  // Step 1: Get all configurations with function_ids
  console.log("[Step 1] Fetching all configurations with non-empty function_ids...");
  const configurations = await configurationCollection.find({ function_ids: { $exists: true, $ne: [] } }).toArray();
  console.log(`[Step 1] Found ${configurations.length} configurations with function_ids`);

  // Step 2: Update apicalls with bridge_ids from configurations
  console.log("[Step 2] Updating apicalls with bridge_ids from configurations...");
  let configProcessed = 0;
  let bridgeUpdateCount = 0;
  for (const config of configurations) {
    const configId = config._id.toString();
    const functionIds = config.function_ids || [];
    console.log(`[Step 2] -> Config ${configId}: linking ${functionIds.length} function_id(s) as bridge_ids`);

    for (const functionId of functionIds) {
      const funcIdStr = functionId.toString ? functionId.toString() : functionId;
      const res = await apicallCollection.updateOne(
        { _id: functionId },
        {
          $addToSet: { bridge_ids: configId }
        }
      );
      if (res.matchedCount === 0) {
        console.log(`[Step 2]    ! apicall ${funcIdStr} NOT FOUND (skipped)`);
      } else if (res.modifiedCount > 0) {
        bridgeUpdateCount++;
        console.log(`[Step 2]    + added bridge_id ${configId} -> apicall ${funcIdStr}`);
      } else {
        console.log(`[Step 2]    = bridge_id ${configId} already present on apicall ${funcIdStr}`);
      }
    }
    configProcessed++;
    if (configProcessed % 100 === 0) {
      console.log(`[Step 2] Progress: ${configProcessed}/${configurations.length} configurations (${bridgeUpdateCount} apicalls updated so far)`);
    }
  }
  console.log(`[Step 2] Done. Processed ${configProcessed} configurations, updated ${bridgeUpdateCount} apicall bridge_ids entries`);

  // Step 3: Get all versions with function_ids
  console.log("[Step 3] Fetching all configuration_versions with non-empty function_ids...");
  const versions = await versionCollection.find({ function_ids: { $exists: true, $ne: [] } }).toArray();
  console.log(`[Step 3] Found ${versions.length} versions with function_ids`);

  // Step 4: Update apicalls with version_ids from versions
  console.log("[Step 4] Updating apicalls with version_ids from versions...");
  let versionProcessed = 0;
  let versionUpdateCount = 0;
  for (const version of versions) {
    const versionId = version._id.toString();
    const functionIds = version.function_ids || [];
    console.log(`[Step 4] -> Version ${versionId}: linking ${functionIds.length} function_id(s) as version_ids`);

    for (const functionId of functionIds) {
      const funcIdStr = functionId.toString ? functionId.toString() : functionId;
      const res = await apicallCollection.updateOne(
        { _id: functionId },
        {
          $addToSet: { version_ids: versionId }
        }
      );
      if (res.matchedCount === 0) {
        console.log(`[Step 4]    ! apicall ${funcIdStr} NOT FOUND (skipped)`);
      } else if (res.modifiedCount > 0) {
        versionUpdateCount++;
        console.log(`[Step 4]    + added version_id ${versionId} -> apicall ${funcIdStr}`);
      } else {
        console.log(`[Step 4]    = version_id ${versionId} already present on apicall ${funcIdStr}`);
      }
    }
    versionProcessed++;
    if (versionProcessed % 100 === 0) {
      console.log(`[Step 4] Progress: ${versionProcessed}/${versions.length} versions (${versionUpdateCount} apicalls updated so far)`);
    }
  }
  console.log(`[Step 4] Done. Processed ${versionProcessed} versions, updated ${versionUpdateCount} apicall version_ids entries`);

  // Step 5: Clean up orphaned bridge_ids and version_ids
  console.log("[Step 5] Fetching all apicalls to validate references...");
  const apicalls = await apicallCollection.find({}).toArray();
  console.log(`[Step 5] Checking ${apicalls.length} apicalls for orphaned references`);

  let apicallProcessed = 0;
  let apicallsCleaned = 0;
  let orphanedBridgeCount = 0;
  let orphanedVersionCount = 0;
  for (const apicall of apicalls) {
    const apicallId = apicall._id;
    let updatedBridgeIds = apicall.bridge_ids || [];
    let updatedVersionIds = apicall.version_ids || [];
    let hasChanges = false;
    if (updatedBridgeIds.length > 0 || updatedVersionIds.length > 0) {
      console.log(`[Step 5] -> Validating apicall ${apicallId}: ${updatedBridgeIds.length} bridge_id(s), ${updatedVersionIds.length} version_id(s)`);
    }

    // Check bridge_ids - remove if bridge doesn't contain this function_id
    const validBridgeIds = [];
    for (const bridgeId of updatedBridgeIds) {
      const bridge = await configurationCollection.findOne({
        _id: bridgeId,
        function_ids: apicallId
      });

      if (bridge) {
        validBridgeIds.push(bridgeId);
      } else {
        hasChanges = true;
        orphanedBridgeCount++;
        console.log(`[Step 5] Removing orphaned bridge_id ${bridgeId} from apicall ${apicallId}`);
      }
    }

    // Check version_ids - remove if version doesn't contain this function_id
    const validVersionIds = [];
    for (const versionId of updatedVersionIds) {
      const version = await versionCollection.findOne({
        _id: versionId,
        function_ids: apicallId
      });

      if (version) {
        validVersionIds.push(versionId);
      } else {
        hasChanges = true;
        orphanedVersionCount++;
        console.log(`[Step 5] Removing orphaned version_id ${versionId} from apicall ${apicallId}`);
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
        }
      );
      apicallsCleaned++;
      console.log(`[Step 5]    ~ updated apicall ${apicallId} -> bridge_ids: ${validBridgeIds.length}, version_ids: ${validVersionIds.length}`);
    }
    apicallProcessed++;
    if (apicallProcessed % 500 === 0) {
      console.log(`[Step 5] Processed ${apicallProcessed}/${apicalls.length} apicalls (${apicallsCleaned} cleaned so far)`);
    }
  }

  console.log(
    `[Step 5] Done. Processed ${apicallProcessed} apicalls, cleaned ${apicallsCleaned} (removed ${orphanedBridgeCount} orphaned bridge_ids, ${orphanedVersionCount} orphaned version_ids)`
  );
  console.log("=== Migration completed successfully ===");
};

export const down = async (db) => {
  console.log("=== Starting rollback of sync_function_ids_with_apicalls migration ===");

  console.log("[Rollback Step 1] Acquiring apicalls collection handle...");
  const apicallCollection = db.collection("apicalls");

  // Rollback: Clear all bridge_ids and version_ids from apicalls
  // This is a simple rollback - in production you might want to store original values
  console.log("[Rollback Step 2] Unsetting bridge_ids and version_ids from all apicalls...");
  const result = await apicallCollection.updateMany(
    {},
    {
      $unset: {
        bridge_ids: "",
        version_ids: ""
      }
    }
  );
  console.log(`[Rollback Step 2] Matched ${result.matchedCount} apicalls, modified ${result.modifiedCount}`);

  console.log("=== Rollback completed successfully ===");
};
