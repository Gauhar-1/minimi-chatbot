import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export interface ModelResolutionResult {
  model: LanguageModel;
  providerName: 'groq' | 'google' | 'openai';
  modelName: string;
}

/**
 * Resolves the configured LLM provider and model name.
 *
 * Rules:
 * - Reads process.env.LLM_PROVIDER ('groq' | 'google' | 'openai').
 * - If LLM_PROVIDER is not explicitly set, auto-detects whichever key is present.
 * - Defaults:
 *   - Groq: llama-3.3-70b-versatile
 *   - Google: gemini-2.5-flash (or gemini-2.0-flash)
 *   - OpenAI: gpt-4o-mini (or gpt-4o)
 * - Allows overriding model via process.env.LLM_MODEL or process.env.MODEL_NAME.
 * - Throws a clean, human-readable configuration error if zero LLM keys are configured.
 */
export function resolveLanguageModel(): ModelResolutionResult {
  const explicitProvider = process.env.LLM_PROVIDER?.toLowerCase().trim();
  const explicitModel = (process.env.LLM_MODEL || process.env.MODEL_NAME || '').trim();

  const groqKey = process.env.GROQ_API_KEY?.trim();
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  // Auto-detect provider if not explicitly configured
  let provider: 'groq' | 'google' | 'openai' | undefined = undefined;

  if (explicitProvider === 'groq' || explicitProvider === 'google' || explicitProvider === 'openai') {
    provider = explicitProvider;
  } else if (groqKey) {
    provider = 'groq';
  } else if (googleKey) {
    provider = 'google';
  } else if (openaiKey) {
    provider = 'openai';
  } else {
    // Default to groq if nothing detected
    provider = 'groq';
  }

  if (provider === 'google') {
    if (!googleKey) {
      throw new Error(
        'Missing GOOGLE_GENERATIVE_AI_API_KEY. Please add GOOGLE_GENERATIVE_AI_API_KEY to your .env or .env.local file, or configure GROQ_API_KEY.'
      );
    }
    const google = createGoogleGenerativeAI({ apiKey: googleKey });
    const modelName = explicitModel || process.env.GOOGLE_MODEL_NAME || 'gemini-2.5-flash';
    return {
      model: google(modelName),
      providerName: 'google',
      modelName,
    };
  }

  if (provider === 'openai') {
    if (!openaiKey) {
      throw new Error(
        'Missing OPENAI_API_KEY. Please add OPENAI_API_KEY to your .env or .env.local file, or configure GROQ_API_KEY.'
      );
    }
    const openai = createOpenAI({ apiKey: openaiKey });
    const modelName = explicitModel || process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini';
    return {
      model: openai(modelName),
      providerName: 'openai',
      modelName,
    };
  }

  // Groq provider
  if (!groqKey) {
    throw new Error(
      'No LLM API key detected. Please add GROQ_API_KEY (free at https://console.groq.com/keys) or GOOGLE_GENERATIVE_AI_API_KEY to your .env file.'
    );
  }

  const groq = createGroq({ apiKey: groqKey });
  const modelName = explicitModel || process.env.GROQ_MODEL_NAME || 'openai/gpt-oss-20b';
  return {
    model: groq(modelName),
    providerName: 'groq',
    modelName,
  };
}

