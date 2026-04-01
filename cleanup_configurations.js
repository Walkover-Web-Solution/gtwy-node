import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb+srv://admin:Uc0sjm9jpLMsSGn5@cluster0.awdsppv.mongodb.net/AI_Middleware-test';

// Keys to remove from both collections
const COMMON_KEYS_TO_REMOVE = [
    'responseRef',
    'is_api_call',
    'responseIds',
    'api_call',
    'doc_ids',
    'user_id',
    'meta',
    'tool_call_count',
    'page_config',
    'apikey',
    'bridge_uses',
    'functions',
    'api_endpoints'
];

// Additional keys to remove only from 'configurations'
const CONFIGURATIONS_ONLY_KEYS = ['parent_id'];

async function cleanupCollection(collection, keysToRemove, collectionName) {
    // Build query to find documents with any of the keys
    const query = {
        $or: keysToRemove.map(key => ({ [key]: { $exists: true } }))
    };
    
    const cursor = collection.find(query);
    
    let cleanedCount = 0;
    let skippedCount = 0;
    
    console.log(`\nProcessing collection: ${collectionName}`);
    console.log('='.repeat(60));
    
    while (await cursor.hasNext()) {
        const doc = await cursor.next();
        const docId = doc._id;
        
        console.log(`\nProcessing document: ${docId}`);
        
        try {
            // Build the unset object with only keys that exist in this document
            const unsetFields = {};
            const keysFound = [];
            
            keysToRemove.forEach(key => {
                if (doc.hasOwnProperty(key)) {
                    unsetFields[key] = "";
                    keysFound.push(key);
                }
            });
            
            // Only update if there are fields to remove
            if (Object.keys(unsetFields).length > 0) {
                console.log(`  Removing keys: ${keysFound.join(', ')}`);
                
                const updateDoc = {
                    $unset: unsetFields,
                    $set: {
                        updated_at: new Date()
                    }
                };
                
                const result = await collection.updateOne(
                    { _id: docId },
                    updateDoc
                );
                
                if (result.modifiedCount > 0) {
                    cleanedCount++;
                    console.log(`  ✓ Successfully cleaned`);
                } else {
                    skippedCount++;
                    console.log(`  - No changes made`);
                }
            } else {
                skippedCount++;
                console.log(`  - No keys to remove`);
            }
            
        } catch (error) {
            console.error(`  ✗ Error cleaning document ${docId}:`, error.message);
        }
    }
    
    return { cleanedCount, skippedCount };
}

async function cleanupConfigurations() {
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db("AI_Middleware-test");
        
        // Process 'configurations' collection
        console.log('\n' + '='.repeat(60));
        console.log('CLEANING CONFIGURATIONS COLLECTION');
        console.log('='.repeat(60));
        
        const configurations = db.collection("configurations");
        const configurationsKeys = [...COMMON_KEYS_TO_REMOVE, ...CONFIGURATIONS_ONLY_KEYS];
        const configResults = await cleanupCollection(
            configurations, 
            configurationsKeys, 
            'configurations'
        );
        
        // Process 'configuration_versions' collection
        console.log('\n' + '='.repeat(60));
        console.log('CLEANING CONFIGURATION_VERSIONS COLLECTION');
        console.log('='.repeat(60));
        
        const configurationVersions = db.collection("configuration_versions");
        const versionResults = await cleanupCollection(
            configurationVersions, 
            COMMON_KEYS_TO_REMOVE, 
            'configuration_versions'
        );
        
        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('CLEANUP SUMMARY');
        console.log('='.repeat(60));
        console.log('\nConfigurations Collection:');
        console.log(`  Documents cleaned: ${configResults.cleanedCount}`);
        console.log(`  Documents skipped: ${configResults.skippedCount}`);
        console.log('\nConfiguration_Versions Collection:');
        console.log(`  Documents cleaned: ${versionResults.cleanedCount}`);
        console.log(`  Documents skipped: ${versionResults.skippedCount}`);
        console.log('\nTotal:');
        console.log(`  Total cleaned: ${configResults.cleanedCount + versionResults.cleanedCount}`);
        console.log(`  Total skipped: ${configResults.skippedCount + versionResults.skippedCount}`);
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error("Cleanup failed:", error);
        throw error;
    } finally {
        await client.close();
        console.log('\nMongoDB connection closed');
    }
}

// Run the cleanup
cleanupConfigurations()
    .then(() => {
        console.log('\n✓ Cleanup completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n✗ Cleanup failed:', error);
        process.exit(1);
    });

