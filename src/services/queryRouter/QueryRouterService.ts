/**
 * QueryRouterService — Entry point cho Query Routing
 *
 * Luồng xử lý:
 * 1. Nhận input (message, messages, image, tenantId, userRole)
 * 2. Kiểm tra cached answer từ feedback trước (nếu có → trả về ngay, không gọi AI)
 * 3. classifyRoute() → xác định route
 * 4. Kiểm tra role (admin routes cần ADMIN/SUBADMIN)
 * 5. Execute route tương ứng
 * 6. Trả về kết quả (text hoặc stream)
 */
import { classifyRoute } from './routeClassifier.ts';
import {
  executeVectorSearch,
  executeSqlSearch,
  executeWebSearch,
  executeGraphSearch,
  executeAdminQuery,
} from './routeExecutors.ts';
import type { RouteInput, RouteResult } from './queryRouterTypes.ts';
import { CachedAnswerService } from '../CachedAnswerService.ts';

export class QueryRouterService {
  /**
   * Xử lý message từ user chat hoặc admin chat
   */
  static async route(input: RouteInput): Promise<RouteResult> {
    const { message, messages, image, tenantId, userRole } = input;
    const startTime = Date.now();

    try {
      // ── Step 0: Kiểm tra cached answer từ feedback trước ──
      // Nếu có cache hit (câu hỏi tương tự đã được đánh giá 4-5★), trả về ngay, không gọi AI
      if (message && !image) {
        const cached = await CachedAnswerService.findCachedAnswer(message, tenantId);
        if (cached) {
          const elapsed = Date.now() - startTime;
          console.log(`✅ [QueryRouter] Cached answer hit (rating: ${cached.rating}) in ${elapsed}ms`);
          return {
            type: 'direct',
            content: cached.answer,
          };
        }
        console.log(`[QueryRouter] No cached answer for: "${message.substring(0, 60)}"`);
      }

      // ── Step 1: Classify route ──
      const classification = await classifyRoute(input);
      const { route, confidence, requiresAdmin } = classification;

      console.log(`🔀 [QueryRouter] Route: ${route} | Confidence: ${confidence.toFixed(2)} | Role: ${userRole || 'guest'} | Msg: "${message.substring(0, 60)}"`);

      // ── Step 2: Check role for admin routes ──
      if (route === 'admin_query') {
        const isAdmin = userRole === 'ADMIN' || userRole === 'SUBADMIN';
        if (!isAdmin) {
          console.log(`⛔ [QueryRouter] Admin route denied for role: ${userRole}`);
          return {
            type: 'direct',
            content: 'Xin lỗi, bạn không có quyền truy cập vào thông tin quản trị. Tính năng này chỉ dành cho quản trị viên. Nếu bạn cần hỗ trợ, hãy liên hệ với đội ngũ quản trị.',
          };
        }
      }

      // ── Step 3: Execute route ──
      let result: RouteResult;

      switch (route) {
        // ── Fast paths: no AI needed ──
        case 'greeting': {
          const isAdmin = userRole === 'ADMIN' || userRole === 'SUBADMIN';
          if (isAdmin) {
            const adminName = input.userName || 'sếp';
            result = {
              type: 'direct',
              content: `Dạ chào ${adminName}, em sẵn sàng hỗ trợ ạ. Sếp cần em tra cứu gì không ạ?`,
            };
          } else {
            const greetings = [
              "Chào bạn! Mình là Tinco, trợ lý AI của L'essence. Mình có thể giúp gì cho bạn hôm nay? ✨",
              "Xin chào! Rất vui được gặp bạn tại L'essence. Bạn cần tư vấn về nước hoa không? 😊",
              "Chào bạn! Cảm ơn bạn đã ghé thăm. Mình sẵn sàng hỗ trợ bạn chọn nước hoa phù hợp nhé! :3",
            ];
            result = {
              type: 'direct',
              content: greetings[Math.floor(Math.random() * greetings.length)],
            };
          }
          break;
        }

        case 'confusion': {
          const isAdmin = userRole === 'ADMIN' || userRole === 'SUBADMIN';
          result = {
            type: 'direct',
            content: isAdmin
              ? "Dạ em chưa nắm rõ ý sếp lắm ạ, sếp có thể nói cụ thể hơn giúp em được không ạ?"
              : "Mình xin lỗi, mình chưa hiểu ý bạn lắm. Bạn có thể nói rõ hơn về nhu cầu của mình không ạ? 🥺 Mình có thể giúp bạn tìm nước hoa theo mùi hương, hãng, hoặc khoảng giá bạn mong muốn!",
          };
          break;
        }

        case 'gibberish': {
          const isAdmin = userRole === 'ADMIN' || userRole === 'SUBADMIN';
          result = {
            type: 'direct',
            content: isAdmin
              ? "Dạ em chưa hiểu ạ, sếp nhập lại rõ hơn giúp em nhé."
              : "Xin lỗi bạn, mình không hiểu rõ thông tin bạn vừa nhập. Bạn muốn tìm nước hoa với mùi hương như thế nào, hoặc bạn cần mình tư vấn gì không ạ? 😊",
          };
          break;
        }

        // ── AI-powered routes ──
        case 'vector_search': {
          const stream = await executeVectorSearch(message, tenantId, userRole);
          result = { type: 'stream', streamResponse: stream };
          break;
        }

        case 'sql_search': {
          const stream = await executeSqlSearch(message, tenantId, userRole);
          result = { type: 'stream', streamResponse: stream };
          break;
        }

        case 'web_search': {
          const stream = await executeWebSearch(message, tenantId, userRole);
          result = { type: 'stream', streamResponse: stream };
          break;
        }

        case 'graph_search': {
          const stream = await executeGraphSearch(message, tenantId, userRole);
          result = { type: 'stream', streamResponse: stream };
          break;
        }

        case 'admin_query': {
          const adminResult = await executeAdminQuery(
            message,
            messages || [],
            tenantId,
            userRole
          );
          if (adminResult.text) {
            result = { type: 'direct', content: adminResult.text };
          } else if (adminResult.stream) {
            result = { type: 'stream', streamResponse: adminResult.stream };
          } else {
            result = {
              type: 'direct',
              content: 'Có lỗi xảy ra khi xử lý yêu cầu quản trị.',
            };
          }
          break;
        }

        default: {
          // Fallback: dùng vector search
          const stream = await executeVectorSearch(message, tenantId, userRole);
          result = { type: 'stream', streamResponse: stream };
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`✅ [QueryRouter] Completed route ${route} in ${elapsed}ms`);
      return result;

    } catch (error: any) {
      console.error('❌ [QueryRouter] Error:', error);
      return {
        type: 'direct',
        content: `Xin lỗi, đã có lỗi xảy ra: ${error.message}. Vui lòng thử lại sau.`,
        error: error.message,
      };
    }
  }
}