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

/**
 * Health check for AI service
 */
export async function healthCheck(): Promise<{ status: 'healthy' | 'unhealthy', details: any }> {
  try {
    const apiKey = validateApiKey();
    const client = getGeminiClient();
    const model = client.getGenerativeModel({ model: PRIMARY_MODEL });
    const result = await model.generateContent('Test');
    return {
      status: 'healthy',
      details: {
        apiKeyConfigured: true,
        apiKeyLength: apiKey.length,
        model: PRIMARY_MODEL,
        testResponse: result.response.text().substring(0, 50) + '...'
      }
    };
  } catch (error: any) {
    return {
      status: 'unhealthy',
      details: {
        error: error.message,
        apiKeyConfigured: !!process.env.GEMINI_API_KEY,
        apiKeyLength: process.env.GEMINI_API_KEY?.length || 0
      }
    };
  }
}

export const PRIMARY_MODEL = 'gemini-3.1-flash-lite';
export const CACHE_TTL = 60 * 60 * 24;

/**
 * Retry configuration for AI calls
 */
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2
} as const;

/**
 * Telemetry/Logging configuration
 */
export const TELEMETRY_CONFIG = {
  logCalls: true,
  logErrors: true,
  logResults: true
} as const;

/**
 * AI call summary for telemetry
 */
interface AICallSummary {
  timestamp: number;
  success: boolean;
  model: string;
  promptLength: number;
  responseLength: number;
  startTime: number;
  endTime: number;
  error?: string;
  errorType?: 'network' | 'rate_limit' | 'validation' | 'provider';
}

/**
 * Track AI call telemetry locally (no external telemetry service)
 */
let aiCallSummaries: AICallSummary[] = [];

/**
 * Track token usage per call
 */
let totalTokensUsed = 0;

/**
 * Get recent AI call summaries
 */
export function getAICallSummaries(): AICallSummary[] {
  return aiCallSummaries;
}

/**
 * Get total tokens used
 */
export function getTotalTokensUsed(): number {
  return totalTokensUsed;
}

/**
 * Reset telemetry (for testing)
 */
export function resetAICallSummaries(): void {
  aiCallSummaries = [];
  totalTokensUsed = 0;
}

/**
 * Calculate delay with exponential backoff
 */
function calculateDelay(retryCount: number): number {
  const delay = Math.min(
    RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
    RETRY_CONFIG.maxDelay
  );
  return delay;
}

/**
 * Classify AI errors for telemetry
 */
function classifyError(error: any): {
  type: 'network' | 'rate_limit' | 'validation' | 'provider';
  message: string;
} {
  const message = error.message.toLowerCase();
  
  if (message.includes('rate limit') || message.includes('quota exceeded') || 
      message.includes('429') || message.includes('quota')) {
    return { type: 'rate_limit', message: error.message };
  }
  if (message.includes('network') || message.includes('connection') || 
      message.includes('timeout') || message.includes('fetch')) {
    return { type: 'network', message: error.message };
  }
  if (message.includes('invalid') || message.includes('unauthorized') || 
      message.includes('401') || message.includes('403')) {
    return { type: 'validation', message: error.message };
  }
  
  return { type: 'provider', message: error.message };
}

/**
 * Log AI call telemetry
 */
function logAICall(params: {
  success: boolean;
  model: string;
  promptLength: number;
  responseLength: number;
  error?: string;
  errorType?: string;
  startTime: number;
  endTime: number;
}): void {
  aiCallSummaries.push({
    timestamp: Date.now(),
    success: params.success,
    model: params.model,
    promptLength: params.promptLength,
    responseLength: params.responseLength,
    startTime: params.startTime,
    endTime: params.endTime,
    error: params.error,
    errorType: params.errorType as any
  });
}

/**
 * Generate chat completion with retry and telemetry
 */
export async function generateChatCompletionStream(
  messages: Array<{ role: string; content: string; }>,
  options?: {
    model?: string;
    temperature?: number;
    topP?: number;
    topK?: number;
  }
): Promise<{
  fullResponse: string;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}> {
  const startTime = Date.now();
  let responseText = '';
  let lastError: any;
  let lastErrorType: string;
  
  const model = options?.model || PRIMARY_MODEL;
  const temperature = options?.temperature ?? 0.7;
  const topP = options?.topP ?? 0.95;
  const topK = options?.topK ?? 20;
  const promptLength = JSON.stringify(messages).length;
  
  // Retry loop
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const client = getGeminiClient();
      const genModel = client.getGenerativeModel({ 
        model,
        generationConfig: {
          temperature,
          topP,
          topK
        },
        systemInstruction: 'You are a helpful AI assistant. ' +
          'Always respond in the requested language (Vietnamese). ' +
          'Do not add JSON around your responses unless explicitly asked.'
      });
      
      // Stream response
      const stream = await genModel.generateContentStream(messages as any);
      let chunkCount = 0;
      let chunkSize = 0;
      
      for await (const chunk of stream) {
        chunkCount++;
        chunkSize += chunk.text().length;
      }
      
      // Get final response (no duplicate stream)
      const result = await genModel.generateContent(messages as Array<any>);
      const response = await result.response;
      responseText = response.text();
      const responseLength = responseText.length;
      const endTime = Date.now();
      const usage = result.response.usageMetadata;
      
      if (usage) {
        totalTokensUsed += usage.totalTokenCount;
      }
      
      // Log telemetry
      if (TELEMETRY_CONFIG.logResults) {
        logAICall({
          success: true,
          model,
          promptLength,
          responseLength,
          startTime,
          endTime
        });
      }
      
      return {
        fullResponse: responseText,
        finishReason: 'STOP',
        usage: usage ? {
          promptTokens: usage.promptTokenCount,
          completionTokens: usage.candidates[0]?.content?.parts?.[0]?.tokenCount || 0,
          totalTokens: usage.totalTokenCount
        } : undefined
      };
      
    } catch (error: any) {
      lastError = error;
      lastErrorType = classifyError(error).type;
      
      if (RETRY_CONFIG.logErrors && attempt < RETRY_CONFIG.maxRetries) {
        console.error(`⚠️ [AIService] Attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1} failed:`, error.message);
      }
      
      // Exponential backoff before retry
      if (attempt < RETRY_CONFIG.maxRetries) {
        const delay = calculateDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // All retries failed
  const endTime = Date.now();
  
  if (RETRY_CONFIG.logErrors) {
    console.error(
      '❌ [AIService] All retries failed after',
      RETRY_CONFIG.maxRetries + 1,
      'attempts. Last error:', lastError?.message
    );
  }
  
  logAICall({
    success: false,
    model,
    promptLength,
    responseLength: 0,
    error: lastError?.message || 'Unknown error',
    errorType: lastErrorType,
    startTime,
    endTime
  });
  
  throw lastError;
}