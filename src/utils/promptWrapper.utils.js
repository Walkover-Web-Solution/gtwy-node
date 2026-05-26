const extractVariables = (template = "") => {
  const matches = template.matchAll(/{{\s*([^}]+)\s*}}/g);
  const vars = [];
  for (const match of matches) {
    if (match[1]) vars.push(match[1].trim());
  }
  return [...new Set(vars)];
};

const convertPromptToString = (prompt) => {
  // CASE 1: String (legacy format or embed default prompt)
  if (typeof prompt === "string") {
    return prompt;
  }

  // Handle null/undefined
  if (!prompt) {
    return "";
  }

  // CASE 2: Object - loop through all key-value pairs and format as "key: value"
  if (typeof prompt === "object") {
    const parts = [];

    for (const [key, value] of Object.entries(prompt)) {
      if (value !== null && value !== undefined && value !== "") {
        parts.push(`${key}: ${value}`);
      }
    }

    return parts.join("\n\n");
  }

  // Fallback for unexpected formats
  return "";
};

export { extractVariables, convertPromptToString };
