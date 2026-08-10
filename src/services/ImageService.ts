/**
 * Barrel file — re-exports all image sub-services for backward compatibility.
 */
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

  // Helpers
  static getKeyFromUrl = R2Deleter.getKeyFromUrl;
}