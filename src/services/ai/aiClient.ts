import { GoogleGenerativeAI } from '@google/generative-ai';

let _genAI: GoogleGenerativeAI | null = null;

/**
 * Validate GEMINI_API_KEY
 */
function validateApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_gemini_api_key') {
    throw new Error(
      '❌ GEMINI_API_KEY is not configured or is invalid. ' +
      'Please set a valid GEMINI_API_KEY in your environment variables.'
    );
  }
  if (apiKey.length < 20) {
    throw new Error(
      '❌ GEMINI_API_KEY appears to be invalid (too short). ' +
      'Please check your API key configuration.'
    );
  }
  return apiKey;
}

/**
 * Get or initialize the Gemini client singleton
 */
export function getGeminiClient(): GoogleGenerativeAI {
  if (!_genAI) {
    try {
      const apiKey = validateApiKey();
      _genAI = new GoogleGenerativeAI(apiKey);
      console.log('✅ [AIService] Google Generative AI client initialized successfully');
    } catch (error: any) {
      console.error('❌ [AIService] Failed to initialize AI client:', error.message);
      throw error;
    }
  }
  return _genAI;
}

export const PRIMARY_MODEL = 'gemini-3.1-flash-lite';

// ponytail: chỉ 2 export này còn được gọi (aiModerationService + FlashSaleController).
// Đã xoá vì không caller: healthCheck, CACHE_TTL, RETRY_CONFIG, TELEMETRY_CONFIG,
// get*TokensUsed, resetAICallSummaries, generateChatCompletionStream + helper telemetry.
