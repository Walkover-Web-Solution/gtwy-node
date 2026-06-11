// API-key validators. The OpenAI-compatible (Bearer) providers share two
// generic validators parameterized by base_url (sourced from the services
// registry); anthropic / gemini / deepgram keep bespoke auth schemes.

// Bearer + GET {baseUrl}/{path}  (openai, grok, moonshot, + future)
// path defaults to "models"; open_router passes "key" because its /models
// endpoint is public (returns 200 without auth) and so cannot validate a key.
async function validateBearerModelsList(apiKey, baseUrl, path = "models") {
  try {
    const response = await fetch(`${baseUrl}/${path}`, {
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
// Key check via GET {baseUrl}/models — free and only tests the key. The old
// POST /messages probe spent tokens on the customer's key and could fail for
// non-key reasons (model deprecated, 529 overload), reporting a false
// "invalid apikey".
async function callAnthropicApi(apiKey, baseUrl = "https://api.anthropic.com/v1") {
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
  try {
    const response = await fetch(`${baseUrl}/models`, { method: "GET", headers });
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
