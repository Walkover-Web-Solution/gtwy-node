import testcaseModel from "../mongoModel/Testcase.model.js";

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

async function updateTestCaseById(id, updateData) {
  const result = await testcaseModel.findOneAndUpdate({ _id: id }, { $set: updateData }, { returnDocument: "after" });
  return result ? { ...result.toObject(), _id: result._id.toString() } : null;
}

async function getTestcaseById(id) {
  const result = await testcaseModel.findById(id).lean();
  return result ? { ...result, _id: result._id.toString() } : null;
}

async function getMergedTestcasesAndHistoryByBridgeId(bridge_id, page = 1, limit = 30) {
  const skip = (page - 1) * limit;
  const data = await testcaseModel.aggregate([
    { $match: { bridge_id: bridge_id } },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from: "testcases_history",
        let: { testcase_id: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [{ $eq: ["$testcase_id", "$$testcase_id"] }, { $eq: ["$testcase_id", { $toString: "$$testcase_id" }] }]
              }
            }
          }
        ],
        as: "history"
      }
    }
  ]);

  return { data };
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
  updateTestCaseById,
  getTestcaseById,
  getMergedTestcasesAndHistoryByBridgeId,
  parseAndSaveTestcases
};
