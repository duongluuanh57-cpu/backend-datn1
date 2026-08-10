import type { FastifyRequest, FastifyReply } from 'fastify';
import { QueryRouterService } from '../../services/queryRouter/QueryRouterService.ts';
import type { UserRole } from '../../services/queryRouter/queryRouterTypes.ts';
import { generateUser, createUserFromAI } from '../aiCatalog/generateUserController.ts';
import { generateBrand } from '../aiCatalog/generateBrandController.ts';
import { generateCategory, createCategoryFromAI } from '../aiCatalog/generateCategoryController.ts';
import { generateTag, createTagFromAI } from '../aiCatalog/generateTagController.ts';
import { generateVoucher, createVoucherFromAI } from '../aiCatalog/generateVoucherController.ts';
import { Brand } from '../../models/Brand.ts';
import { Product } from '../../models/Product.ts';
import { Category } from '../../models/Category.ts';
import { Tag } from '../../models/Tag.ts';
import { User } from '../../models/User.ts';
import { UserRepository } from '../../repositories/UserRepository.ts';
import { Order } from '../../models/Order.ts';
import { Voucher } from '../../models/Voucher.ts';
import { resolveBrandName } from '../../utils/synonymMap.ts';
import { AIService } from '../../services/AIService.ts';

/**
 * POST /api/ai/admin/chat
 * Admin Chat — sử dụng QueryRouter với context quản trị
 * 
 * Query Router tự động:
 * - Phân loại câu hỏi (thống kê, sản phẩm, user, ...)
 * - Check role (ADMIN/SUBADMIN)
 * - Execute route phù hợp
 * - Admin query có function calling để lấy dữ liệu thật
 * 
 * Ngoại lệ: Phát hiện intent tạo sản phẩm / user / brand / category / tag / voucher
 */
export async function adminChat(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = req.body as { message: string; history?: any[]; action?: string; entity?: string; data?: any };
    const message = body.message?.trim();
    const history = body.history || [];
    const userRole = ((req as any).user?.role || undefined) as UserRole;
    const userId = (req as any).user?.userId;
    const userDoc = userId ? await UserRepository.findById(userId) : null;
    const userName = userDoc?.fullName || userDoc?.username || 'Sếp';

    if (!message) {
      return reply.status(400).send({ error: 'Message is required' });
    }

    // ── Kiểm tra intent "tạo sản phẩm" (chỉ sản phẩm, không brand) ──
    // Cho phép: "tạo sản phẩm", "tạo 1 sản phẩm", "tạo một sản phẩm", "tạo cho t 1 sản phẩm", "tạo sp"
    //             "tạo cho 1 sản phẩm", "tạo cho 5 sản phẩm"
    const lowerMsg = message.toLowerCase();
    const justCreateProduct =
      /^tạo\s+(?:\d+\s+)?(?:một\s+vài\s+|một\s+)?sản\s+phẩm\s*$/i.test(lowerMsg) ||
      /^tạo\s+(?:\d+\s+)?sp\s*$/i.test(lowerMsg) ||
      /^tạo\s+(?:\d+\s+)?product\s*$/i.test(lowerMsg) ||
      /^tạo\s+cho\s+(?:tôi|t|mình|tao|tau|bạn|anh|chị|em|sếp|admin|quý\s+khách)\s+(?:\d+\s+)?(?:một\s+)?sản\s+phẩm\s*$/i.test(lowerMsg) ||
      /tạo\s+(?:\d+\s+)?(?:một\s+)?sản\s+phẩm\s+cho\s+(?:tôi|t|mình|tao|tau|bạn|anh|chị|em|sếp|admin|quý\s+khách)\s*$/i.test(lowerMsg) ||
      /^tạo\s+cho\s+\d+\s+sản\s+phẩm\s*$/i.test(lowerMsg);
    if (justCreateProduct) {
      const brands = await getRandomBrandsFromDB(5);
      if (brands.length > 0) {
        const brandItems = brands.map((b: any) => ({ name: b.name, action: 'tạo sản phẩm cho hãng ' + b.name }));
        return reply.send({
          type: 'brand_suggestions',
          message: `Dạ hiện có ${brands.length} hãng trong hệ thống, sếp chọn hãng nào ạ:`,
          brands: brandItems,
          source: 'db',
        });
      }
      return reply.send({ reply: 'Chưa có hãng nào trong hệ thống ạ. Sếp hãy tạo hãng mới trước nhé!' });
    }

    // ── Kiểm tra intent "tạo sản phẩm cho hãng X" ──
    // Cho phép: "tạo 1 sản phẩm cho hãng Adidas", "tạo sp cho Nike"
    const createPatterns = [
      /tạo\s+(?:\d+\s+)?(?:sản\s+phẩm\s+)?(?:cho|thương\s+hiệu|hãng|brand|của)?\s+(\S+(?:\s+\S+){0,3})/i,
      /làm\s+(?:\d+\s+)?(?:sản\s+phẩm\s+)?(?:cho|thương\s+hiệu|hãng|brand|của)?\s+(\S+(?:\s+\S+){0,3})/i,
      /thêm\s+(?:\d+\s+)?(?:sản\s+phẩm\s+)?(?:cho|thương\s+hiệu|hãng|brand|của)?\s+(\S+(?:\s+\S+){0,3})/i,
    ];

    for (const pattern of createPatterns) {
      const match = lowerMsg.match(pattern);
      if (match) {
        // Extract brand name từ TOÀN BỘ tin nhắn (không chỉ capture group)
        let brandName = '';
        const brandFromFullMsg = lowerMsg.match(/(?:hãng|brand|thương\s+hiệu)\s+(\S+(?:\s+\S+){0,2})/i);
        if (brandFromFullMsg) {
          brandName = brandFromFullMsg[1].trim();
        }
        // Fallback: tin nhắn có "thuộc/của/tại" + brand keyword hoặc tên brand
        if (!brandName) {
          const brandFromContext = lowerMsg.match(/(?:thuộc|của|tại|ở|từ|trong)\s+(?:hãng|brand|thương\s+hiệu)?\s*(\S+(?:\s+\S+){0,2})/i);
          if (brandFromContext) {
            brandName = brandFromContext[1].trim();
          }
        }
        // Fallback cuối: dùng capture group cũ
        if (!brandName) {
          brandName = match[1].trim();
        }

        // Resolve synonyms/typos (CK → Calvin Klein, channel → Chanel, etc.)
        const resolved = resolveBrandName(brandName);
        if (resolved) {
          brandName = resolved;
        } else {
          brandName = brandName.charAt(0).toUpperCase() + brandName.slice(1);
        }

        // Blacklist: Nếu brandName là đại từ nhân xưng → redirect về brand_suggestions
        const pronouns = ['t','tôi','mình','tao','tau','bạn','cậu','anh','chị','em','sếp','admin','mày','quý khách','khách'];
        if (pronouns.includes(brandName.toLowerCase()) || /^(t|tôi|mình|tao|tau)\s+\d/i.test(brandName)) {
          const brands = await getRandomBrandsFromDB(5);
          if (brands.length > 0) {
            const brandItems = brands.map((b: any) => ({ name: b.name, action: 'tạo sản phẩm cho hãng ' + b.name }));
            return reply.send({
              type: 'brand_suggestions',
              message: 'Dạ sếp chọn hãng muốn tạo sản phẩm ạ:',
              brands: brandItems,
              source: 'db',
            });
          }
          return reply.send({ reply: 'Chưa có hãng nào ạ. Sếp hãy tạo hãng mới trước nhé!' });
        }
        // Blacklist: Nếu brandName có dạng "1 sản phẩm", "2 sản phẩm" → redirect về brand_suggestions
        if (/^\d+\s+sản\s+phẩm/i.test(brandName)) {
          const brands = await getRandomBrandsFromDB(5);
          if (brands.length > 0) {
            const brandItems = brands.map((b: any) => ({ name: b.name, action: 'tạo sản phẩm cho hãng ' + b.name }));
            return reply.send({
              type: 'brand_suggestions',
              message: 'Dạ sếp chọn hãng muốn tạo sản phẩm ạ:',
              brands: brandItems,
              source: 'db',
            });
          }
          return reply.send({ reply: 'Chưa có hãng nào ạ. Sếp hãy tạo hãng mới trước nhé!' });
        }
        // Blacklist: Nếu brandName là "mới" hoặc chứa "mới" → redirect về gợi ý AI (tạo hãng mới)
        if (/mới/i.test(brandName)) {
          const brandNames = await generateBrandNamesWithAI(5);
          if (brandNames.length > 0) {
            const brandItems = brandNames.map((n: string) => ({ name: n, action: 'tạo thương hiệu ' + n }));
            return reply.send({
              type: 'brand_suggestions',
              message: 'Dạ em gợi ý 5 tên hãng sau ạ, sếp chọn cái nào ưng nha:',
              brands: brandItems,
              source: 'ai',
            });
          }
          return reply.send({ reply: 'Xin lỗi, tôi chưa gợi ý được tên hãng. Sếp thử lại sau nhé!' });
        }

        // Kiểm tra brand có tồn tại trong DB không
        const existingBrand = await Brand.findOne({ name: { $regex: `^${brandName}$`, $options: 'i' } }).lean();

        if (existingBrand) {
          // Brand tồn tại → trigger interview trực tiếp, bỏ qua bước hỏi
          return reply.send({
            type: 'interview_trigger',
            brandName: existingBrand.name,
            message: `Tôi sẽ giúp bạn tạo sản phẩm cho hãng ${existingBrand.name}. Hãy làm theo các bước sau:`,
          });
        } else if (!/sản\s+phẩm/i.test(message)) {
          // Message không chứa "sản phẩm" → ý định là tạo brand mới
          try {
            const genReq = { body: { name: brandName } } as FastifyRequest;
            const genReply = { status: () => ({ send: (d: any) => d }) } as any;
            const genResult = await generateBrand(genReq, genReply as FastifyReply);
            const bodyOut = (genResult as any).body ? JSON.parse((genResult as any).body) : genResult;
            const data = bodyOut.data || bodyOut;
            return reply.send({
              type: 'entity_preview',
              entity: 'brand',
              data: { name: brandName, ...data },
              message: `Tôi đã tạo sẵn thương hiệu:\n• Tên: ${brandName}\n• Xuất xứ: ${data.origin || '—'}\n\nBạn muốn tạo luôn không?`,
            });
          } catch (e: any) {
            return reply.send({ type: 'error', message: 'Không thể tạo thương hiệu: ' + e.message });
          }
        } else {
          // Message chứa "sản phẩm" + brand không tồn tại → gợi ý brand có sẵn trong DB
          const brands = await getRandomBrandsFromDB(5);
          if (brands.length > 0) {
            const brandItems = brands.map((b: any) => ({ name: b.name, action: 'tạo sản phẩm cho hãng ' + b.name }));
            return reply.send({
              type: 'brand_suggestions',
              message: `Không tìm thấy hãng "${brandName}" trong hệ thống. Sếp chọn hãng có sẵn ạ:`,
              brands: brandItems,
              source: 'db',
            });
          }
          return reply.send({ reply: `Không tìm thấy hãng "${brandName}" và chưa có hãng nào trong hệ thống ạ.` });
        }
      }
    }

    // ── Kiểm tra intent "tạo người dùng" ──
    const userIntent = /tạo\s+(?:người\s+dùng|user|tài\s+khoản|account)/i.exec(lowerMsg);
    if (userIntent) {
      try {
        const genReq = { body: { prompt: message } } as FastifyRequest;
        const genReply = { status: () => ({ send: (d: any) => d }) } as any;
        const genResult = await generateUser(genReq, genReply as FastifyReply);
        const bodyOut = (genResult as any).data || JSON.parse(await (genResult as any));
        return reply.send({
          type: 'entity_preview',
          entity: 'user',
          data: bodyOut,
          message: `Tôi đã tạo sẵn người dùng:\n• Tên: ${bodyOut.fullName}\n• Email: ${bodyOut.email}\n• Role: ${bodyOut.role}\n\nBạn muốn tạo luôn không?`,
        });
      } catch (e: any) {
        return reply.send({ type: 'error', message: 'Không thể tạo người dùng: ' + e.message });
      }
    }

    // ── Kiểm tra intent "Đề xuất 5 hãng" (từ nút refresh gợi ý) ──
    // "Đề xuất 5 tên hãng mới" → AI generate
    const suggestBrandAI = /đề\s+xuất\s+5\s+tên\s+hãng/i.test(lowerMsg);
    if (suggestBrandAI) {
      try {
        const brandNames = await generateBrandNamesWithAI(5);
        if (brandNames.length > 0) {
          const brandItems = brandNames.map((n: string) => ({ name: n, action: 'tạo thương hiệu ' + n }));
          return reply.send({
            type: 'brand_suggestions',
            message: 'Dạ em gợi ý 5 tên hãng mới sau ạ, sếp chọn cái nào ưng nha:',
            brands: brandItems,
            source: 'ai',
          });
        }
        return reply.send({ reply: 'Xin lỗi, tôi chưa gợi ý được tên hãng. Sếp thử lại sau nhé!' });
      } catch (e: any) {
        return reply.send({ type: 'error', message: 'Không thể gợi ý tên hãng: ' + e.message });
      }
    }

    // "Đề xuất 5 hãng sản phẩm khác" → random từ DB
    const suggestBrandDB = /đề\s+xuất\s+5\s+hãng/i.test(lowerMsg);
    if (suggestBrandDB) {
      try {
        const dbBrands = await getRandomBrandsFromDB(5);
        if (dbBrands.length > 0) {
          const brandItems = dbBrands.map((b: any) => ({ name: b.name, action: 'tạo sản phẩm cho hãng ' + b.name }));
          return reply.send({
            type: 'brand_suggestions',
            message: 'Dạ em gợi ý 5 hãng sau ạ, sếp chọn hãng nào để tạo sản phẩm:',
            brands: brandItems,
            source: 'db',
          });
        }
        return reply.send({ reply: 'Chưa có hãng nào trong hệ thống. Sếp tạo hãng trước nha!' });
      } catch (e: any) {
        return reply.send({ type: 'error', message: 'Không thể tải danh sách hãng: ' + e.message });
      }
    }

    // ── Kiểm tra intent "tạo thương hiệu / brand" ──
    // Case 1: "tạo hãng mới" (không tên cụ thể) → Gemini sinh 5 tên
    const createNewBrandNoName =
      /^tạo\s+(?:cho\s+(?:tôi|t|mình|tao|tau|bạn|anh|chị|em|sếp|admin)?\s+)?(?:một\s+)?(?:hãng|thương\s+hiệu|brand)\s+(?:mới|sản\s+phẩm\s+mới)\s*$/i.test(lowerMsg) ||
      /^tạo\s+(?:một\s+)?(?:hãng|thương\s+hiệu|brand)\s*$/i.test(lowerMsg) ||
      /^gợi\s+ý\s+(?:\d+\s+)?(?:tên\s+)?(?:hãng|thương\s+hiệu|brand)\s*$/i.test(lowerMsg);
    if (createNewBrandNoName) {
      try {
        const brandNames = await generateBrandNamesWithAI(5);
        if (brandNames.length > 0) {
          const brandItems = brandNames.map((n: string) => ({ name: n, action: 'tạo thương hiệu ' + n }));
          return reply.send({
            type: 'brand_suggestions',
            message: 'Dạ em gợi ý 5 tên hãng sau ạ, sếp chọn cái nào ưng nha:',
            brands: brandItems,
            source: 'ai',
          });
        }
        return reply.send({ reply: 'Xin lỗi, tôi chưa gợi ý được tên hãng. Sếp thử lại sau nhé!' });
      } catch (e: any) {
        return reply.send({ type: 'error', message: 'Không thể gợi ý tên hãng: ' + e.message });
      }
    }

    // Case 2: "tạo hãng Adidas" (có tên cụ thể) → check trùng + generate
    const brandIntent = /tạo\s+(?:thương\s+hiệu|brand|hãng)/i.exec(lowerMsg);
    if (brandIntent) {
      const nameMatch = /(?:thương\s+hiệu|brand|hãng)\s+(.+)/i.exec(message);
      const brandName = nameMatch ? nameMatch[1].trim() : '';
      if (!brandName) {
        // Không có tên → redirect về gợi ý AI
        const brandNames = await generateBrandNamesWithAI(5);
        if (brandNames.length > 0) {
          const brandItems = brandNames.map((n: string) => ({ name: n, action: 'tạo thương hiệu ' + n }));
          return reply.send({
            type: 'brand_suggestions',
            message: 'Dạ em gợi ý 5 tên hãng sau ạ, sếp chọn cái nào ưng nha:',
            brands: brandItems,
            source: 'ai',
          });
        }
        return reply.send({ reply: 'Xin lỗi, tôi chưa gợi ý được tên hãng. Sếp thử lại sau nhé!' });
      }
      // Check trùng brand trong DB
      const existingBrand = await Brand.findOne({ name: { $regex: `^${brandName}$`, $options: 'i' } }).lean();
      if (existingBrand) {
        return reply.send({ type: 'error', message: `Hãng "${brandName}" đã tồn tại trong hệ thống rồi ạ! Sếp chọn hãng khác hoặc tạo sản phẩm cho hãng này nhé.` });
      }
      try {
        const genReq = { body: { name: brandName } } as FastifyRequest;
        const genReply = { status: () => ({ send: (d: any) => d }) } as any;
        const genResult = await generateBrand(genReq, genReply as FastifyReply);
        const bodyOut = (genResult as any).body ? JSON.parse((genResult as any).body) : genResult;
        const data = bodyOut.data || bodyOut;
        return reply.send({
          type: 'entity_preview',
          entity: 'brand',
          data: { name: brandName, ...data },
          message: `Tôi đã tạo sẵn thương hiệu:\n• Tên: ${brandName}\n• Xuất xứ: ${data.origin || '—'}\n\nBạn muốn tạo luôn không?`,
        });
      } catch (e: any) {
        return reply.send({ type: 'error', message: 'Không thể tạo thương hiệu: ' + e.message });
      }
    }

    // ── Kiểm tra intent "tạo danh mục / category" ──
    const catIntent = /tạo\s+(?:danh\s+mục|category|loại\s+sản\s+phẩm)/i.exec(lowerMsg);
    if (catIntent) {
      try {
        const genReq = { body: { prompt: message } } as FastifyRequest;
        const genReply = { status: () => ({ send: (d: any) => d }) } as any;
        const genResult = await generateCategory(genReq, genReply as FastifyReply);
        const bodyOut = (genResult as any).data || genResult;
        return reply.send({
          type: 'entity_preview',
          entity: 'category',
          data: bodyOut,
          message: `Tôi đã tạo sẵn danh mục:\n• Tên: ${bodyOut.name}\n• Slug: ${bodyOut.slug}\n\nBạn muốn tạo luôn không?`,
        });
      } catch (e: any) {
        return reply.send({ type: 'error', message: 'Không thể tạo danh mục: ' + e.message });
      }
    }

    // ── Kiểm tra intent "tạo tag" ──
    const tagIntent = /tạo\s+tag/i.exec(lowerMsg);
    if (tagIntent) {
      try {
        const genReq = { body: { prompt: message } } as FastifyRequest;
        const genReply = { status: () => ({ send: (d: any) => d }) } as any;
        const genResult = await generateTag(genReq, genReply as FastifyReply);
        const bodyOut = (genResult as any).data || genResult;
        return reply.send({
          type: 'entity_preview',
          entity: 'tag',
          data: bodyOut,
          message: `Tôi đã tạo sẵn tag:\n• Tên: ${bodyOut.name}\n• Slug: ${bodyOut.slug}\n\nBạn muốn tạo luôn không?`,
        });
      } catch (e: any) {
        return reply.send({ type: 'error', message: 'Không thể tạo tag: ' + e.message });
      }
    }

    // ── Kiểm tra intent "tạo voucher / mã giảm giá" ──
    const voucherIntent = /tạo\s+(?:voucher|mã\s+giảm\s+giá|mã\s+khuyến\s+mãi|coupon)/i.exec(lowerMsg);
    if (voucherIntent) {
      try {
        const genReq = { body: { prompt: message } } as FastifyRequest;
        const genReply = { status: () => ({ send: (d: any) => d }) } as any;
        const genResult = await generateVoucher(genReq, genReply as FastifyReply);
        const bodyOut = (genResult as any).data || genResult;
        return reply.send({
          type: 'entity_preview',
          entity: 'voucher',
          data: bodyOut,
          message: `Tôi đã tạo sẵn mã giảm giá:\n• Code: ${bodyOut.code}\n• Loại: ${bodyOut.type}\n• Giá trị: ${bodyOut.value}${bodyOut.type === 'percentage' ? '%' : 'đ'}\n\nBạn muốn tạo luôn không?`,
        });
      } catch (e: any) {
        return reply.send({ type: 'error', message: 'Không thể tạo voucher: ' + e.message });
      }
    }

    // ── Xử lý xác nhận tạo entity (từ nút "Tạo luôn" trong chat) ──
    if (body.action === 'confirm_create') {
      return handleConfirmCreate(req, reply, body);
    }

    // ── Fast path: Admin simple DB lookups (tránh 9s+ Gemini chain) ──
    const fastResult = await tryAdminFastPath(message);
    if (fastResult) return reply.send({ reply: fastResult });

    // ── Query Routing (cho các câu hỏi thông thường) ──
    const result = await QueryRouterService.route({
      message,
      messages: history,
      userRole,
      userId,
      userName,
    });

    // ── Trả về kết quả ──
    if (result.type === 'direct' && result.content) {
      return reply.send({ reply: result.content });
    }

    if (result.type === 'stream' && result.streamResponse) {
      const origin = req.headers.origin || 'http://localhost:3000';
      const fb = result.streamResponse;
      if (!fb.body) throw new Error('No body from AI');

      reply.raw.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no',
        'Cache-Control': 'no-cache, no-transform',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
      });

      const reader = fb.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(value);
      }
      reply.raw.end();
      return reply;
    }

    // Fallback
    return reply.status(500).send({ error: 'No response generated' });

  } catch (error: any) {
    console.error('❌ [AdminChat Error]:', error);
    if (!reply.sent && !reply.raw.headersSent) {
      return reply.status(500).send({ error: error.message || 'Internal Server Error' });
    }
    if (!reply.raw.writableEnded) reply.raw.end();
    return reply;
  }
}

/**
 * Xử lý khi admin nhấn "Tạo luôn" trong chat để tạo entity thực sự
 */
async function handleConfirmCreate(req: FastifyRequest, reply: FastifyReply, body: any) {
  try {
    const { entity, data } = body;

    switch (entity) {
      case 'user': {
        const fakeReq = { body: { userData: data } } as FastifyRequest;
        const result = await createUserFromAI(fakeReq, reply);
        const parsed = parseResult(result);
        return reply.send({
          type: 'entity_created',
          entity: 'user',
          message: `Đã tạo người dùng **${parsed.username || data.username}** thành công!`,
        });
      }
      case 'brand': {
        // Check trùng brand trước khi tạo
        const existingBrand = await Brand.findOne({ name: { $regex: `^${data.name}$`, $options: 'i' } }).lean();
        if (existingBrand) {
          return reply.send({
            type: 'error',
            message: `Hãng "${data.name}" đã tồn tại trong hệ thống rồi ạ!`,
          });
        }
        const newBrand = await Brand.create({
          name: data.name,
          slug: data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          origin: data.origin || '',
          status: 'active',
        });
        return reply.send({
          type: 'entity_created',
          entity: 'brand',
          message: `Đã tạo thương hiệu **${newBrand.name}** thành công!`,
        });
      }
      case 'category': {
        const fakeReq = { body: { categoryData: data } } as FastifyRequest;
        const result = await createCategoryFromAI(fakeReq, reply);
        const parsed = parseResult(result);
        return reply.send({
          type: 'entity_created',
          entity: 'category',
          message: `Đã tạo danh mục **${parsed.name || data.name}** thành công!`,
        });
      }
      case 'tag': {
        const fakeReq = { body: { tagData: data } } as FastifyRequest;
        const result = await createTagFromAI(fakeReq, reply);
        const parsed = parseResult(result);
        return reply.send({
          type: 'entity_created',
          entity: 'tag',
          message: `Đã tạo tag **${parsed.name || data.name}** thành công!`,
        });
      }
      case 'voucher': {
        const fakeReq = { body: { voucherData: data } } as FastifyRequest;
        const result = await createVoucherFromAI(fakeReq, reply);
        const parsed = parseResult(result);
        return reply.send({
          type: 'entity_created',
          entity: 'voucher',
          message: `Đã tạo voucher **${parsed.code || data.code}** thành công!`,
        });
      }
      default:
        return reply.send({ type: 'error', message: 'Không xác định được loại entity' });
    }
  } catch (error: any) {
    console.error('❌ [Confirm Create Error]:', error);
    return reply.send({ type: 'error', message: 'Lỗi khi tạo: ' + error.message });
  }
}

function parseResult(result: any): any {
  if (result?.data) return result.data;
  if (result?.body) {
    try { return JSON.parse(result.body).data || JSON.parse(result.body); } catch { return result; }
  }
  return result || {};
}

/**
 * Lấy ngẫu nhiên N brand từ DB
 */
async function getRandomBrandsFromDB(count: number): Promise<any[]> {
  const total = await Brand.countDocuments();
  if (total === 0) return [];
  const limit = Math.min(count, total);
  const skip = Math.max(0, Math.floor(Math.random() * (total - limit)));
  return Brand.find().select('name origin').skip(skip).limit(limit).lean();
}

/**
 * Gọi Gemini AI gợi ý N tên hãng sáng tạo, check trùng DB
 */
async function generateBrandNamesWithAI(count: number): Promise<string[]> {
  const themes = ['tối giản sang trọng', 'đường phố trẻ trung', 'nữ tính dịu dàng', 'cá tính mạnh mẽ', 'thể thao năng động', 'bohemian tự do', 'cổ điển thanh lịch', 'hiện đại minimal', 'eco sustainable', 'luxury cao cấp', 'street style', 'vintage retro'];
  const randomTheme = themes[Math.floor(Math.random() * themes.length)];
  const randomSeed = Date.now().toString(36).slice(-4);
  const prompt = `Bạn là chuyên gia branding. Gợi ý ${count} tên thương hiệu thời trang/phụ kiện ${randomTheme}, sáng tạo, ngắn gọn, dễ nhớ, phù hợp thị trường Việt Nam.
[YEUCAU_${randomSeed}]
YÊU CẦU:
- Mỗi tên 1-3 từ, viết hoa chữ cái đầu (ví dụ: LuxVie, UrbanGlow, VietChic)
- KHÔNG trùng tên các thương hiệu nổi tiếng (Nike, Adidas, Gucci, LV, Chanel, Zara, H&M, Uniqlo, etc.)
- Phù hợp: thời trang, phụ kiện, mỹ phẩm, lifestyle
- Tên PHẢI MỚI HOÀN TOÀN, không được trùng với bất kỳ gợi ý trước đó
- Output CHỈ JSON array, không markdown, không giải thích
Ví dụ: ["LuxVie","UrbanGlow","StyleNest","VelvetCo","VietChic"]`;

  const response = await AIService.generateResponse(prompt, undefined, 'gemini-3.1-flash-lite');
  let jsonString = response.trim();

  // Parse JSON array from response
  if (jsonString.startsWith('```')) {
    jsonString = jsonString.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\`\`\`$/, '');
  }

  try {
    const parsed = JSON.parse(jsonString);
    const names = Array.isArray(parsed) ? parsed : [];
    if (names.length === 0) return [];

    // Check trùng DB — lọc bỏ tên đã tồn tại
    const regexPatterns = names.map((n: string) => new RegExp(`^${n}$`, 'i'));
    const existingBrands = await Brand.find({ name: { $in: regexPatterns } }).select('name').lean();
    const existingSet = new Set(existingBrands.map((b: any) => b.name.toLowerCase()));
    const filtered = names.filter((n: string) => !existingSet.has(n.toLowerCase()));

    // Nếu bị lọc hết hoặc ít hơn 2 tên → gọi lại với yêu cầu bổ sung
    if (filtered.length < 2) {
      const extraPrompt = `Gợi ý ${count} tên thương hiệu khác (KHÔNG được trùng tên: ${names.join(', ')}). Chỉ JSON array, không markdown.

Ví dụ: ["TenMoi1","TenMoi2","TenMoi3","TenMoi4","TenMoi5"]`;
      const extraResponse = await AIService.generateResponse(extraPrompt, undefined, 'gemini-3.1-flash-lite');
      let extraStr = extraResponse.trim();
      if (extraStr.startsWith('```')) {
        extraStr = extraStr.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\`\`\`$/, '');
      }
      const extraParsed = JSON.parse(extraStr);
      const extraNames = Array.isArray(extraParsed) ? extraParsed : [];
      const extraRegex = extraNames.map((n: string) => new RegExp(`^${n}$`, 'i'));
      const extraExisting = await Brand.find({ name: { $in: extraRegex } }).select('name').lean();
      const extraExistingSet = new Set(extraExisting.map((b: any) => b.name.toLowerCase()));
      const extraFiltered = extraNames.filter((n: string) => !extraExistingSet.has(n.toLowerCase()));
      return [...filtered, ...extraFiltered].slice(0, count);
    }

    return filtered.slice(0, count);
  } catch {
    // Fallback: nếu JSON parse fail, trả về empty
    return [];
  }
}

/**
 * Admin Fast Path — Trả lời ngay từ DB cho các câu hỏi đơn giản (đếm, liệt kê)
 * Tránh gọi Gemini chain ~9s cho những truy vấn có thể trả lời bằng DB query.
 * Trả về null nếu không match → fallback qua QueryRouter (Gemini).
 */
async function tryAdminFastPath(message: string): Promise<string | null> {
  const lowerMsg = message.toLowerCase();
  const UserModel = User;
  const VoucherModel = Voucher;

  // ── "có bao nhiêu brand / thương hiệu" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:brand|thương\s+hiệu|hãng)/i.test(lowerMsg)) {
    const brands = await Brand.find().select('name').lean();
    const list = brands.map((b: any, i: number) => `${i + 1}. ${b.name}`).join('\n');
    return `Dạ hiện có ${brands.length} thương hiệu ạ:\n${list}`;
  }

  // ── "kể tên / danh sách sản phẩm" ── (có 90 sp → chỉ hiển thị 30 đầu, có link supplement)
  if (/(?:kể|liệt\s+kê|danh\s+sách|list|đếm)\s+(?:tên\s+)?(?:các\s+)?(?:sản\s+phẩm|product)/i.test(lowerMsg)) {
    const products = await Product.find().select('name').limit(30).lean();
    if (!products.length) return 'Chưa có sản phẩm nào.';
    const totalCount = await Product.countDocuments();
    const list = products.map((p: any, i: number) => `${i + 1}. ${p.name}`).join('\n');
    const suffix = totalCount > 30 ? `\n\n… và ${totalCount - 30} sản phẩm khác.` : '';
    return `Dạ danh sách sản phẩm (${totalCount}):\n${list}${suffix}`;
  }

  // ── "có bao nhiêu sản phẩm / product" ── (cực tolerant: mọi cách viết)
  if (/(?:có\s+|có\s+tất\s+cả\s+|trong\s+(?:shop|db|database|hệ\s+thống)\s+|hiện\s+tại\s+|tổng\s+|tổng\s+cộng\s+)?(?:bao\s+nhi[êểễ]u|mấy|bao\s+nhiu|bao\s+nhiểu)\s*(?:sản\s+phẩm|product|sp\b|sản\s+phẩm\s+trong\s+(?:shop|store)?)/i.test(lowerMsg)) {
    const count = await Product.countDocuments();
    return `Dạ hiện có ${count} sản phẩm ạ.`;
  }

  // ── "có bao nhiêu danh mục / category" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:danh\s+mục|category)/i.test(lowerMsg)) {
    const cats = await Category.find().select('name').lean();
    const list = cats.map((c: any, i: number) => `${i + 1}. ${c.name}`).join('\n');
    return `Dạ hiện có ${cats.length} danh mục ạ:\n${list}`;
  }

  // ── "có bao nhiêu tag" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+tag/i.test(lowerMsg)) {
    const tags = await Tag.find().select('name').lean();
    const list = tags.map((t: any, i: number) => `${i + 1}. ${t.name}`).join('\n');
    return `Dạ hiện có ${tags.length} tag ạ:\n${list}`;
  }

  // ── "có bao nhiêu người dùng / user" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:người\s+dùng|user|tài\s+khoản)/i.test(lowerMsg)) {
    const count = await UserModel.countDocuments();
    return `Dạ hiện có ${count} người dùng ạ.`;
  }

  // ── "có bao nhiêu đơn hàng / order" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:đơn\s+hàng|order)/i.test(lowerMsg)) {
    const count = await Order.countDocuments();
    return `Dạ hiện có ${count} đơn hàng ạ.`;
  }

  // ── "có bao nhiêu voucher / mã giảm giá" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:voucher|mã\s+giảm\s+giá)/i.test(lowerMsg)) {
    const count = await VoucherModel.countDocuments();
    return `Dạ hiện có ${count} mã giảm giá ạ.`;
  }

  // ── "liệt kê / danh sách brand / thương hiệu" ──
  if (/(?:liệt\s+kê|danh\s+sách|list)\s+(?:brand|thương\s+hiệu|hãng)/i.test(lowerMsg)) {
    const brands = await Brand.find().select('name origin').lean();
    if (!brands.length) return 'Chưa có thương hiệu nào.';
    const list = brands.map((b: any, i: number) => `${i + 1}. ${b.name}${b.origin ? ` (${b.origin})` : ''}`).join('\n');
    return `Dạ danh sách thương hiệu:\n${list}`;
  }

  // ── "liệt kê / danh sách category / danh mục" ──
  if (/(?:liệt\s+kê|danh\s+sách|list)\s+(?:danh\s+mục|category)/i.test(lowerMsg)) {
    const cats = await Category.find().select('name').lean();
    if (!cats.length) return 'Chưa có danh mục nào.';
    const list = cats.map((c: any, i: number) => `${i + 1}. ${c.name}`).join('\n');
    return `Dạ danh sách danh mục:\n${list}`;
  }

  // ── "liệt kê / danh sách tag" ──
  if (/(?:liệt\s+kê|danh\s+sách|list)\s+tag/i.test(lowerMsg)) {
    const tags = await Tag.find().select('name').lean();
    if (!tags.length) return 'Chưa có tag nào.';
    const list = tags.map((t: any, i: number) => `${i + 1}. ${t.name}`).join('\n');
    return `Dạ danh sách tag:\n${list}`;
  }

  return null; // không match → fallback qua QueryRouter
}
