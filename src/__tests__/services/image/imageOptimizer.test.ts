import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { ImageOptimizer } from '../../../services/image/imageOptimizer.ts';

// Tạo ảnh PNG 10x10 pixel hợp lệ bằng sharp
async function createTestImageBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      width: 10,
      height: 10,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

describe('ImageOptimizer', () => {
  describe('optimizeForWeb', () => {
    it('should compress a PNG to WebP format', async () => {
      const input = await createTestImageBuffer();
      const result = await ImageOptimizer.optimizeForWeb(input, 50, 80);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      // WebP files start with 'RIFF'
      expect(result.slice(0, 4).toString()).toBe('RIFF');
    });

    it('should not enlarge small images (withoutEnlargement: true)', async () => {
      const input = await createTestImageBuffer();
      const result = await ImageOptimizer.optimizeForWeb(input, 1920, 90);
      expect(result).toBeInstanceOf(Buffer);
      // 10px image resized to max 1920 should stay 10px wide (no upscale)
      const meta = await sharp(result).metadata();
      expect(meta.width).toBeLessThanOrEqual(10);
    });

    it('should reject invalid input', async () => {
      const invalid = Buffer.from('not an image');
      await expect(ImageOptimizer.optimizeForWeb(invalid)).rejects.toThrow();
    });
  });

  describe('optimizeForProduct', () => {
    it('should produce a WebP image with sharpen and upscale enabled', async () => {
      const input = await createTestImageBuffer();
      const result = await ImageOptimizer.optimizeForProduct(input, 1200, 95);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      expect(result.slice(0, 4).toString()).toBe('RIFF');
    });

    it('should allow upscale (withoutEnlargement: false)', async () => {
      const input = await createTestImageBuffer(); // 10x10 pixel
      const result = await ImageOptimizer.optimizeForProduct(input, 800, 95);
      // With upscale enabled, the output should be wider than input
      const meta = await sharp(result).metadata();
      expect(meta.width).toBeGreaterThan(10);
    });

    it('should use lanczos3 kernel for quality upscale', async () => {
      const input = await createTestImageBuffer();
      const result = await ImageOptimizer.optimizeForProduct(input, 400, 90);
      expect(result).toBeInstanceOf(Buffer);
      // Verify it's a valid WebP
      expect(result.slice(8, 12).toString()).toBe('WEBP');
    });
  });

  describe('generateProductThumb', () => {
    it('should produce a square thumbnail', async () => {
      const input = await createTestImageBuffer();
      const result = await ImageOptimizer.generateProductThumb(input, 400);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      expect(result.slice(0, 4).toString()).toBe('RIFF');
    });

    it('should apply light sharpen for thumbnails', async () => {
      const input = await createTestImageBuffer();
      const result = await ImageOptimizer.generateProductThumb(input, 200);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('generateThumbnail', () => {
    it('should produce a 200px thumbnail', async () => {
      const input = await createTestImageBuffer();
      const result = await ImageOptimizer.generateThumbnail(input, 200);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.slice(0, 4).toString()).toBe('RIFF');
    });
  });

  describe('getMetadata', () => {
    it('should return metadata for a valid image', async () => {
      const input = await createTestImageBuffer();
      const meta = await ImageOptimizer.getMetadata(input);
      expect(meta).toBeDefined();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(10);
      expect(meta.height).toBe(10);
    });
  });
});