import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getS3Client } from './r2Client.ts';
import { Product } from '../../models/Product.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { redis } from '../../config/redis.ts';

export class R2Deleter {
  /**
   * Xóa ảnh khỏi Cloudflare R2 dựa trên URL công khai
   */
  static async deleteFromR2(url: string): Promise<boolean> {
    if (!url || typeof url !== 'string' || !url.trim()) return false;

    const publicDomain = process.env.R2_PUBLIC_DOMAIN;
    if (!publicDomain) {
      console.warn('[ImageService] R2_PUBLIC_DOMAIN chưa cấu hình, không thể tự động xóa ảnh.');
      return false;
    }

    const bucketName = process.env.R2_BUCKET_NAME || 'lessence-media';

    try {
      // Lấy phần đuôi (Key) từ URL
      let key = '';
      if (url.includes(publicDomain)) {
        key = url.split(publicDomain).pop()?.replace(/^\//, '') || '';
      } else if (url.includes('.r2.dev')) {
        const urlObj = new URL(url);
        key = urlObj.pathname.replace(/^\//, '');
      }

      if (!key) {
        console.log(`[ImageService] URL không thuộc Cloudflare R2, bỏ qua xóa: ${url}`);
        return false;
      }

      console.log(`[ImageService] Đang xóa file trên Cloudflare R2: Bucket=${bucketName}, Key=${key}`);

      const client = getS3Client();
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );

      console.log(`[ImageService] Đã xóa file trên R2 thành công: ${key}`);
      return true;
    } catch (error) {
      console.error('[ImageService R2 Delete Error]', error);
      return false;
    }
  }

  /**
   * Trích xuất folder prefix từ URL hình ảnh R2
   */
  static getFolderFromUrl(url: string): string | null {
    if (!url || typeof url !== 'string' || !url.trim()) return null;

    const publicDomain = process.env.R2_PUBLIC_DOMAIN;
    if (!publicDomain) return null;

    try {
      let key = '';
      if (url.includes(publicDomain)) {
        key = url.split(publicDomain).pop()?.replace(/^\//, '') || '';
      } else if (url.includes('.r2.dev')) {
        const urlObj = new URL(url);
        key = urlObj.pathname.replace(/^\//, '');
      }

      if (!key) return null;

      const parts = key.split('/');
      if (parts.length > 1) {
        return parts.slice(0, -1).join('/');
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Xóa toàn bộ thư mục (prefix) trên Cloudflare R2
   */
  static async deleteFolderFromR2(folderPath: string): Promise<boolean> {
    if (!folderPath || typeof folderPath !== 'string' || !folderPath.trim()) return false;

    const cleanFolder = folderPath.trim().replace(/^\/+|\/+$/g, '');
    const parts = cleanFolder.split('/');

    // Safety check: must have at least 2 segments and the parent segment must be one of the approved root prefixes
    const allowedParents = ['products', 'brands', 'image', 'avatars'];
    if (parts.length < 2 || !allowedParents.includes(parts[0]) || !parts[1]) {
      console.warn(`[ImageService] Bỏ qua xóa thư mục không an toàn hoặc không hợp lệ: ${folderPath}`);
      return false;
    }

    const bucketName = process.env.R2_BUCKET_NAME || 'lessence-media';
    const prefix = `${cleanFolder}/`;

    try {
      console.log(`[ImageService] Đang xóa toàn bộ thư mục trên R2: Bucket=${bucketName}, Prefix=${prefix}`);
      const client = getS3Client();

      let isTruncated = true;
      let continuationToken: string | undefined = undefined;
      let totalDeleted = 0;

      while (isTruncated) {
        const listCommand: ListObjectsV2Command = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const listResponse = (await client.send(listCommand)) as any;
        const objects = listResponse.Contents || [];

        if (objects.length > 0) {
          const keysToDelete = objects
            .map((obj: any) => obj.Key)
            .filter((key: any): key is string => !!key);

          if (keysToDelete.length > 0) {
            const deleteCommand = new DeleteObjectsCommand({
              Bucket: bucketName,
              Delete: {
                Objects: keysToDelete.map((key: string) => ({ Key: key })),
                Quiet: true,
              },
            });

            await client.send(deleteCommand);
            totalDeleted += keysToDelete.length;
          }
        }

        isTruncated = !!listResponse.IsTruncated;
        continuationToken = listResponse.NextContinuationToken;
      }

      console.log(`[ImageService] Đã xóa thư mục trên R2 thành công: ${prefix} (${totalDeleted} files)`);
      return true;
    } catch (error) {
      console.error('[ImageService R2 Delete Folder Error]', error);
      return false;
    }
  }

  /**
   * Kiểm tra xem file có tồn tại trên R2 không (dùng HeadObject)
   */
  static async validateImageUrl(url: string): Promise<boolean> {
    if (!url || typeof url !== 'string' || !url.trim()) return false;

    const publicDomain = process.env.R2_PUBLIC_DOMAIN;
    if (!publicDomain) return false;

    const bucketName = process.env.R2_BUCKET_NAME || 'lessence-media';

    try {
      // Lấy key từ URL
      let key = '';
      if (url.includes(publicDomain)) {
        key = url.split(publicDomain).pop()?.replace(/^\//, '') || '';
      } else if (url.includes('.r2.dev')) {
        const urlObj = new URL(url);
        key = urlObj.pathname.replace(/^\//, '');
      }

      if (!key) return false;

      const client = getS3Client();
      await client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Lấy key từ URL (helper)
   */
  static getKeyFromUrl(url: string): string {
    if (!url || typeof url !== 'string' || !url.trim()) return '';

    const publicDomain = process.env.R2_PUBLIC_DOMAIN;
    if (!publicDomain) return '';

    if (url.includes(publicDomain)) {
      return url.split(publicDomain).pop()?.replace(/^\//, '') || '';
    } else if (url.includes('.r2.dev')) {
      try {
        const urlObj = new URL(url);
        return urlObj.pathname.replace(/^\//, '');
      } catch {
        return '';
      }
    }
    return '';
  }

  /**
   * Cleanup ảnh không tồn tại trên R2 - quét toàn bộ sản phẩm
   * Trả về số lượng ảnh đã xóa khỏi DB
   */
  static async cleanupInvalidProductImages(): Promise<{ removed: number; fixedProducts: number }> {
    const bucketName = process.env.R2_BUCKET_NAME || 'lessence-media';
    let removed = 0;
    let fixedProducts = 0;

    try {
      // Lấy tất cả sản phẩm
      const products = await Product.find({}).select('_id image').lean();

      for (const product of products) {
        const productId = product._id;
        const mainImage = product.image;
        let hasChanges = false;

        // Check ảnh chính (Product.image)
        if (mainImage) {
          const isValid = await this.validateImageUrl(mainImage);
          if (!isValid) {
            await Product.updateOne({ _id: productId }, { $unset: { image: '' } });
            hasChanges = true;
            removed++;
          }
        }

        // Check ảnh phụ (ProductImage)
        const images = await ProductImage.find({ productId }).select('url').lean();
        for (const img of images) {
          const isValid = await this.validateImageUrl(img.url);
          if (!isValid) {
            await ProductImage.deleteOne({ _id: img._id });
            removed++;
            hasChanges = true;
          }
        }

        if (hasChanges) {
          fixedProducts++;
          // Clear cache cho sản phẩm này
          try {
            await redis.del(`products:${productId}`);
          } catch (_) {}
        }
      }

      // Clear cache product lists
      const cacheKeys = [
        `products:new:tag`,
        `products:new:tag:v3`,
        `products:limited:tag:v2`,
        `products:sale:tag`,
        `products:trending:tag`,
        `products:trending:tag:v3`,
      ];
      await Promise.all(cacheKeys.map(k => redis.del(k).catch(() => {})));

      console.log(`[ImageService] Cleanup completed: ${removed} invalid image URLs removed, ${fixedProducts} products fixed`);
      return { removed, fixedProducts };
    } catch (error) {
      console.error('[ImageService Cleanup Error]', error);
      return { removed, fixedProducts };
    }
  }
}