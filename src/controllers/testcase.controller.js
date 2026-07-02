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
  const testcase_id = req.params.testcase_id;
  const ids = req.body.testCaseIds;

  let result;

  if (testcase_id) {
    result = await testcaseSevice.deleteTestCaseById(testcase_id);
  } else if (ids && Array.isArray(ids) && ids.length > 0) {
    result = await testcaseSevice.deleteMultipleTestCases(ids);
  } else {
    res.locals = { success: false, error: "No testcase ID(s) provided" };
    req.statusCode = 400;
    return next();
  }

  if (!result.success) {
    res.locals = { success: false, error: "Testcase(s) not found" };
    req.statusCode = 404;
    return next();
  }

  res.locals = {
    success: true,
    message: result.message || "Testcase(s) deleted successfully",
    deletedCount: result.deletedCount
  };
  req.statusCode = 200;
  return next();
}

async function deleteAllTestcasesByAgentId(req, res, next) {
  const bridge_id = req.params.bridge_id;

  const result = await testcaseSevice.deleteTestCasesByBridgeId(bridge_id);

  if (!result.success) {
    res.locals = { success: false, error: "No testcases found for this agent" };
    req.statusCode = 404;
    return next();
  }

  res.locals = {
    success: true,
    message: result.message,
    deletedCount: result.deletedCount
  };
  req.statusCode = 200;
  return next();
}

async function getAllTestcases(req, res, next) {
  const bridge_id = req.params.bridge_id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 30;
  const keyword = req.query.keyword || "";
  const result = await testcaseSevice.getAllTestcasesByBridgeId(bridge_id, page, limit, keyword);
  res.locals = {
    success: true,
    data: result.data,
    total: result.total,
    page: result.page,
    limit: result.limit
  };
  req.statusCode = 200;
  return next();
}
async function updateTestcases(req, res, next) {
  const testcase_id = req.params.testcase_id;
  const { name, agent_id, type, conversation, expected, variables, matching_type } = req.body;
  const data = { name, agent_id, type, conversation, expected, variables, matching_type, updatedAt: new Date() };
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
  deleteAllTestcasesByAgentId,
  getAllTestcases,
  updateTestcases
};
