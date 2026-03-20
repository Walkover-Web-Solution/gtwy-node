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

  // CASE 2: Structured object - Main user format {role, goal, instruction}
  if (typeof prompt === "object" && (prompt.role !== undefined || prompt.goal !== undefined || prompt.instruction !== undefined)) {
    const parts = [];

    if (prompt.role) {
      parts.push(`Role: ${prompt.role}`);
    }

    if (prompt.goal) {
      parts.push(`Goal: ${prompt.goal}`);
    }

    if (prompt.instruction) {
      parts.push(`Instructions: ${prompt.instruction}`);
    }

    return parts.join("\n\n");
  }

  // CASE 3: Embed user format {embedFields, customPrompt}
  if (typeof prompt === "object" && prompt.embedFields) {
    const parts = [];

    // Add custom prompt if present
    if (prompt.customPrompt) {
      parts.push(prompt.customPrompt);
    }

    // Add visible embed fields only
    for (const field of prompt.embedFields) {
      if (typeof field === "object" && field.value && !field.hidden) {
        const label = field.label || field.name;
        if (label) {
          parts.push(`${label}: ${field.value}`);
        }
      }
    }

    return parts.join("\n\n");
  }

  // Fallback for unexpected formats
  return "";
};

export { extractVariables, convertPromptToString };
