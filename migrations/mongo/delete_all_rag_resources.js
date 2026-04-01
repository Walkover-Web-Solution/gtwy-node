import { MongoClient } from 'mongodb';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const hippocampusUrl = 'http://hippocampus.gtwy.ai';
const hippocampusApiKey = process.env.HIPPOCAMPUS_API_KEY;
const mongoUri = process.env.MONGODB_CONNECTION_URI;
const dbName = 'AI_Middleware-test';

/**
 * Delete a single resource using the Hippocampus API
 */
async function deleteResource(resourceId) {
  try {
    const response = await axios.delete(`${hippocampusUrl}/resource/${resourceId}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': hippocampusApiKey
      }
    });
    return { success: true, resourceId, data: response.data };
  } catch (error) {
    console.error(`Error deleting resource ${resourceId}:`, error.response?.data || error.message);
    return { 
      success: false, 
      resourceId, 
      error: error.response?.data || error.message,
      status: error.response?.status
    };
  }
}

/**
 * Main migration function
 */
async function migrateDeleteResources() {
  let client;
  
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('Connected to MongoDB successfully');

    // Get database and collection
    const db = client.db(dbName);
    const ragCollectionsCollection = db.collection('rag_collections');
    console.log(`Using database: ${dbName}`);

    // Fetch all rag_collections
    console.log('\nFetching all rag_collections...');
    const collections = await ragCollectionsCollection.find({}).toArray();
    console.log(`Found ${collections.length} collections`);

    if (collections.length === 0) {
      console.log('No collections found. Migration complete.');
      return;
    }

    // Statistics
    let totalResources = 0;
    let deletedResources = 0;
    let failedResources = 0;
    let updatedCollections = 0;
    const errors = [];

    // Process each collection
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      console.log(`\n[${i + 1}/${collections.length}] Processing collection: ${collection.name} (ID: ${collection.collection_id})`);
      console.log(`  Org ID: ${collection.org_id}`);
      console.log(`  Resources count: ${collection.resource_ids?.length || 0}`);

      if (!collection.resource_ids || collection.resource_ids.length === 0) {
        console.log('  No resources to delete. Skipping...');
        continue;
      }

      totalResources += collection.resource_ids.length;
      const resourceResults = [];

      // Delete each resource one by one
      for (let j = 0; j < collection.resource_ids.length; j++) {
        const resourceId = collection.resource_ids[j];
        console.log(`  [${j + 1}/${collection.resource_ids.length}] Deleting resource: ${resourceId}`);
        
        const result = await deleteResource(resourceId);
        resourceResults.push(result);

        if (result.success) {
          deletedResources++;
          console.log(`    ✓ Successfully deleted`);
        } else {
          failedResources++;
          console.log(`    ✗ Failed to delete`);
          errors.push({
            collection_id: collection.collection_id,
            collection_name: collection.name,
            org_id: collection.org_id,
            resource_id: resourceId,
            error: result.error,
            status: result.status
          });
        }

        // Add a small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Update the collection to empty the resource_ids array
      console.log(`  Clearing resource_ids array for collection ${collection.collection_id}...`);
      try {
        await ragCollectionsCollection.updateOne(
          { collection_id: collection.collection_id },
          { 
            $set: { 
              resource_ids: [],
              updated_at: new Date()
            } 
          }
        );
        updatedCollections++;
        console.log(`  ✓ Successfully cleared resource_ids array`);
      } catch (error) {
        console.error(`  ✗ Failed to update collection:`, error.message);
        errors.push({
          collection_id: collection.collection_id,
          collection_name: collection.name,
          org_id: collection.org_id,
          error: `Failed to update collection: ${error.message}`,
          type: 'collection_update_error'
        });
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('MIGRATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total collections processed: ${collections.length}`);
    console.log(`Total resources found: ${totalResources}`);
    console.log(`Successfully deleted: ${deletedResources}`);
    console.log(`Failed deletions: ${failedResources}`);
    console.log(`Collections updated: ${updatedCollections}`);
    console.log('='.repeat(80));

    if (errors.length > 0) {
      console.log(`\n⚠️  ${errors.length} errors occurred during migration:`);
      console.log(JSON.stringify(errors, null, 2));
      
      // Save errors to file
      const fs = await import('fs');
      const errorFilePath = './migration_delete_resources_errors.json';
      fs.writeFileSync(errorFilePath, JSON.stringify(errors, null, 2));
      console.log(`\nErrors saved to: ${errorFilePath}`);
    }

    console.log('\n✓ Migration completed successfully!');

  } catch (error) {
    console.error('\n✗ Migration failed with error:');
    console.error(error);
    throw error;
  } finally {
    // Close MongoDB connection
    if (client) {
      console.log('\nClosing MongoDB connection...');
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run the migration
console.log('Starting RAG Resources Deletion Migration');
console.log('='.repeat(80));
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Database: ${dbName}`);
console.log(`Hippocampus URL: ${hippocampusUrl}`);
console.log(`API Key configured: ${hippocampusApiKey ? 'Yes' : 'No'}`);
console.log('='.repeat(80));

migrateDeleteResources()
  .then(() => {
    console.log('\nMigration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration script failed:', error);
    process.exit(1);
  });
