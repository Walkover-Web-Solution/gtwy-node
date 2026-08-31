// Generic API key validation function that uses validation_config from DB
// validation_config structure: { method, path, headers, query_param }
async function validateApiKey(apiKey, baseUrl, model, validationConfig) {
  const { method, path, headers, query_param } = validationConfig;

  // Replace placeholders in headers
  const processedHeaders = {};
  for (const [key, value] of Object.entries(headers || {})) {
    processedHeaders[key] = value.replace("{apiKey}", apiKey);
  }

  // Hardcoded body for POST requests (same for all services)
  let processedBody = null;
  if (method === "POST") {
    processedBody = JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }]
    });
  }

  // Build URL with query param if needed (for Gemini)
  let url = `${baseUrl}/${path}`;
  if (query_param) {
    url += `?${query_param}=${apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method,
      headers: processedHeaders,
      body: processedBody
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

export { validateApiKey };
