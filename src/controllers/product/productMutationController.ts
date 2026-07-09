import type { FastifyRequest, FastifyReply } from 'fastify';
import { ProductService } from '../../services/ProductService.ts';
import { Product } from '../../models/Product.ts';

export class ProductMutationController {
  /**
   * PATCH /api/products/:id
   * Kèm auto-switch: nếu sản phẩm đủ thông tin → isSupplemented = true, status = 'active'
   */
  static async updateProduct(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const productData = req.body as any;

      const product = await ProductService.updateProduct(id, productData);
      if (!product) return reply.status(404).send({ success: false, message: 'Không tìm thấy sản phẩm để cập nhật' });

      // ── Auto-switch: kiểm tra đủ thông tin → isSupplemented + status ──
      const updated = await Product.findById(id).populate('variants').lean();
      if (updated) {
        const isFull = !!(updated.name && updated.description && updated.description.length > 50 && updated.brandId && updated.image && updated.variants && updated.variants.length > 0 && updated.categories && updated.categories.length >= 2);
        if (isFull && (!updated.isSupplemented || updated.status !== 'active')) {
          await Product.updateOne({ _id: id }, { $set: { isSupplemented: true, status: 'active' } });
          return reply.status(200).send({
            success: true,
            data: { ...updated, isSupplemented: true, status: 'active' },
            autoActivated: true,
            message: 'Sản phẩm đã được bổ sung đầy đủ và tự động kích hoạt!',
          });
        }
      }

      return reply.status(200).send({ success: true, data: product });
    } catch (error: any) {
      const isValidationError = error.message?.includes('không tồn tại') ||
                                error.message?.includes('bắt buộc') ||
                                error.name === 'ValidationError';
      return reply.status(isValidationError ? 400 : 500).send({ success: false, message: error.message });
    }
  }

  /**
   * DELETE /api/products/:id
   */
  static async deleteProduct(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };

      const success = await ProductService.deleteProduct(id);
      if (!success) return reply.status(404).send({ success: false, message: 'Không tìm thấy sản phẩm để xóa' });
      return reply.status(200).send({ success: true, message: 'Đã xóa sản phẩm thành công' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * POST /api/products/bulk-delete
   */
  static async bulkDeleteProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { ids } = req.body as { ids: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ success: false, message: 'Danh sách ID không hợp lệ' });
      }

      const success = await ProductService.bulkDeleteProducts(ids);
      if (!success) return reply.status(404).send({ success: false, message: 'Không thể xóa các sản phẩm' });

      return reply.status(200).send({ success: true, message: `Đã xóa thành công ${ids.length} sản phẩm` });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * POST /api/products
   */
  static async createProduct(req: FastifyRequest, reply: FastifyReply) {
    try {
      const productData = req.body as any;

      const product = await ProductService.createProduct(productData);

      return reply.status(201).send({
        success: true,
        data: product,
      });
    } catch (error: any) {
      console.error('❌ [createProduct] Error:', error.name, error.message);
      // Lỗi validation (brand/taxonomy không tồn tại) → 400
      const isValidationError = error.message?.includes('không tồn tại') ||
                                error.message?.includes('bắt buộc') ||
                                error.name === 'ValidationError';
      return reply.status(isValidationError ? 400 : 500).send({
        success: false,
        message: error.message,
      });
    }
  }
}