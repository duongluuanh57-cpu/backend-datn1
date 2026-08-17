import type { FastifyRequest, FastifyReply } from 'fastify';
import { BrandService } from '../../services/BrandService.ts';
import { Product } from '../../models/Product.ts';

export class BrandListingController {
  /**
   * GET /api/brands
   * Query params (optional): page, limit, search, origin, sortBy
   * Không có page → trả full list (backward compatible)
   */
  static async getAllBrands(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { page?: string; limit?: string; search?: string; origin?: string; sortBy?: string; status?: string };

      // Backward compatible: không có page thì trả full list
      if (!query.page) {
        const brands = await BrandService.getAllBrands();
        return reply.status(200).send({ success: true, data: brands });
      }

      const result = await BrandService.getPaginatedBrands({
        page: parseInt(query.page, 10),
        limit: query.limit ? parseInt(query.limit, 10) : 25,
        search: query.search,
        origin: query.origin,
        sortBy: query.sortBy,
        status: query.status,
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/brands/origins
   */
  static async getBrandOrigins(req: FastifyRequest, reply: FastifyReply) {
    try {
      const origins = await BrandService.getBrandOrigins();
      return reply.status(200).send({ success: true, data: origins });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/brands/:id
   */
  static async getBrandById(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };

      const brand = await BrandService.getBrandById(id);
      if (!brand) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy thương hiệu này' });
      }

      const productCount = await Product.countDocuments({ brandId: id });

      return reply.status(200).send({
        success: true,
        data: { ...brand.toObject(), productCount },
      });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * POST /api/brands/ai-suggest
   * Sử dụng Gemini AI để tìm xuất xứ và gợi ý slug cho bất kỳ thương hiệu nào
   */
  static async aiSuggestBrand(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { name } = (req.body || {}) as { name?: string };
      if (!name || !name.trim()) {
        return reply.status(400).send({ success: false, message: 'Tên thương hiệu không được để trống' });
      }

      const cleanName = name.trim();
      let origin = '';
      let slug = cleanName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');

      try {
        const { generateTextResponse } = await import('../../services/ai/aiInteractionService.ts');
        const prompt = `Bạn là chuyên gia về thương hiệu nước hoa và mỹ phẩm thế giới. 
Hãy xác định chính xác xuất xứ quốc gia (origin) và slug của thương hiệu: "${cleanName}".
Ví dụ:
- "Verites" -> origin: "Việt Nam", slug: "verites"
- "Chanel" -> origin: "Pháp", slug: "chanel"
- "Creed" -> origin: "Pháp", slug: "creed"
- "Jo Malone" -> origin: "Anh", slug: "jo-malone"
- "Dior" -> origin: "Pháp", slug: "dior"
- "Tom Ford" -> origin: "Mỹ", slug: "tom-ford"
- "Gucci" -> origin: "Ý", slug: "gucci"
- "Le Labo" -> origin: "Mỹ", slug: "le-labo"

Trả về DUY NHẤT một JSON object:
{"origin": "Tên quốc gia bằng tiếng Việt (VD: Pháp, Ý, Mỹ, Anh, Đức, Việt Nam, Nhật Bản, Hàn Quốc, Thụy Điển...)", "slug": "slug-chuan"}`;

        const aiResponse = await generateTextResponse(prompt);
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.origin) origin = parsed.origin;
          if (parsed.slug) slug = parsed.slug;
        }
      } catch (aiErr) {
        console.warn('[AI Brand Suggest] Fallback:', aiErr);
      }

      return reply.status(200).send({
        success: true,
        data: { origin, slug, name: cleanName },
      });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }
}