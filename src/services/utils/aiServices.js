// API-key validators. The OpenAI-compatible (Bearer) providers share two
// generic validators parameterized by base_url (sourced from the services
// registry); anthropic / gemini / deepgram keep bespoke auth schemes.

// Bearer + GET {baseUrl}/models  (openai, open_router, grok, moonshot, + future)
async function validateBearerModelsList(apiKey, baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Bearer + POST {baseUrl}/chat/completions  (groq, mistral, neev_cloud, deepseek, + future openai_sdk)
async function validateBearerChatCompletion(apiKey, baseUrl, model) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }]
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- Bespoke auth schemes --------------------------------------------------
async function callAnthropicApi(apiKey, model = "claude-3-7-sonnet-20250219", baseUrl = "https://api.anthropic.com/v1") {
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  };
  const body = JSON.stringify({
    model,
    max_tokens: 1,
    messages: [{ role: "user", content: "Hello, world" }]
  });
  try {
    const response = await fetch(`${baseUrl}/messages`, { method: "POST", headers, body });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function callGeminiApi(apiKey, baseUrl = "https://generativelanguage.googleapis.com/v1") {
  try {
    const response = await fetch(`${baseUrl}/models?key=${apiKey}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorText}`);
    }
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function callDeepgramApi(apiKey, baseUrl = "https://api.deepgram.com/v1") {
  try {
    const response = await fetch(`${baseUrl}/projects`, {
      method: "GET",
      headers: { Authorization: `Token ${apiKey}` }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export { validateBearerModelsList, validateBearerChatCompletion, callAnthropicApi, callGeminiApi, callDeepgramApi };
