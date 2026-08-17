import { describe, it, expect } from 'vitest';
import { normalizeFolder, sanitizeProductSlug } from '../../../services/image/r2Uploader.ts';

describe('normalizeFolder', () => {
  it('should return "media" for empty/undefined', () => {
    expect(normalizeFolder()).toBe('media');
    expect(normalizeFolder(undefined)).toBe('media');
  });

  it('should return "products" for products folder', () => {
    expect(normalizeFolder('products')).toBe('products');
  });

  it('should support products subfolder', () => {
    expect(normalizeFolder('products/chanel-no5')).toBe('products/chanel-no5');
  });

  it('should return "brands" for brands folder', () => {
    expect(normalizeFolder('brands')).toBe('brands');
  });

  it('should return "media" for media folder', () => {
    expect(normalizeFolder('media')).toBe('media');
  });

  it('should support media/banners subfolder', () => {
    expect(normalizeFolder('media/banners')).toBe('media/banners');
  });

  it('should return "banners" for banners folder', () => {
    expect(normalizeFolder('banners')).toBe('banners');
  });

  it('should fallback to "media" for invalid folders', () => {
    expect(normalizeFolder('custom-folder')).toBe('media');
    expect(normalizeFolder('image')).toBe('media');
    expect(normalizeFolder('random')).toBe('media');
  });

  it('should trim trailing slashes', () => {
    expect(normalizeFolder('products/')).toBe('products');
    expect(normalizeFolder('brands/')).toBe('brands');
  });

  it('should be case insensitive', () => {
    expect(normalizeFolder('PRODUCTS')).toBe('products');
    expect(normalizeFolder('Brands')).toBe('brands');
    expect(normalizeFolder('MEDIA')).toBe('media');
  });
});

describe('sanitizeProductSlug', () => {
  it('should lowercase and keep alphanumeric', () => {
    expect(sanitizeProductSlug('Chanel No5')).toBe('chanel-no5');
  });

  it('should remove special characters', () => {
    expect(sanitizeProductSlug('Chanel No.5 Édition!')).toBe('chanel-no-5-édition');
  });

  it('should keep Vietnamese characters', () => {
    expect(sanitizeProductSlug('Nước Hoa')).toBe('nước-hoa');
  });

  it('should collapse multiple dashes', () => {
    expect(sanitizeProductSlug('test---slug')).toBe('test-slug');
  });

  it('should trim leading/trailing dashes', () => {
    expect(sanitizeProductSlug('-test-slug-')).toBe('test-slug');
  });

  it('should fallback to "product" if empty after sanitize', () => {
    expect(sanitizeProductSlug('!!!')).toBe('product');
    expect(sanitizeProductSlug('')).toBe('product');
    expect(sanitizeProductSlug('---')).toBe('product');
  });

  it('should handle mixed cases and unicode', () => {
    expect(sanitizeProductSlug('Dior Sauvage EDP')).toBe('dior-sauvage-edp');
  });
});