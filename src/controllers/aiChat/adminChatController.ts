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
    const tenantId = (req as any).user?.tenantId || 'default';
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
      /^tạo\s+cho\s+(?:tôi|t|mình|tao|tau|bạn|anh|chị|em|sếp|admin|quý\s+khách)\s+(?:\d+\s+)?(?:một\s+)?sản\s+phẩm/i.test(lowerMsg) ||
      /tạo\s+(?:\d+\s+)?(?:một\s+)?sản\s+phẩm\s+cho\s+(?:tôi|t|mình|tao|tau|bạn|anh|chị|em|sếp|admin|quý\s+khách)/i.test(lowerMsg) ||
      /^tạo\s+cho\s+\d+\s+sản\s+phẩm/i.test(lowerMsg);
    if (justCreateProduct) {
      return reply.send({ type: 'create_choice', message: 'Dạ sếp muốn tạo sản phẩm theo brand có sẵn hay tạo brand mới luôn ạ?' });
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
        let brandName = match[1].trim();
        brandName = brandName.charAt(0).toUpperCase() + brandName.slice(1);

        // Blacklist: Nếu brandName là đại từ nhân xưng → redirect về create_choice
        const pronouns = ['t','tôi','mình','tao','tau','bạn','cậu','anh','chị','em','sếp','admin','mày','quý khách','khách'];
        if (pronouns.includes(brandName.toLowerCase()) || /^(t|tôi|mình|tao|tau)\s+\d/i.test(brandName)) {
          return reply.send({ type: 'create_choice', message: 'Dạ sếp muốn tạo sản phẩm theo brand có sẵn hay tạo brand mới luôn ạ?' });
        }
        // Blacklist: Nếu brandName có dạng "1 sản phẩm", "2 sản phẩm" → redirect về create_choice
        if (/^\d+\s+sản\s+phẩm/i.test(brandName)) {
          return reply.send({ type: 'create_choice', message: 'Dạ sếp muốn tạo sản phẩm theo brand có sẵn hay tạo brand mới luôn ạ?' });
        }

        // Trả về special response để frontend mở interview inline
        return reply.send({
          type: 'interview_trigger',
          brandName,
          message: `Tôi sẽ giúp bạn tạo sản phẩm cho hãng ${brandName}. Hãy làm theo các bước sau:`,
        });
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

    // ── Kiểm tra intent "tạo thương hiệu / brand" ──
    const brandIntent = /tạo\s+(?:thương\s+hiệu|brand|hãng)/i.exec(lowerMsg);
    if (brandIntent) {
      const nameMatch = /(?:thương\s+hiệu|brand|hãng)\s+(.+)/i.exec(message);
      const brandName = nameMatch ? nameMatch[1].trim() : 'Thương hiệu mới';
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
          message: `Tôi đã tạo sẵn thương hiệu:\n• Tên: ${brandName}\n• Xuất xứ: ${data.origin || '—'}\n• Mô tả: ${(data.description || '').slice(0, 100)}...\n\nBạn muốn tạo luôn không?`,
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
    const fastResult = await tryAdminFastPath(message, tenantId);
    if (fastResult) return reply.send({ reply: fastResult });

    // ── Query Routing (cho các câu hỏi thông thường) ──
    const result = await QueryRouterService.route({
      message,
      messages: history,
      tenantId,
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
    const tenantId = (req as any).user?.tenantId || 'default';

    switch (entity) {
      case 'user': {
        const fakeReq = { body: { userData: data, tenantId } } as FastifyRequest;
        const result = await createUserFromAI(fakeReq, reply);
        const parsed = parseResult(result);
        return reply.send({
          type: 'entity_created',
          entity: 'user',
          message: `Đã tạo người dùng **${parsed.username || data.username}** thành công!`,
        });
      }
      case 'brand': {
        // Create brand directly since there's no createBrandFromAI endpoint
        const newBrand = await Brand.create({
          name: data.name,
          slug: data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          origin: data.origin || '',
          description: data.description || '',
          status: 'active',
          tenantId,
        });
        return reply.send({
          type: 'entity_created',
          entity: 'brand',
          message: `Đã tạo thương hiệu **${newBrand.name}** thành công!`,
        });
      }
      case 'category': {
        const fakeReq = { body: { categoryData: data, tenantId } } as FastifyRequest;
        const result = await createCategoryFromAI(fakeReq, reply);
        const parsed = parseResult(result);
        return reply.send({
          type: 'entity_created',
          entity: 'category',
          message: `Đã tạo danh mục **${parsed.name || data.name}** thành công!`,
        });
      }
      case 'tag': {
        const fakeReq = { body: { tagData: data, tenantId } } as FastifyRequest;
        const result = await createTagFromAI(fakeReq, reply);
        const parsed = parseResult(result);
        return reply.send({
          type: 'entity_created',
          entity: 'tag',
          message: `Đã tạo tag **${parsed.name || data.name}** thành công!`,
        });
      }
      case 'voucher': {
        const fakeReq = { body: { voucherData: data, tenantId } } as FastifyRequest;
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
 * Admin Fast Path — Trả lời ngay từ DB cho các câu hỏi đơn giản (đếm, liệt kê)
 * Tránh gọi Gemini chain ~9s cho những truy vấn có thể trả lời bằng DB query.
 * Trả về null nếu không match → fallback qua QueryRouter (Gemini).
 */
async function tryAdminFastPath(message: string, tenantId: string): Promise<string | null> {
  const lowerMsg = message.toLowerCase();
  const UserModel = User;
  const VoucherModel = Voucher;

  // ── "có bao nhiêu brand / thương hiệu" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:brand|thương\s+hiệu|hãng)/i.test(lowerMsg)) {
    const brands = await Brand.find({ tenantId }).select('name').lean();
    const list = brands.map((b: any, i: number) => `${i + 1}. ${b.name}`).join('\n');
    return `Dạ hiện có ${brands.length} thương hiệu ạ:\n${list}`;
  }

  // ── "kể tên / danh sách sản phẩm" ── (có 90 sp → chỉ hiển thị 30 đầu, có link supplement)
  if (/(?:kể|liệt\s+kê|danh\s+sách|list|đếm)\s+(?:tên\s+)?(?:các\s+)?(?:sản\s+phẩm|product)/i.test(lowerMsg)) {
    const products = await Product.find({ tenantId }).select('name').limit(30).lean();
    if (!products.length) return 'Chưa có sản phẩm nào.';
    const totalCount = await Product.countDocuments({ tenantId });
    const list = products.map((p: any, i: number) => `${i + 1}. ${p.name}`).join('\n');
    const suffix = totalCount > 30 ? `\n\n… và ${totalCount - 30} sản phẩm khác.` : '';
    return `Dạ danh sách sản phẩm (${totalCount}):\n${list}${suffix}`;
  }

  // ── "có bao nhiêu sản phẩm / product" ── (cực tolerant: mọi cách viết)
  if (/(?:có\s+|có\s+tất\s+cả\s+|trong\s+(?:shop|db|database|hệ\s+thống)\s+|hiện\s+tại\s+|tổng\s+|tổng\s+cộng\s+)?(?:bao\s+nhi[êểễ]u|mấy|bao\s+nhiu|bao\s+nhiểu)\s*(?:sản\s+phẩm|product|sp\b|sản\s+phẩm\s+trong\s+(?:shop|store)?)/i.test(lowerMsg)) {
    const count = await Product.countDocuments({ tenantId });
    return `Dạ hiện có ${count} sản phẩm ạ.`;
  }

  // ── "có bao nhiêu danh mục / category" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:danh\s+mục|category)/i.test(lowerMsg)) {
    const cats = await Category.find({ tenantId }).select('name').lean();
    const list = cats.map((c: any, i: number) => `${i + 1}. ${c.name}`).join('\n');
    return `Dạ hiện có ${cats.length} danh mục ạ:\n${list}`;
  }

  // ── "có bao nhiêu tag" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+tag/i.test(lowerMsg)) {
    const tags = await Tag.find({ tenantId }).select('name').lean();
    const list = tags.map((t: any, i: number) => `${i + 1}. ${t.name}`).join('\n');
    return `Dạ hiện có ${tags.length} tag ạ:\n${list}`;
  }

  // ── "có bao nhiêu người dùng / user" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:người\s+dùng|user|tài\s+khoản)/i.test(lowerMsg)) {
    const count = await UserModel.countDocuments({ tenantId });
    return `Dạ hiện có ${count} người dùng ạ.`;
  }

  // ── "có bao nhiêu đơn hàng / order" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:đơn\s+hàng|order)/i.test(lowerMsg)) {
    const count = await Order.countDocuments({ tenantId });
    return `Dạ hiện có ${count} đơn hàng ạ.`;
  }

  // ── "có bao nhiêu voucher / mã giảm giá" ──
  if (/(?:có\s+)?(?:bao\s+nhi[êểễ]u|mấy)\s+(?:voucher|mã\s+giảm\s+giá)/i.test(lowerMsg)) {
    const count = await VoucherModel.countDocuments({ tenantId });
    return `Dạ hiện có ${count} mã giảm giá ạ.`;
  }

  // ── "liệt kê / danh sách brand / thương hiệu" ──
  if (/(?:liệt\s+kê|danh\s+sách|list)\s+(?:brand|thương\s+hiệu|hãng)/i.test(lowerMsg)) {
    const brands = await Brand.find({ tenantId }).select('name origin').lean();
    if (!brands.length) return 'Chưa có thương hiệu nào.';
    const list = brands.map((b: any, i: number) => `${i + 1}. ${b.name}${b.origin ? ` (${b.origin})` : ''}`).join('\n');
    return `Dạ danh sách thương hiệu:\n${list}`;
  }

  // ── "liệt kê / danh sách category / danh mục" ──
  if (/(?:liệt\s+kê|danh\s+sách|list)\s+(?:danh\s+mục|category)/i.test(lowerMsg)) {
    const cats = await Category.find({ tenantId }).select('name').lean();
    if (!cats.length) return 'Chưa có danh mục nào.';
    const list = cats.map((c: any, i: number) => `${i + 1}. ${c.name}`).join('\n');
    return `Dạ danh sách danh mục:\n${list}`;
  }

  // ── "liệt kê / danh sách tag" ──
  if (/(?:liệt\s+kê|danh\s+sách|list)\s+tag/i.test(lowerMsg)) {
    const tags = await Tag.find({ tenantId }).select('name').lean();
    if (!tags.length) return 'Chưa có tag nào.';
    const list = tags.map((t: any, i: number) => `${i + 1}. ${t.name}`).join('\n');
    return `Dạ danh sách tag:\n${list}`;
  }

  return null; // không match → fallback qua QueryRouter
}
