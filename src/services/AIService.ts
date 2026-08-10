/**
 * AIService — Barrel file (re-export từ các module nhỏ hơn)
 *
 * Code thực tế đã được chuyển sang Vercel AI SDK Interactions API:
 *   - aiInteractionService.ts → createChatStream, generateTextResponse, generateEmbeddingVector, healthCheck
 *   - aiStreamService.ts      → delegate sang aiInteractionService
 *   - aiEmbedding.ts           → delegate sang aiInteractionService
 *   - aiResponseService.ts     → delegate sang aiInteractionService
 *   - aiVisionService.ts       → identifyProduct (giữ lại tạm)
 */
// Lazy-load các module AI nặng ('ai', '@ai-sdk/google', '@google/generative-ai')
// để không phải nạp chúng lúc server khởi động — chỉ load khi có request /api/ai/*
// Re-import cho backward-compatible class

// ============================================================
// Backward-compatible AIService class
// Giữ nguyên tên class + method signatures để không break imports
// ============================================================
export class AIService {
  static async healthCheck() {
    const { healthCheck: _healthCheck } = await import('./ai/aiInteractionService.ts');
    return _healthCheck();
  }

  static async createChatStream(messages: any[], systemPrompt?: string, image?: string) {
    const { createChatStream: _createChatStream } = await import('./ai/aiStreamService.ts');
    return _createChatStream(messages, systemPrompt, image);
  }

  static async generateResponse(prompt: string, userId?: string, modelName?: string) {
    const { generateResponse: _generateResponse } = await import('./ai/aiResponseService.ts');
    return _generateResponse(prompt, userId, modelName);
  }

  static async generateEmbedding(text: string): Promise<number[]> {
    const { generateEmbedding: _generateEmbedding } = await import('./ai/aiEmbedding.ts');
    return _generateEmbedding(text);
  }

  static async identifyProduct(image: string, prompt: string): Promise<string> {
    const { identifyProduct: _identifyProduct } = await import('./ai/aiVisionService.ts');
    return _identifyProduct(image, prompt);
  }
}
