import { convertPromptToString, extractVariables } from "./promptWrapper.utils.js";
// Helper function to get required/optional variables in prompt
function getReqOptVariablesInPrompt(prompt, variableState, variablePath) {
  function flattenValuesOnly(d) {
    const result = {};
    for (const value of Object.values(d)) {
      if (typeof value === "object" && value !== null) {
        Object.assign(result, flattenDict(value));
      }
    }
    return result;
  }

  function flattenDict(d, parentKey = "") {
    const flat = {};
    for (const [k, v] of Object.entries(d)) {
      const newKey = parentKey ? `${parentKey}.${k}` : k;
      if (typeof v === "object" && v !== null) {
        Object.assign(flat, flattenDict(v, newKey));
      } else {
        flat[newKey] = "required";
      }
    }
    return flat;
  }

  // Extract variables from prompt
  const promptVars = extractVariables(convertPromptToString(prompt));

  // Determine status for prompt variables based on new structure
  const final = {};
  for (const varName of promptVars) {
    if (variableState[varName] && typeof variableState[varName] === "object") {
      // Use the status from the variable_state structure
      const varStatus = variableState[varName].status || "optional";
      final[varName] = varStatus;
    } else {
      // Default to optional if not found in variable_state
      final[varName] = "optional";
    }
  }

  // Add flattened variable_path keys as required
  const flattenedPaths = flattenValuesOnly(variablePath || {});
  for (const path of Object.keys(flattenedPaths)) {
    final[path] = "required";
  }

  return final;
}

// Helper function to transform agent variables to tool call format
function transformAgentVariableToToolCallFormat(inputData) {
  const fields = {};
  const requiredParams = [];

  function setNestedValue(obj, path, value, isRequired) {
    const parts = path.split(".");
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];

      if (!current[part]) {
        current[part] = {
          type: "object",
          description: "",
          enum: [],
          required_params: [],
          parameter: {}
        };
      } else if (!current[part].parameter) {
        current[part].parameter = {};
      }

      current = current[part].parameter;
    }

    const finalKey = parts[parts.length - 1];

    // Infer type
    let paramType = "string";
    if (finalKey.toLowerCase().includes("number") || finalKey.toLowerCase().includes("num")) {
      paramType = "number";
    } else if (finalKey.toLowerCase().includes("bool") || finalKey.toLowerCase().includes("flag")) {
      paramType = "boolean";
    }

    current[finalKey] = {
      type: paramType,
      description: "",
      enum: [],
      required_params: []
    };

    if (isRequired) {
      for (let i = 0; i < parts.length - 1; i++) {
        let currentLevel = obj;
        for (let j = 0; j < i; j++) {
          currentLevel = currentLevel[parts[j]].parameter;
        }

        const parentKey = parts[i];
        const childKey = parts[i + 1];

        if (!currentLevel[parentKey].required_params.includes(childKey)) {
          currentLevel[parentKey].required_params.push(childKey);
        }
      }

      if (!requiredParams.includes(parts[0])) {
        requiredParams.push(parts[0]);
      }
    }
  }

  for (const [key, value] of Object.entries(inputData)) {
    const isRequired = value === "required";

    if (key.includes(".")) {
      setNestedValue(fields, key, value, isRequired);
    } else {
      let paramType = "string";
      if (key.toLowerCase().includes("number") || key.toLowerCase().includes("num")) {
        paramType = "number";
      } else if (key.toLowerCase().includes("bool") || key.toLowerCase().includes("flag")) {
        paramType = "boolean";
      }

      fields[key] = {
        type: paramType,
        description: "",
        enum: [],
        required_params: []
      };

      if (isRequired && !requiredParams.includes(key)) {
        requiredParams.push(key);
      }
    }
  }

  return {
    fields: fields,
    required_params: requiredParams
  };
}

export { getReqOptVariablesInPrompt, transformAgentVariableToToolCallFormat };
