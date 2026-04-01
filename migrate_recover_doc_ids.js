import { MongoClient } from 'mongodb';
import axios from 'axios';

const MONGODB_URI = 'mongodb+srv://admin:Uc0sjm9jpLMsSGn5@cluster0.awdsppv.mongodb.net/AI_Middleware-test';
const HIPPOCAMPUS_URL = 'http://hippocampus.gtwy.ai';
const HIPPOCAMPUS_API_KEY = 'IDUfK3NqTdp2T5dlscfg3YH2tos3gzi0';

console.log('✓ Configuration loaded');
console.log(`✓ Using Hippocampus URL: ${HIPPOCAMPUS_URL}`);
console.log(`✓ API Key: ${HIPPOCAMPUS_API_KEY.substring(0, 10)}...`);

// Track migration results
const migrationLog = {
    totalProcessed: 0,
    successful: 0,
    failed: [],
    apiErrors: [],
    skipped: 0
};

/**
 * Fetch resource data from Hippocampus API
 */
async function fetchResourceData(resourceId) {
    try {
        console.log(`    → Fetching resource data for ID: ${resourceId}`);
        
        const response = await axios.get(
            `${HIPPOCAMPUS_URL}/resource/${resourceId}`,
            {
                headers: {
                    'x-api-key': HIPPOCAMPUS_API_KEY
                },
                timeout: 10000 // 10 seconds timeout
            }
        );
        
        if (response.data && response.data._id) {
            console.log(`    ✓ Resource found: ${response.data.title || 'Untitled'}`);
            return {
                collection_id: response.data.collectionId,
                resource_id: response.data._id,
                description: response.data.description || response.data.title || ''
            };
        }
        
        return null;
    } catch (error) {
        if (error.response?.status === 404) {
            console.log(`    ⚠ Resource not found (404): ${resourceId}`);
        } else {
            console.error(`    ✗ Error fetching resource ${resourceId}:`, error.response?.data || error.message);
            migrationLog.apiErrors.push({
                resource_id: resourceId,
                error: error.response?.data || error.message,
                status: error.response?.status
            });
        }
        return null;
    }
}

/**
 * Process doc_ids array and transform string IDs to objects
 */
async function processDocIds(docIds) {
    if (!Array.isArray(docIds) || docIds.length === 0) {
        return { updated: false, newDocIds: docIds };
    }
    
    const newDocIds = [];
    let hasChanges = false;
    
    for (const docId of docIds) {
        // If it's already an object with collection_id, keep it as is
        if (typeof docId === 'object' && docId !== null && docId.collection_id) {
            console.log(`    ℹ Already an object, keeping as is`);
            newDocIds.push(docId);
            continue;
        }
        
        // If it's a string, fetch resource data and convert to object
        if (typeof docId === 'string') {
            const resourceData = await fetchResourceData(docId);
            
            if (resourceData) {
                newDocIds.push(resourceData);
                hasChanges = true;
                console.log(`    ✓ Converted string ID to object`);
            } else {
                // If API call failed or resource not found, keep the string ID
                console.log(`    ⚠ Keeping string ID as is (API call failed or not found)`);
                newDocIds.push(docId);
            }
        } else {
            // Unknown type, keep as is
            newDocIds.push(docId);
        }
    }
    
    return { updated: hasChanges, newDocIds };
}

/**
 * Main migration function
 */
async function migrateRecoverDocIds() {
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        console.log('Starting migration for recover collection...\n');
        
        const db = client.db("AI_Middleware-test");
        const recoverCollection = db.collection("recover");
        
        // Count total documents to migrate
        const totalDocs = await recoverCollection.countDocuments({
            doc_ids: { $exists: true, $ne: null }
        });
        console.log(`📊 Total documents to process: ${totalDocs}\n`);
        
        if (totalDocs === 0) {
            console.log('No documents found with doc_ids field. Exiting...');
            return;
        }
        
        // Get all documents with doc_ids
        const cursor = recoverCollection.find({
            doc_ids: { $exists: true, $ne: null }
        });
        
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            migrationLog.totalProcessed++;
            
            console.log(`\n${'='.repeat(80)}`);
            console.log(`Processing Document [${migrationLog.totalProcessed}/${totalDocs}]: ${doc._id}`);
            console.log(`  Current doc_ids:`, JSON.stringify(doc.doc_ids, null, 2));
            console.log(`${'='.repeat(80)}`);
            
            try {
                // Check if doc_ids is an array
                if (!Array.isArray(doc.doc_ids)) {
                    console.log(`  ⚠ doc_ids is not an array, skipping...`);
                    migrationLog.skipped++;
                    continue;
                }
                
                // Check if doc_ids is empty
                if (doc.doc_ids.length === 0) {
                    console.log(`  ⚠ doc_ids is empty, skipping...`);
                    migrationLog.skipped++;
                    continue;
                }
                
                // Check if all doc_ids are already objects
                const allObjects = doc.doc_ids.every(
                    item => typeof item === 'object' && item !== null && item.collection_id
                );
                
                if (allObjects) {
                    console.log(`  ✓ All doc_ids are already objects, skipping...`);
                    migrationLog.skipped++;
                    continue;
                }
                
                // Process doc_ids array
                console.log(`\nProcessing ${doc.doc_ids.length} doc_ids...`);
                const { updated, newDocIds } = await processDocIds(doc.doc_ids);
                
                if (updated) {
                    // Update the document
                    console.log(`\nUpdating document with new doc_ids...`);
                    const result = await recoverCollection.updateOne(
                        { _id: doc._id },
                        {
                            $set: {
                                doc_ids: newDocIds,
                                updated_at: new Date()
                            }
                        }
                    );
                    
                    if (result.modifiedCount > 0) {
                        migrationLog.successful++;
                        console.log(`  ✓ Successfully updated document`);
                        console.log(`  New doc_ids:`, JSON.stringify(newDocIds, null, 2));
                    } else {
                        console.log(`  ⚠ No changes made to document`);
                        migrationLog.skipped++;
                    }
                } else {
                    console.log(`\n  ℹ No changes needed for this document`);
                    migrationLog.skipped++;
                }
                
                console.log(`\n📈 Progress: ${migrationLog.successful} updated, ${migrationLog.skipped} skipped, ${migrationLog.failed.length} failed (${migrationLog.totalProcessed}/${totalDocs})`);
                
                // Save progress every 5 documents
                if (migrationLog.totalProcessed % 5 === 0) {
                    const fs = await import('fs');
                    const progressLogPath = './recover_migration_progress.json';
                    fs.writeFileSync(progressLogPath, JSON.stringify({
                        ...migrationLog,
                        lastUpdated: new Date().toISOString(),
                        progress: `${migrationLog.totalProcessed}/${totalDocs}`
                    }, null, 2));
                    console.log(`💾 Progress saved to ${progressLogPath}`);
                }
                
            } catch (error) {
                console.error(`\n✗ Failed to process document ${doc._id}:`, error.message);
                migrationLog.failed.push({
                    doc_id: doc._id.toString(),
                    doc_ids: doc.doc_ids,
                    error: error.message,
                    stack: error.stack
                });
            }
        }
        
        // Print final summary
        console.log('\n\n' + '='.repeat(80));
        console.log('MIGRATION SUMMARY');
        console.log('='.repeat(80));
        console.log(`Total Documents Processed: ${migrationLog.totalProcessed}`);
        console.log(`Successfully Updated: ${migrationLog.successful}`);
        console.log(`Skipped: ${migrationLog.skipped}`);
        console.log(`Failed: ${migrationLog.failed.length}`);
        console.log(`API Errors: ${migrationLog.apiErrors.length}`);
        console.log('='.repeat(80));
        
        // Print detailed logs
        if (migrationLog.failed.length > 0) {
            console.log('\n\nFAILED DOCUMENTS:');
            console.log('='.repeat(80));
            migrationLog.failed.forEach((failure, index) => {
                console.log(`\n${index + 1}. Document ID: ${failure.doc_id}`);
                console.log(`   doc_ids: ${JSON.stringify(failure.doc_ids)}`);
                console.log(`   Error: ${failure.error}`);
            });
        }
        
        if (migrationLog.apiErrors.length > 0) {
            console.log('\n\nAPI ERRORS (Resources Not Found or Failed):');
            console.log('='.repeat(80));
            migrationLog.apiErrors.forEach((error, index) => {
                console.log(`\n${index + 1}. Resource ID: ${error.resource_id}`);
                console.log(`   Status: ${error.status || 'N/A'}`);
                console.log(`   Error: ${JSON.stringify(error.error)}`);
            });
        }
        
        // Save final log to file
        const fs = await import('fs');
        const finalLogPath = './recover_migration_final.json';
        fs.writeFileSync(finalLogPath, JSON.stringify(migrationLog, null, 2));
        console.log(`\n\n✓ Final log saved to: ${finalLogPath}`);
        
    } catch (error) {
        console.error('\n\nCRITICAL ERROR:', error);
        
        // Save progress even on failure
        const fs = await import('fs');
        const errorLogPath = './recover_migration_errors.json';
        fs.writeFileSync(errorLogPath, JSON.stringify({
            ...migrationLog,
            criticalError: error.message,
            errorStack: error.stack,
            lastUpdated: new Date().toISOString()
        }, null, 2));
        console.log(`\n💾 Progress and errors saved to: ${errorLogPath}`);
        
        throw error;
    } finally {
        await client.close();
        console.log('\n\nMongoDB connection closed');
    }
}

// Run the migration
migrateRecoverDocIds()
    .then(() => {
        console.log('\n✓ Migration completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n✗ Migration failed:', error);
        process.exit(1);
    });

