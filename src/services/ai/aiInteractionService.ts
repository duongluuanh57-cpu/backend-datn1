/**
 * aiInteractionService — Sử dụng Vercel AI SDK (Interactions API) cho Gemini
 * 
 * API: streamText, generateText, embed từ 'ai' + '@ai-sdk/google'
 * 
 * Dùng google.interactions() để gọi Gemini Interactions API
 * (POST /v1beta/interactions) — API mới nhất của Google
 */
import { streamText, generateText, embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const PRIMARY_MODEL = 'gemini-3.1-flash-lite-preview';
const FALLBACK_MODEL = 'gemini-2.5-flash';
const EMBEDDING_MODEL = 'gemini-embedding-2';

// ── HELPERS ──────────────────────────────────────────────────────────────

/** Validate API key */
function validateKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key || key.trim() === '' || key === 'your_gemini_api_key') {
    throw new Error(
      '❌ GEMINI_API_KEY is not configured or is invalid. ' +
      'Please set a valid GEMINI_API_KEY in your environment variables.'
    );
  }
  return key;
}

export function getGoogleProvider() {
  const apiKey = validateKey();
  return createGoogleGenerativeAI({ apiKey });
}

// ── MAIN FUNCTIONS ───────────────────────────────────────────────────────

/**
 * Stream chat — dùng streamText + google.interactions() (Interactions API)
 * Kèm fallback sang model ổn định khi model preview bị bận/lỗi
 */
export async function createChatStream(
  messages: { role: string; content: string }[],
  systemPrompt?: string,
  image?: string
): Promise<Response> {
  const provider = getGoogleProvider();

  // Map messages từ format cũ sang Vercel AI SDK format
  const vercelMessages = messages
    .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'model')
    .map(m => {
      const content: any = [{ type: 'text' as const, text: m.content || '' }];
      return { role: m.role === 'model' ? 'assistant' as const : 'user' as const, content };
    });

  // Nếu có image, inject vào message cuối
  if (image && vercelMessages.length > 0) {
    const lastMsg = vercelMessages[vercelMessages.length - 1];
    if (typeof lastMsg.content === 'string') {
      lastMsg.content = [{ type: 'text' as const, text: lastMsg.content }];
    }
    if (Array.isArray(lastMsg.content)) {
      lastMsg.content.push({
        type: 'image' as const,
        image: image.split(',')[1] || image,
      });
    }
  }

  const encoder = new TextEncoder();
  let textStream: any;

  try {
    const result = streamText({
      model: provider.interactions(PRIMARY_MODEL),
      system: systemPrompt || undefined,
      messages: vercelMessages,
    });
    textStream = result.textStream;
  } catch (primaryErr) {
    console.warn(`⚠️ [createChatStream] Primary model ${PRIMARY_MODEL} lỗi, chuyển sang ${FALLBACK_MODEL}:`, primaryErr);
    try {
      const fallbackResult = streamText({
        model: provider(FALLBACK_MODEL),
        system: systemPrompt || undefined,
        messages: vercelMessages,
      });
      textStream = fallbackResult.textStream;
    } catch (fallbackErr) {
      console.error('❌ [createChatStream] Toàn bộ AI models không phản hồi:', fallbackErr);
      const fallbackMsg = "Dạ hiện tại hệ thống AI đang quá tải một chút, bạn vui lòng đợi trong giây lát rồi nhắn lại giúp mình nhé! Cảm ơn bạn :3";
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(fallbackMsg));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }
  }

  // Chuyển đổi stream về Response dạng ReadableStream với cơ chế bọc lỗi an toàn
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of textStream) {
          if (chunk) controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (streamErr: any) {
        console.warn('⚠️ [createChatStream] Lỗi stream chunk:', streamErr?.message || streamErr);
        controller.enqueue(encoder.encode("\n\n*(Kết nối gặp chút gián đoạn, bạn có thể nhắn lại để mình tư vấn chi tiết hơn nhé :3)*"));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Generate text (non-stream) — dùng generateText + Interactions API
 * Dùng cho classification, tool calling
 */
export async function generateTextResponse(
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  const provider = getGoogleProvider();

  const result = await generateText({
    model: provider.interactions(PRIMARY_MODEL),
    system: systemPrompt || undefined,
    messages: [{ role: 'user' as const, content: prompt }],
  });

  return result.text;
}

/**
 * Generate embedding — dùng embed từ Vercel AI SDK
 */
export async function generateEmbeddingVector(text: string): Promise<number[]> {
  const provider = getGoogleProvider();

  const { embedding } = await embed({
    model: provider.embedding(EMBEDDING_MODEL),
    value: text,
  });

  return embedding;
}

/**
 * Health check
 */
export async function healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
  try {
    const provider = getGoogleProvider();
    const result = await generateText({
      model: provider.interactions(PRIMARY_MODEL),
      messages: [{ role: 'user', content: 'Test' }],
    });
    return {
      status: 'healthy',
      details: {
        apiKeyConfigured: true,
        model: PRIMARY_MODEL,
        apiType: 'interactions',
        testResponse: result.text.substring(0, 50) + '...',
      },
    };
  } catch (error: any) {
    return {
      status: 'unhealthy',
      details: {
        error: error.message,
        apiKeyConfigured: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY),
      },
    };
  }
}