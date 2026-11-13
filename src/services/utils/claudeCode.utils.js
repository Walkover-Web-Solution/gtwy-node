// The `claude_code` service: Anthropic models through the org's own Claude login.
// An org saves one login (the token `claude setup-token` prints) and every agent set to this
// service uses it, with no key to pick per agent. The Python gateway makes the calls.
import axios from "axios";
import jwt from "jsonwebtoken";

const CLAUDE_CODE = "claude_code";
// Same environment switch as latency.service.js.
const GATEWAY_URL = process.env.ENVIRONMENT === "TESTING" ? "https://dev-api.gtwy.ai" : "https://api.gtwy.ai";
const VERIFY_TIMEOUT_MS = 70000;

// The gateway caches the org's login under this key (same Redis prefix in both servers).
const claudeLoginCacheKey = (org_id) => `claude_code_login_${org_id}`;

// A Claude login cannot be checked with one HTTP call from here; the gateway makes one tiny call on it.
async function verifyClaudeLogin(token, org_id, user_id) {
  const authorization = jwt.sign({ org: { id: String(org_id) }, user: { id: String(user_id) } }, process.env.SecretKey, { expiresIn: 120 });
  try {
    await axios.post(
      `${GATEWAY_URL}/api/v2/model/claude_code/verify`,
      { apikey: token },
      { headers: { Authorization: authorization }, timeout: VERIFY_TIMEOUT_MS }
    );
    return { success: true };
  } catch (error) {
    const detail = error.response?.data?.detail;
    return { success: false, error: detail?.error || error.message };
  }
}

export { CLAUDE_CODE, claudeLoginCacheKey, verifyClaudeLogin };
