import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client } from './r2Client.ts';
import { ImageOptimizer } from './imageOptimizer.ts';

export interface ImgBBUploadResult {
  url: string;
  displayUrl: string;
  thumbUrl?: string;
  deleteUrl?: string;
  originalBytes: number;
  compressedBytes: number;
}

/** Cấu trúc thư mục hợp lệ trên R2 */
const ALLOWED_FOLDERS = ['products', 'brands', 'media', 'banners', 'avatars'] as const;

/**
 * Chuẩn hóa tên thư mục R2. Chỉ cho phép: products, brands, media, banners, avatars + subfolder.
 * Fallback về 'media' nếu folder không hợp lệ.
 */
export function normalizeFolder(folder?: string): string {
  if (!folder) return 'media';
  const clean = folder.trim().toLowerCase().replace(/\/+$/, '');
  const topFolder = clean.split('/')[0];

  if (ALLOWED_FOLDERS.includes(topFolder as any)) {
    return clean;
  }
  return 'media';
}

/**
 * Sanitize slug cho thư mục sản phẩm.
 * Chỉ giữ chữ cái, số, dấu gạch ngang. Lowercase.
 * Fallback về 'product' nếu rỗng sau sanitize.
 */
export function sanitizeProductSlug(name: string): string {
  const slug = name
    .replace(/[^a-zA-Z0-9\u00C0-\u1EF9\-]/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'product';
}

export class R2Uploader {
  /**
   * Upload ảnh thường (brands, media, banners) — nén WebP thông thường
   */
  static async compressAndUpload(
    inputBuffer: Buffer,
    options?: { maxWidth?: number; quality?: number; name?: string; folder?: string }
  ): Promise<ImgBBUploadResult> {
    const bucketName = process.env.R2_BUCKET_NAME || 'lessence-testq9';
    const publicDomain = process.env.R2_PUBLIC_DOMAIN;
    if (!publicDomain?.trim()) {
      throw new Error('Chưa cấu hình R2_PUBLIC_DOMAIN trong môi trường.');
    }

    const maxWidth = options?.maxWidth ?? 1920;
    const quality = options?.quality ?? 90;
    const originalBytes = inputBuffer.length;
    const folder = normalizeFolder(options?.folder);

    const compressed = await ImageOptimizer.optimizeForWeb(inputBuffer, maxWidth, quality);
    const baseName = (options?.name || 'upload')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase() || 'upload';
    const hash = Math.random().toString(36).substring(2, 10);
    const fileName = `${folder}/${hash}-${baseName}.webp`;

    try {
      const client = getS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: fileName,
          Body: compressed,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );

      const finalUrl = `${publicDomain.replace(/\/$/, '')}/${fileName}`;

      return {
        url: finalUrl,
        displayUrl: finalUrl,
        thumbUrl: finalUrl,
        originalBytes,
        compressedBytes: compressed.length
      };
    } catch (error) {
      console.error('[ImageService R2 Upload Error]', error);
      throw new Error(error instanceof Error ? error.message : 'Lỗi khi lưu trữ hình ảnh lên Cloudflare R2.');
    }
  }

  /**
   * Upload ảnh SẢN PHẨM — upscale + sharpen, main + thumbnail
   * Folder tự động: products/{slug}/
   * Tên file có hash (cache-busting) để tránh cache cũ khi replace ảnh:
   *   - {hash}-main.webp     → ảnh chính (1200px, sharpen)
   *   - {hash}-thumb.webp    → thumbnail (400px)
   *   - {hash}-sub-{n}.webp  → ảnh phụ (truyền qua options.subIndex)
   */
  static async uploadProductImage(
    inputBuffer: Buffer,
    options: {
      productSlug: string;     // VD: "chanel-no5"
      /** null = ảnh chính, số = ảnh phụ thứ n */
      subIndex?: number | null;
    }
  ): Promise<ImgBBUploadResult & { thumbUrl: string }> {
    const bucketName = process.env.R2_BUCKET_NAME || 'lessence-testq9';
    const publicDomain = process.env.R2_PUBLIC_DOMAIN;
    if (!publicDomain?.trim()) {
      throw new Error('Chưa cấu hình R2_PUBLIC_DOMAIN trong môi trường.');
    }

    const slug = options.productSlug
      .replace(/[^a-zA-Z0-9\u00C0-\u1EF9\-]/g, '-')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'product';
    const folder = `products/${slug}`;
    const originalBytes = inputBuffer.length;

    // Random hash để cache-busting
    const hash = Math.random().toString(36).substring(2, 10);
    const isSub = typeof options.subIndex === 'number';
    const baseFileName = isSub ? `sub-${options.subIndex}` : 'main';
    const hashedBase = `${hash}-${baseFileName}`;

    // Ảnh chính: upscale + sharpen
    const mainBuffer = await ImageOptimizer.optimizeForProduct(inputBuffer);
    // Thumbnail
    const thumbBuffer = await ImageOptimizer.generateProductThumb(inputBuffer);

    const mainKey = `${folder}/${hashedBase}.webp`;
    const thumbKey = `${folder}/${hash}-thumb.webp`;

    try {
      const client = getS3Client();

      // Upload ảnh chính
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: mainKey,
          Body: mainBuffer,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );

      // Upload thumbnail (chỉ cho ảnh chính, không cần cho ảnh phụ)
      if (!isSub) {
        await client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: thumbKey,
            Body: thumbBuffer,
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable',
          })
        );
      }

      const mainUrl = `${publicDomain.replace(/\/$/, '')}/${mainKey}`;
      const thumbUrl = `${publicDomain.replace(/\/$/, '')}/${thumbKey}`;

      return {
        url: mainUrl,
        displayUrl: mainUrl,
        thumbUrl: isSub ? mainUrl : thumbUrl,
        originalBytes,
        compressedBytes: mainBuffer.length,
      };
    } catch (error) {
      console.error('[ImageService R2 Product Upload Error]', error);
      throw new Error(error instanceof Error ? error.message : 'Lỗi khi lưu trữ ảnh sản phẩm lên Cloudflare R2.');
    }
  }
}