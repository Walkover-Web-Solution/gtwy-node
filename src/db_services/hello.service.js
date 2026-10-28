// import Hello from '../mongoModel/Hello.js';
// import { getAnonymousClientId } from '../utils/helloUtils.js';

// // Function to get or create an anonymous client ID
// const getOrCreateAnonymousClientId = async (thread_id, slugname, org_id, helloId) => {
//   try {
//     // Attempt to find the document in the Hello collection
//     let helloDocument = await Hello.findOne({ thread_id, slugname, org_id });

//     // If the document is found, return the client_id
//     if (helloDocument) {
//       return { success: true, data: helloDocument.client_id };
//     }

//     // If not found, call the getAnonymousClientId function
//     const newClientId = await getAnonymousClientId(helloId); // Assuming this function does not require parameters

//     // Save the new document to the database
//     await new Hello({
//         thread_id,
//         slugname,
//         org_id,
//         client_id: newClientId?.uuid
//       }).save();

//     return { success: true, data: newClientId.uuid }; // Return the newly created client_id
//   } catch (error) {
//     console.error("Error fetching or creating client ID:", error);
//     return { success: false, error: "Something went wrong!" };
//   }
// };

// export default {
//   getOrCreateAnonymousClientId
// };
