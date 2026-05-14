/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

export const ADVANCED_BRIDGE_PARAMETERS = {
  creativity_level: {
    name: "Creativity Level",
    description:
      "Controls the creativity of responses. Higher values (e.g., 0.7) increase creativity; lower values (e.g., 0.2) make responses more predictable."
  },
  max_tokens: {
    name: "Max Tokens Limit",
    description: "Specifies the maximum number of text units (tokens) allowed in a response, limiting its length."
  },
  token_selection_limit: {
    name: "Max Tokens Limit (Top K)",
    description: "Limits responses to the most likely words. Lower values focus on the most probable choices."
  },
  response_type: { name: "Response Type", description: "Defines the format or type of the generated response." },
  probability_cutoff: {
    name: "Probability Cutoff (Top P)",
    description: "Focuses on the most likely words based on a percentage of probability."
  },
  repetition_penalty: {
    name: "Repetition Penalty",
    description:
      "The `frequency_penalty` controls how often the model repeats itself, with higher positive values reducing repetition and negative values encouraging it."
  },
  novelty_penalty: {
    name: "Novelty Penalty",
    description: "Discourages responses that are too similar to previous ones."
  },
  log_probability: {
    name: "Log Probability",
    description: "If true, returns the log probabilities of each output token returned in the content of message."
  },
  response_count: { name: "Response Count (n)", description: "Specifies how many different responses to generate." },
  response_suffix: { name: "Response Suffix", description: "Adds specific text at the end of each response." },
  additional_stop_sequences: {
    name: "Stop Sequences",
    description: "Stops generating text when certain phrases are reached."
  },
  input_text: { name: "Input Text", description: "The starting point for generating responses." },
  echo_input: { name: "Echo Input", description: "Includes the original input text in the response." },
  best_response_count: {
    name: "Best Of",
    description: "Generates multiple responses and selects the most suitable one."
  },
  seed: { name: "Seed", description: "Ensures consistent responses by setting a fixed value." },
  tool_choice: {
    name: "Tool Choice",
    description: "Decides whether to use tools or just the model for generating responses."
  },
  stream: { name: "Stream", description: "Sends the response in real-time as it's being generated." },
  stop: {
    name: "Stop",
    description: "This parameter tells the model to stop generating text when it reaches any of the specified sequences (like a word or punctuation)"
  },
  top_p: {
    name: "Top_p",
    description:
      "Anthropic Claude computes the cumulative distribution over all the options for each subsequent token in decreasing probability order and cuts it off once it reaches a particular probability specified by top_p. You should alter either temperature or top_p, but not both."
  },
  top_k: { name: "Top_k", description: "Use top_k to remove long tail low probability responses." },
  parallel_tool_calls: {
    name: "Parallel Tool Calls",
    description: "Enables parallel execution of tools, allowing multiple tools to run simultaneously."
  },
  reasoning: {
    name: "Reasoning",
    description: "Controls the level of reasoning used by the model."
  },
  aspect_ratio: {
    name: "Aspect Ratio",
    description: "Defines the width-to-height proportion for generated visual output."
  },
  camera_fixed: {
    name: "Camera Fixed",
    description: "Locks camera movement so framing remains stable during generation."
  },

  content: {
    name: "Content",
    description: "Holds the main input content or prompt text used for generation."
  },
  detect_entities: {
    name: "Detect Entities",
    description: "Enables detection of named entities such as people, places, and organizations."
  },
  detect_language: {
    name: "Detect Language",
    description: "Automatically identifies the language of the input or generated text."
  },
  diarize: {
    name: "Speaker Diarization",
    description: "Separates and labels different speakers in audio transcription tasks."
  },
  uration_seconds: {
    name: "Duration (Seconds)",
    description: "Sets the output duration in seconds for time-based media generation."
  },
  filler_words: {
    name: "Filler Words",
    description: "Controls whether filler words like um and uh are preserved or removed."
  },
  frame_rate: {
    name: "Frame Rate",
    description: "Specifies the number of frames per second for video output."
  },
  image_size: {
    name: "Image Size",
    description: "Defines the image dimensions preset used during image generation."
  },
  language: {
    name: "Language",
    description: "Sets the language to use for processing, transcription, or generation."
  },
  model: {
    name: "Model",
    description: "Specifies the model identifier used to process the request."
  },
  model_option: {
    name: "Model Option",
    description: "Stores additional model-specific mode or option selection."
  },
  n: {
    name: "Response Count (n)",
    description: "Controls how many candidate responses are generated for one request."
  },
  number_of_images: {
    name: "Number of Images",
    description: "Specifies how many images to generate for a single prompt."
  },
  numerals: {
    name: "Numerals",
    description: "Controls formatting behavior for numbers in generated or transcribed text."
  },
  paragraphs: {
    name: "Paragraphs",
    description: "Controls whether output is organized and split into paragraph blocks."
  },
  punctuate: {
    name: "Punctuate",
    description: "Adds or normalizes punctuation in generated or transcribed text."
  },
  quality: {
    name: "Quality",
    description: "Sets the output quality level, usually trading speed for fidelity."
  },
  resolution: {
    name: "Resolution",
    description: "Defines pixel resolution settings for generated visual output."
  },
  size: {
    name: "Size",
    description: "Sets a general size parameter used by selected models or generators."
  },
  smart_format: {
    name: "Smart Format",
    description: "Applies automatic formatting improvements for cleaner final output."
  },
  style: {
    name: "Style",
    description: "Defines stylistic guidance such as tone, look, or rendering style."
  },
  tools: {
    name: "Tools",
    description: "Lists tool definitions or capabilities available to the model."
  },
  type: {
    name: "Type",
    description: "Indicates the configuration category or payload type."
  },
  utterances: {
    name: "Utterances",
    description: "Stores utterance-level data, often used for speech or dialogue processing."
  },
  verbosity: {
    name: "Verbosity",
    description: "Controls how concise or detailed the generated response should be."
  },
  video_settings: {
    name: "Video Settings",
    description: "Contains grouped parameters used for video generation behavior."
  }
};

/**
 * Migration: Add parameter display info to ModelConfig
 *
 * This migration adds name and description fields to parameter configurations
 * in the ModelConfig collection, moving static display information from frontend
 * to database for dynamic management.
 */
export const up = async (db) => {
  console.log("Starting migration: Add parameter display info to ModelConfig...");

  try {
    console.log("Starting migration for parameter display info...");

    // Get all model configurations using the collection directly
    const modelConfigs = db.collection("modelconfigurations");
    const allConfigs = await modelConfigs.find({}).toArray();
    console.log(`Found ${allConfigs.length} model configurations to update`);

    let updateCount = 0;

    for (const config of allConfigs) {
      let needsUpdate = false;
      const updatedConfig = { ...config };

      // Update each parameter with name and description
      if (updatedConfig.configuration) {
        for (const [paramKey, paramConfig] of Object.entries(updatedConfig.configuration)) {
          if (paramKey === "model") continue; // Skip model parameter

          if (ADVANCED_BRIDGE_PARAMETERS[paramKey]) {
            const paramDisplayInfo = ADVANCED_BRIDGE_PARAMETERS[paramKey];

            // Handle parameter configuration object (most parameters)
            if (paramConfig && typeof paramConfig === "object") {
              // Add name if it doesn't exist
              if (!paramConfig.name) {
                paramConfig.name = paramDisplayInfo.name;
                needsUpdate = true;
              }

              // Add description if it doesn't exist
              if (!paramConfig.description) {
                paramConfig.description = paramDisplayInfo.description;
                needsUpdate = true;
              }
            }
          } else {
            // Log parameters that exist in database but not in ADVANCED_BRIDGE_PARAMETERS
            console.log(
              `Warning: Parameter '${paramKey}' found in database for ${config.service}:${config.model_name} but not defined in ADVANCED_BRIDGE_PARAMETERS`
            );
          }
        }
      }

      if (needsUpdate) {
        try {
          await modelConfigs.updateOne({ _id: config._id }, { $set: { configuration: updatedConfig.configuration } });
          console.log(`  Updated display info for ${config.service}:${config.model_name}`);
          updateCount++;
        } catch (updateError) {
          console.error(`Failed to update ${config.service}:${config.model_name}:`, updateError);
        }
      }
    }

    console.log(`\nMigration completed successfully!`);
    console.log(`Total configurations processed: ${allConfigs.length}`);
    console.log(`Configurations updated: ${updateCount}`);
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  console.log("Starting rollback: Remove parameter display info from ModelConfig...");

  try {
    // Get all model configurations using the collection directly
    const modelConfigs = db.collection("modelconfigurations");
    const allConfigs = await modelConfigs.find({}).toArray();
    console.log(`Found ${allConfigs.length} model configurations to rollback`);

    let updateCount = 0;

    for (const config of allConfigs) {
      let needsUpdate = false;
      const updatedConfig = { ...config };

      // Remove name and description from each parameter
      if (updatedConfig.configuration) {
        for (const [paramKey, paramConfig] of Object.entries(updatedConfig.configuration)) {
          if (paramKey === "model") continue; // Skip model parameter

          if (paramConfig && typeof paramConfig === "object") {
            // Remove name if it exists
            if (paramConfig.name) {
              delete paramConfig.name;
              needsUpdate = true;
            }

            // Remove description if it exists
            if (paramConfig.description) {
              delete paramConfig.description;
              needsUpdate = true;
            }
          }
        }
      }

      if (needsUpdate) {
        try {
          await modelConfigs.updateOne({ _id: config._id }, { $set: { configuration: updatedConfig.configuration } });
          console.log(`  Removed display info for ${config.service}:${config.model_name}`);
          updateCount++;
        } catch (updateError) {
          console.error(`  Failed to rollback ${config.service}:${config.model_name}:`, updateError);
        }
      }
    }

    console.log(`\nRollback completed successfully!`);
    console.log(`Total configurations processed: ${allConfigs.length}`);
    console.log(`Configurations rolled back: ${updateCount}`);
  } catch (error) {
    console.error("Rollback failed:", error);
    throw error;
  }
};
