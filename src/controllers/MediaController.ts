import type { FastifyRequest, FastifyReply } from 'fastify';
import { ImageService } from '../services/ImageService.ts';
import { ProductImage } from '../models/ProductImage.ts';
import { Product } from '../models/Product.ts';
import mongoose from 'mongoose';

export class MediaController {
  static async uploadImage(req: FastifyRequest, reply: FastifyReply) {
    try {
      const file = await req.file();
      if (!file) {
        return reply.status(400).send({ success: false, message: 'Không tìm thấy file ảnh' });
      }

      const buffer = await file.toBuffer();
      const productSlug = (req.query as any).productSlug || 'product';
      const subIndex = (req.query as any).subIndex !== undefined ? parseInt((req.query as any).subIndex, 10) : null;

      const result = await ImageService.uploadProductImage(buffer, {
        productSlug: productSlug,
        subIndex: subIndex,
      });

      return reply.status(200).send({ success: true, data: { url: result.url, thumbUrl: result.thumbUrl } });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi upload ảnh' });
    }
  }

  static async deleteImage(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { url, productId } = req.body as { url: string; productId?: string };
      if (!url) {
        return reply.status(400).send({ success: false, message: 'Thiếu URL ảnh' });
      }

      // Xóa khỏi R2
      await ImageService.deleteFromR2(url).catch(() => {});

      // Xóa khỏi ProductImage collection
      await ProductImage.deleteOne({ url });

      // Clear Product.image nếu URL khớp
      if (productId) {
        await Product.updateOne(
          { _id: productId, image: url },
          { $unset: { image: '' } }
        );
      }

      return reply.status(200).send({ success: true, message: 'Đã xóa ảnh' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi xóa ảnh' });
    }
  }
}
