/**
 * Normalizes AI request/config payloads from different services
 * (OpenAI Responses API, Gemini, Anthropic) into a common shape:
 *
 * {
 *   service: "openai" | "gemini" | "anthropic" | "unknown",
 *   model: string,
 *   system_prompt: string,
 *   messages: Array<{ role: "user"|"assistant"|"tool", content: string, tool_calls?, tool_call_id?, name? }>,
 *   tools: Array<{ name: string, description?: string, parameters?: object, type?: string }>,
 *   max_tokens: number | null,
 *   raw: <original payload>
 * }
 */

const ROLE_MAP = {
  developer: "system",
  system: "system",
  user: "user",
  assistant: "assistant",
  model: "assistant", // gemini uses "model"
  tool: "tool",
  function: "tool"
};

const extractText = (content) => {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.text) return part.text;
        if (part?.content) return extractText(part.content);
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    if (content.text) return content.text;
    if (content.parts) return extractText(content.parts);
  }
  return "";
};

const detectService = (config) => {
  if (!config || typeof config !== "object") return "unknown";
  if (Array.isArray(config.input) || config.max_output_tokens !== undefined) return "openai";
  if (Array.isArray(config.contents) || config.config?.system_instruction) return "gemini";
  if (Array.isArray(config.messages) && (typeof config.system === "string" || config.anthropic_version)) return "anthropic";
  if (Array.isArray(config.messages)) return "openai"; // chat completions
  return "unknown";
};

// ---------- OpenAI (Responses API + Chat Completions) ----------
const normalizeOpenAI = (cfg) => {
  const inputItems = cfg.input || cfg.messages || [];
  let system_prompt = "";
  const messages = [];
  for (const item of inputItems) {
    if (!item || typeof item !== "object") continue;
    const type = item.type;

    // Skip reasoning meta items
    if (type === "reasoning") continue;

    // Tool call output -> tool role message
    if (type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: extractText(item.output)
      });
      continue;
    }

    // Function call -> attach to previous assistant or create new
    if (type === "function_call") {
      const toolCall = {
        id: item.call_id || item.id,
        type: "function",
        function: { name: item.name, arguments: item.arguments || "" }
      };
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant") {
        last.tool_calls = last.tool_calls || [];
        last.tool_calls.push(toolCall);
      } else {
        messages.push({ role: "assistant", content: "", tool_calls: [toolCall] });
      }
      continue;
    }

    // Normal role message
    const role = ROLE_MAP[item.role] || item.role;
    if (role === "system") {
      system_prompt = system_prompt ? `${system_prompt}\n${extractText(item.content)}` : extractText(item.content);
      continue;
    }
    if (role === "user" || role === "assistant" || role === "tool") {
      messages.push({ role, content: extractText(item.content) });
    }
  }

  const tools = (cfg.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    type: t.type || "function"
  }));

  return {
    service: "openai",
    model: cfg.model || null,
    system_prompt,
    messages,
    tools,
    max_tokens: cfg.max_output_tokens ?? cfg.max_tokens ?? null,
    raw: cfg
  };
};

// ---------- Gemini ----------
const lowerCaseSchemaTypes = (schema) => {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(lowerCaseSchemaTypes);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "type" && typeof v === "string") out[k] = v.toLowerCase();
    else if (v && typeof v === "object") out[k] = lowerCaseSchemaTypes(v);
    else out[k] = v;
  }
  return out;
};

const normalizeGemini = (cfg) => {
  const system_prompt = extractText(cfg.config?.system_instruction || cfg.system_instruction || "");

  const messages = (cfg.contents || []).map((c) => ({
    role: ROLE_MAP[c.role] || c.role,
    content: extractText(c.parts)
  }));

  const rawTools = cfg.config?.tools || cfg.tools || [];
  const tools = [];
  for (const group of rawTools) {
    const decls = group.function_declarations || group.functionDeclarations || [];
    for (const d of decls) {
      tools.push({
        name: d.name,
        description: d.description,
        parameters: lowerCaseSchemaTypes(d.parameters),
        type: "function"
      });
    }
  }

  return {
    service: "gemini",
    model: cfg.model || null,
    system_prompt,
    messages,
    tools,
    max_tokens: cfg.generationConfig?.maxOutputTokens ?? cfg.config?.max_output_tokens ?? cfg.max_output_tokens ?? null,
    raw: cfg
  };
};

// ---------- Anthropic ----------
const normalizeAnthropic = (cfg) => {
  const messages = (cfg.messages || []).map((m) => ({
    role: ROLE_MAP[m.role] || m.role,
    content: extractText(m.content)
  }));

  const tools = (cfg.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema || t.parameters,
    type: t.type || "function"
  }));

  return {
    service: "anthropic",
    model: cfg.model || null,
    system_prompt: typeof cfg.system === "string" ? cfg.system : extractText(cfg.system),
    messages,
    tools,
    max_tokens: cfg.max_tokens ?? null,
    raw: cfg
  };
};

/**
 * Main entry point. Accepts any of the supported ai_config shapes.
 * Optionally pass an explicit `service` to skip detection.
 */
export const normalizeAiConfig = (config, service) => {
  if (!config || typeof config !== "object") {
    return { service: "unknown", model: null, system_prompt: "", messages: [], tools: [], max_tokens: null, raw: config };
  }
  const detected = service || detectService(config);
  switch (detected) {
    case "gemini":
      return normalizeGemini(config);
    case "anthropic":
      return normalizeAnthropic(config);
    default:
      return normalizeOpenAI(config);
  }
};

export default normalizeAiConfig;
