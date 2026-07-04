import testcaseModel from "../mongoModel/Testcase.model.js";
import models from "../../models/index.js";
import Sequelize from "sequelize";

async function saveTestCase(testcaseData) {
  const newTestCase = new testcaseModel(testcaseData);
  const result = await newTestCase.save();
  return { id: result._id.toString(), ...testcaseData };
}

async function deleteTestCaseById(id) {
  const result = await testcaseModel.deleteOne({ _id: id });
  const success = result.deletedCount > 0;
  return {
    success,
    message: success ? "Deleted successfully" : "Deletion failed"
  };
}

async function deleteMultipleTestCases(ids) {
  const result = await testcaseModel.deleteMany({ _id: { $in: ids } });
  return {
    success: result.deletedCount > 0,
    deletedCount: result.deletedCount,
    message: result.deletedCount > 0 ? `${result.deletedCount} testcase(s) deleted successfully` : "No testcases found to delete"
  };
}

async function deleteTestCasesByBridgeId(bridge_id) {
  const result = await testcaseModel.deleteMany({ bridge_id: bridge_id });
  return {
    success: result.deletedCount > 0,
    deletedCount: result.deletedCount,
    message: result.deletedCount > 0 ? `${result.deletedCount} testcase(s) deleted successfully` : "No testcases found to delete"
  };
}

async function updateTestCaseById(id, updateData) {
  const result = await testcaseModel.findOneAndUpdate({ _id: id }, { $set: updateData }, { returnDocument: "after" });
  return result ? { ...result.toObject(), _id: result._id.toString() } : null;
}

async function getTestcaseById(id) {
  const result = await testcaseModel.findById(id).lean();
  return result ? { ...result, _id: result._id.toString() } : null;
}

async function getAllTestcasesByBridgeId(bridge_id, page = 1, limit = 30, keyword = "") {
  const skip = (page - 1) * limit;

  // Build filter query
  const filter = { bridge_id };

  // Add keyword search if provided
  if (keyword && keyword.trim() !== "") {
    filter.$or = [{ name: { $regex: keyword, $options: "i" } }, { "conversation.content": { $regex: keyword, $options: "i" } }];
  }

  const testcases = await testcaseModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean();
  const testcasesWithIds = testcases.map((tc) => ({ ...tc, _id: tc._id.toString() }));

  // Get total count
  const totalCount = await testcaseModel.countDocuments(filter);

  // Fetch history for each testcase from PostgreSQL
  const testcaseIds = testcasesWithIds.map((tc) => tc._id);
  const historyMap = {};

  if (testcaseIds.length > 0) {
    const historyLogs = await models.pg.conversation_logs.findAll({
      where: {
        bridge_id: bridge_id,
        testcase_id: { [Sequelize.Op.in]: testcaseIds }
      },
      order: [["created_at", "DESC"]]
    });

    // Group history by testcase_id
    historyLogs.forEach((log) => {
      if (log.testcase_id && !historyMap[log.testcase_id]) {
        historyMap[log.testcase_id] = [];
      }
      if (log.testcase_id) {
        historyMap[log.testcase_id].push(log);
      }
    });
  }

  // Append history to each testcase
  const testcasesWithHistory = testcasesWithIds.map((tc) => ({
    ...tc,
    history: historyMap[tc._id] || []
  }));

  return {
    data: testcasesWithHistory,
    total: totalCount,
    page: page,
    limit: limit
  };
}

async function parseAndSaveTestcases(testcasesData, bridge_id) {
  const savedTestcaseIds = [];
  try {
    let testCases = JSON.parse(testcasesData)?.test_cases || [];
    if (!testCases || testCases.length === 0) {
      return savedTestcaseIds;
    }

    // Convert dict with numbered keys to list if necessary
    if (!Array.isArray(testCases) && typeof testCases === "object") {
      const keys = Object.keys(testCases)
        .filter((k) => !isNaN(k))
        .sort((a, b) => parseInt(a) - parseInt(b));
      if (keys.length > 0) {
        testCases = keys.map((k) => testCases[k]);
      }
    }

    if (!Array.isArray(testCases)) {
      return savedTestcaseIds;
    }

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      try {
        const userInput = testCase.UserInput;
        let expectedOutput = testCase.ExpectedOutput;

        if (!userInput || !expectedOutput) {
          console.warn(`Skipping test case ${i + 1}: missing UserInput or ExpectedOutput`);
          continue;
        }

        if (typeof expectedOutput === "object") {
          expectedOutput = JSON.stringify(expectedOutput);
        }

        const testcaseData = {
          bridge_id: bridge_id,
          conversation: [{ role: "user", content: String(userInput) }],
          type: "response",
          expected: { response: String(expectedOutput) },
          matching_type: "ai"
        };

        const result = await saveTestCase(testcaseData);
        savedTestcaseIds.push(result.id);
        console.log(`Saved test case ${i + 1} with ID: ${result.id}`);
      } catch (caseError) {
        console.error(`Error processing test case ${i + 1}: ${caseError.message}`);
        continue;
      }
    }
  } catch (error) {
    console.error(`Error processing test cases: ${error.message}`);
    throw new Error(`Error processing test cases: ${error.message}`);
  }
  return savedTestcaseIds;
}

export default {
  saveTestCase,
  deleteTestCaseById,
  deleteMultipleTestCases,
  deleteTestCasesByBridgeId,
  updateTestCaseById,
  getTestcaseById,
  getAllTestcasesByBridgeId,
  parseAndSaveTestcases
};
