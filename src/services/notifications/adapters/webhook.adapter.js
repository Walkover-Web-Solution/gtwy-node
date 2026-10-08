const WEBHOOK_TIMEOUT_MS = 10_000;

// The body a webhook receives. Legacy events carry the exact body the old alert path sent
// (data.webhook_body), so existing customer integrations see no change.
function buildWebhookBody(event) {
  if (event.data?.webhook_body) return event.data.webhook_body;
  const data = { ...(event.data || {}) };
  delete data.webhook_body;
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    severity: event.severity,
    title: event.title,
    message: event.message,
    org_id: event.org_id,
    agent_id: event.agent_id,
    data,
    occurred_at: event.occurred_at
  };
}

// POSTs the body. Never throws: returns { ok, status, error }.
async function sendWebhook({ url, headers = {}, body }) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    });
    return { ok: response.ok, status: response.status, error: response.ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? `timed out after ${WEBHOOK_TIMEOUT_MS / 1000}s` : error.message;
    return { ok: false, status: null, error: reason };
  }
}

export { buildWebhookBody, sendWebhook };
