/**
 * ProductService — Barrel file (re-export từ các module nhỏ hơn)
 *
 * File này được giữ lại để backward compatibility.
 * Code thực tế đã được tách vào thư mục `services/product/`:
 *   - productHelpers.ts           → slugify, parseSizes, findTaxonomyOnly, resolveCategoryNames
 *   - productFormatterService.ts  → formatMultipleProducts
 *   - productQueryService.ts      → ProductQueryService (getNewProducts, getLimitedProducts, getTrendingProducts, getSaleProducts, getAllProducts, getProductById)
 *   - productMutationService.ts   → ProductMutationService (createProduct, updateProduct, deleteProduct, bulkDeleteProducts)
 */
// Re-import cho backward-compatible class
import { ProductQueryService as _ProductQueryService } from './product/productQueryService.ts';
import { ProductMutationService as _ProductMutationService } from './product/productMutationService.ts';

// ============================================================
// Backward-compatible ProductService class
// Giữ nguyên tên class + method signatures để không break imports
// ============================================================
export class ProductService {
  private static CACHE_TTL = 300;

  // --- Query methods ---
  static async getProductIdsByTagSlugs(slugs: string[]) {
    return _ProductQueryService.getProductIdsByTagSlugs(slugs);
  }
  static async getNewProducts() {
    return _ProductQueryService.getNewProducts();
  }
  static async getLimitedProducts() {
    return _ProductQueryService.getLimitedProducts();
  }
  static async getTrendingProducts() {
    return _ProductQueryService.getTrendingProducts();
  }
  static async getSaleProducts() {
    return _ProductQueryService.getSaleProducts();
  }
  static async getPublicProducts(type: 'trending' | 'new' | 'limited', filters: any = {}) {
    return _ProductQueryService.getPublicProducts(type, filters);
  }
  static async getAllProducts(options: any = {}) {
    return _ProductQueryService.getAllProducts(options);
  }
  static async getBulkProducts(ids: string[]) {
    return _ProductQueryService.getBulkProducts(ids);
  }
  static async suggestProducts(query: string, limit?: number) {
    return _ProductQueryService.suggestProducts(query, limit);
  }
  static async getProductById(id: string) {
    return _ProductQueryService.getProductById(id);
  }
  static async getProductByIdAdmin(id: string) {
    return _ProductQueryService.getProductByIdAdmin(id);
  }

  // --- Mutation methods ---
  static async createProduct(data: any) {
    return _ProductMutationService.createProduct(data);
  }
  static async updateProduct(id: string, data: any) {
    return _ProductMutationService.updateProduct(id, data);
  }
  static async deleteProduct(id: string) {
    return _ProductMutationService.deleteProduct(id);
  }
  static async bulkDeleteProducts(ids: string[]) {
    return _ProductMutationService.bulkDeleteProducts(ids);
  }
}
