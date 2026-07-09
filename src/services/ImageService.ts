/**
 * Barrel file — re-exports all image sub-services for backward compatibility.
 */
export { ImageOptimizer } from './image/imageOptimizer.ts';
export { R2Uploader, type ImgBBUploadResult } from './image/r2Uploader.ts';
export { R2Deleter } from './image/r2Deleter.ts';

import { ImageOptimizer } from './image/imageOptimizer.ts';
import { R2Uploader } from './image/r2Uploader.ts';
import { R2Deleter } from './image/r2Deleter.ts';

export class ImageService {
  // Optimization
  static optimizeForWeb = ImageOptimizer.optimizeForWeb;
  static optimizeForProduct = ImageOptimizer.optimizeForProduct;
  static generateProductThumb = ImageOptimizer.generateProductThumb;
  static generateThumbnail = ImageOptimizer.generateThumbnail;
  static getMetadata = ImageOptimizer.getMetadata;

  // Upload
  static compressAndUpload = R2Uploader.compressAndUpload;
  static uploadProductImage = R2Uploader.uploadProductImage;

  // Delete
  static deleteFromR2 = R2Deleter.deleteFromR2;
  static getFolderFromUrl = R2Deleter.getFolderFromUrl;
  static deleteFolderFromR2 = R2Deleter.deleteFolderFromR2;

  // Validation & Cleanup
  static validateImageUrl = R2Deleter.validateImageUrl;
  static getKeyFromUrl = R2Deleter.getKeyFromUrl;
  static cleanupInvalidProductImages = R2Deleter.cleanupInvalidProductImages;
}