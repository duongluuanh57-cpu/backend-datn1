import sharp from 'sharp';

export class ImageOptimizer {
  /**
   * Tối ưu hóa ảnh cho Web (Chuyển sang WebP, nén và resize)
   */
  static async optimizeForWeb(
    inputBuffer: Buffer,
    maxWidth: number = 1920,
    quality: number = 90
  ): Promise<Buffer> {
    try {
      return await sharp(inputBuffer)
        .resize({
          width: maxWidth,
          withoutEnlargement: true,
          fit: 'inside'
        })
        .webp({ quality }) // WebP giúp giảm ~50-80% dung lượng so với JPG/PNG
        .toBuffer();
    } catch (error) {
      console.error('[ImageService Optimize Error]', error);
      throw new Error('Không thể tối ưu hóa hình ảnh này.');
    }
  }

  /**
   * Tối ưu ảnh SẢN PHẨM — cho phép upscale + sharpen để hiển thị rõ nét trên web
   * @param inputBuffer - Ảnh gốc
   * @param maxWidth - Kích thước tối đa (mặc định 1200px)
   * @param quality - Chất lượng WebP (mặc định 95)
   */
  static async optimizeForProduct(
    inputBuffer: Buffer,
    width: number = 1080,
    height: number = 1080,
    quality: number = 95
  ): Promise<Buffer> {
    try {
      return await sharp(inputBuffer)
        .resize(width, height, {
          fit: 'cover',
          kernel: 'lanczos3',
        })
        .sharpen({
          sigma: 0.8,
          m1: 0.5,
          m2: 0.5,
        })
        .webp({ quality })
        .toBuffer();
    } catch (error) {
      console.error('[ImageService Product Optimize Error]', error);
      throw new Error('Không thể tối ưu hóa ảnh sản phẩm.');
    }
  }

  /**
   * Tạo ảnh Thumbnail cho sản phẩm (card/list view) — nhẹ, sắc nét
   */
  static async generateProductThumb(inputBuffer: Buffer, size: number = 400): Promise<Buffer> {
    try {
      return await sharp(inputBuffer)
        .resize(size, size, {
          fit: 'cover',
          kernel: 'lanczos3',
        })
        .sharpen({ sigma: 0.5, m1: 0.3, m2: 0.3 })
        .webp({ quality: 85 })
        .toBuffer();
    } catch (error) {
      console.error('[ImageService Product Thumb Error]', error);
      throw new Error('Không thể tạo ảnh thumbnail sản phẩm.');
    }
  }

  /**
   * Tạo Thumbnail nhanh (dùng chung)
   */
  static async generateThumbnail(inputBuffer: Buffer, size: number = 200): Promise<Buffer> {
    try {
      return await sharp(inputBuffer)
        .resize(size, size, {
          fit: 'cover'
        })
        .webp({ quality: 70 })
        .toBuffer();
    } catch (error) {
      console.error('[ImageService Thumbnail Error]', error);
      throw new Error('Không thể tạo ảnh thumbnail.');
    }
  }

  /**
   * Lấy thông tin Metadata của ảnh
   */
  static async getMetadata(inputBuffer: Buffer) {
    try {
      return await sharp(inputBuffer).metadata();
    } catch (error) {
      console.error('[ImageService Metadata Error]', error);
      throw new Error('Không thể đọc thông tin hình ảnh.');
    }
  }
}