import testcaseSevice from "../db_services/testcase.service.js";

async function createTestcase(req, res, next) {
  const body = req.body;

  // Validation is now handled by middleware

  const result = await testcaseSevice.saveTestCase(body);

  res.locals = {
    success: true,
    data: {
      _id: result.id,
      message: "Testcase created successfully"
    }
  };
  req.statusCode = 200;
  return next();
}

async function deleteTestcase(req, res, next) {
  const testcase_id = req.params.testcase_id || req.body.id;
  const result = await testcaseSevice.deleteTestCaseById(testcase_id);

  if (!result.success) {
    res.locals = { success: false, error: "Testcase not found" };
    req.statusCode = 404;
    return next();
  }

  res.locals = {
    success: true,
    message: "Testcase deleted successfully"
  };
  req.statusCode = 200;
  return next();
}

async function getAllTestcases(req, res, next) {
  const bridge_id = req.params.bridge_id;

  const mergedTestcases = await testcaseSevice.getMergedTestcasesAndHistoryByBridgeId(bridge_id);

  for (const testcase of mergedTestcases) {
    testcase.version_history = {};
    if (testcase.history) {
      for (const history of testcase.history) {
        const version_id = history.version_id;
        if (!testcase.version_history[version_id]) {
          testcase.version_history[version_id] = [];
        }
        testcase.version_history[version_id].push(history);
      }
      delete testcase.history;
    }
  }

  res.locals = {
    success: true,
    data: mergedTestcases
  };
  req.statusCode = 200;
  return next();
}
async function updateTestcases(req, res, next) {
  const testcase_id = req.params.testcase_id;
  const { agent_id, type, conversation, expected, variables, matching_type } = req.body;
  const data = { agent_id, type, conversation, expected, variables, matching_type, updatedAt: new Date() };
  const result = await testcaseSevice.updateTestCaseById(testcase_id, data);
  res.locals = {
    success: true,
    result
  };
  req.statusCode = 200;
  return next();
}

export default {
  createTestcase,
  deleteTestcase,
  getAllTestcases,
  updateTestcases
};
