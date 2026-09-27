/**
 * adminTools — Implementations for Admin CRUD Agent
 *
 * Các tool này được gọi từ adminAgent.ts khi Gemini function calling
 * phát hiện intent của admin là create/update/delete sản phẩm.
 *
 * KHÔNG gọi qua HTTP — gọi thẳng ProductService + generateProduct controller.
 *
 * Dependencies được inject qua optional params để testable.
 */
import { ProductService } from '../ProductService.ts';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { Brand } from '../../models/Brand.ts';
import { Tag } from '../../models/Tag.ts';
import { Category } from '../../models/Category.ts';
import { AIService } from '../AIService.ts';

/** Kiểu dữ liệu trả về từ các tool */
export interface ToolResult {
  success: boolean;
  message: string;
  data?: any;
}

/** Dependency injection type để test */
export interface AdminToolDeps {
  findProductById?: (id: string) => Promise<any | null>;
  findProductsByName?: (query: string, limit?: number) => Promise<any[]>;
  createProduct?: (data: any) => Promise<any>;
  updateProduct?: (id: string, data: any) => Promise<any>;
  deleteProduct?: (id: string) => Promise<boolean>;
  /** Lấy danh sách brands active */
  getBrands?: () => Promise<{ name: string }[]>;
  /** Lấy danh sách tags active */
  getTags?: () => Promise<{ name: string }[]>;
  /** Lấy danh sách categories active */
  getCategories?: () => Promise<{ name: string }[]>;
}

/** Default implementations gọi thẳng Mongoose/ProductService */
const defaultDeps: AdminToolDeps = {
  findProductById: async (id) => {
    const product = await Product.findOne({ _id: id }).select('name').lean();
    return product || null;
  },
  findProductsByName: async (query, limit = 5) => {
    // Escape trước khi đưa vào $regex: chuỗi này đến từ mô hình, không phải từ mình.
    const escaped = String(query ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const products = await Product.find({ name: { $regex: escaped, $options: 'i' } })
      .select('name brandId')
      .populate('brandId', 'name')
      .limit(limit)
      .lean();
    // Product không còn cột price — giá phải lấy từ biến thể, nếu không admin thấy "giá 0".
    const priceRows = await ProductVariant.aggregate([
      { $match: { productId: { $in: products.map(p => p._id) } } },
      { $group: { _id: '$productId', minPrice: { $min: '$price' } } },
    ]);
    const priceById = new Map(priceRows.map((r: any) => [String(r._id), Number(r.minPrice) || 0]));
    return products.map(p => ({ ...p, price: priceById.get(String(p._id)) || 0 }));
  },
  createProduct: (data) => ProductService.createProduct(data),
  updateProduct: (id, data) => ProductService.updateProduct(id, data),
  deleteProduct: (id) => ProductService.deleteProduct(id),
  getBrands: async () => {
    return Brand.find({ status: 'active' }).select('name').lean();
  },
  getTags: async () => {
    return Tag.find({ status: 'active' }).select('name').lean();
  },
  getCategories: async () => {
    return Category.find({ status: 'active' }).select('name').lean();
  },
};

/** Resolve deps — merge injected deps over defaults */
function resolve(maybeDeps?: AdminToolDeps): Required<AdminToolDeps> {
  return { ...defaultDeps, ...(maybeDeps || {}) } as Required<AdminToolDeps>;
}

/**
 * createProductFromName — Tạo sản phẩm từ tên với thông số cơ bản
 */
export async function createProductFromName(
  name: string,
  overrides?: { price?: number; brand?: string; discountPercentage?: number },
  deps?: AdminToolDeps
): Promise<ToolResult> {
  const { createProduct, getBrands } = resolve(deps);
  try {
    // Kiểm tra sản phẩm trùng tên (case-insensitive)
    const existingProducts = await Product.find({
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    }).limit(1).lean();
    if (existingProducts.length > 0) {
      return {
        success: true,
        message: `ℹ️ Sản phẩm "${name}" đã tồn tại trong cửa hàng.`,
        data: { id: existingProducts[0]._id, name, existed: true },
      };
    }

    // Build basic product data
    const price = Number(overrides?.price) || 0;
    const productData: any = {
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      discountPercentage: overrides?.discountPercentage || 0,
      description: '',
      status: 'draft',
      // Giá và tồn kho KHÔNG phải cột của Product — không có biến thể thì sản phẩm tạo ra
      // hiển thị giá 0 và không mua được.
      variants: [{ size: '50ml', price, quantityInStock: 0 }],
    };

    // Find brand by name if provided
    if (overrides?.brand) {
      const brand = await Brand.findOne({
        name: { $regex: `^${overrides.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        status: 'active',
      });
      if (brand) {
        productData.brandId = brand._id;
      } else {
        return { success: false, message: `Hãng "${overrides.brand}" không tồn tại trong hệ thống. Vui lòng chọn một brand đang hoạt động.` };
      }
    }

    const newProduct = await createProduct(productData);

    return {
      success: true,
      message: `Đã tạo bản nháp "${newProduct.name}"` +
        (price > 0 ? ` giá ${price.toLocaleString('vi-VN')}đ` : ' — CHƯA có giá, phải bổ sung dung tích/biến thể trước khi bán') + '!',
      data: {
        id: newProduct._id,
        name: newProduct.name,
        url: `/admin/products/${newProduct._id}`,
      },
    };
  } catch (error: any) {
    console.error('❌ [AdminTool createProductFromName] Error:', error);
    return { success: false, message: `Lỗi tạo sản phẩm: ${error.message}` };
  }
}

/**
 * updateProductFields — Cập nhật sản phẩm theo id + fields
 */
export async function updateProductFields(
  id: string,
  fields: Record<string, any>,
  deps?: AdminToolDeps
): Promise<ToolResult> {
  const { findProductById, updateProduct } = resolve(deps);
  try {
    const existing = await findProductById!(id);
    if (!existing) {
      return { success: false, message: `Không tìm thấy sản phẩm với ID: ${id}` };
    }

    // Chỉ những key có thật trên schema Product mới ghi được; Mongoose strict mode âm thầm
    // vứt key lạ, nên lọc ở đây để không báo "đã cập nhật price/tags" trong khi không có gì đổi.
    const writable = new Set(Object.keys(Product.schema.paths));
    const applied: Record<string, any> = {};
    const rejected: string[] = [];
    for (const [key, value] of Object.entries(fields || {})) {
      if (writable.has(key.split('.')[0])) applied[key] = value;
      else rejected.push(key);
    }
    if (Object.keys(applied).length === 0) {
      const hint = rejected.includes('price') || rejected.includes('tags')
        ? ' Giá và tag giờ nằm ở bảng biến thể / ProductTag, không còn là cột của sản phẩm.'
        : '';
      return { success: false, message: `Không có field nào cập nhật được: ${rejected.join(', ') || '(trống)'}.${hint}` };
    }

    const updated = await updateProduct!(id, applied);
    if (!updated) {
      return { success: false, message: `Không thể cập nhật sản phẩm ${id}` };
    }

    const changedFields = Object.keys(applied).join(', ');
    const skippedNote = rejected.length > 0 ? ` (bỏ qua ${rejected.join(', ')} — không phải cột của Product)` : '';
    return {
      success: true,
      message: `Đã cập nhật sản phẩm "${existing.name}" (${changedFields})${skippedNote}`,
      data: {
        id: updated._id || id,
        name: existing.name,
        fields: changedFields,
        url: `/admin/products/${id}`,
      },
    };
  } catch (error: any) {
    console.error('❌ [AdminTool updateProductFields] Error:', error);
    return { success: false, message: `Lỗi cập nhật sản phẩm: ${error.message}` };
  }
}

/**
 * deleteProductById — Xóa sản phẩm theo id
 */
export async function deleteProductById(
  id: string
): Promise<ToolResult> {
  try {
    const existing = await Product.findOne({ _id: id }).select('name').lean();
    if (!existing) {
      return { success: false, message: `Không tìm thấy sản phẩm với ID: ${id}` };
    }

    const success = await ProductService.deleteProduct(id);
    if (!success) {
      return { success: false, message: `Không thể xóa sản phẩm ${id}` };
    }

    return {
      success: true,
      message: `Đã xóa sản phẩm "${existing.name}" (ID: ${id})`,
      data: { id, name: existing.name },
    };
  } catch (error: any) {
    console.error('❌ [AdminTool deleteProductById] Error:', error);
    return { success: false, message: `Lỗi xóa sản phẩm: ${error.message}` };
  }
}

/**
 * findProductsByName — Tìm kiếm sản phẩm theo tên (hỗ trợ update/delete)
 */
export async function findProductsByName(
  query: string,
  limit = 5
): Promise<ToolResult> {
  try {
    const escaped = String(query ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const products = await Product.find({
      name: { $regex: escaped, $options: 'i' },
    })
      .select('name brandId')
      .populate('brandId', 'name')
      .limit(limit)
      .lean();

    if (!products.length) {
      return { success: false, message: `Không tìm thấy sản phẩm nào khớp với "${query}"` };
    }

    // Product không còn cột price — lấy giá thấp nhất trong các biến thể của từng sản phẩm.
    const priceRows = await ProductVariant.aggregate([
      { $match: { productId: { $in: products.map(p => p._id) } } },
      { $group: { _id: '$productId', minPrice: { $min: '$price' } } },
    ]);
    const priceById = new Map(priceRows.map((r: any) => [String(r._id), Number(r.minPrice) || 0]));

    const list = products.map((p: any) => ({
      id: p._id,
      name: p.name,
      brand: p.brandId?.name || '',
      price: priceById.get(String(p._id)) || 0,
    }));

    return {
      success: true,
      message: `Tìm thấy ${products.length} sản phẩm khớp với "${query}":`,
      data: list,
    };
  } catch (error: any) {
    console.error('❌ [AdminTool findProductsByName] Error:', error);
    return { success: false, message: `Lỗi tìm kiếm: ${error.message}` };
  }
}

/**
 * searchTrending — Tìm nước hoa trending theo brand/keyword bằng Gemini
 *
 * Không gọi web search thật — dùng Gemini knowledge để trả về danh sách nước hoa nổi bật.
 */
export async function searchTrending(
  brand: string | undefined,
  query: string | undefined,
  limit: number,
): Promise<ToolResult> {
  try {
    const searchTerm = query || (brand ? `nước hoa ${brand}` : 'nước hoa trending 2026');
    const prompt = `Bạn là chuyên gia nước hoa. Liệt kê ${limit} loại nước hoa ${brand ? `của hãng ${brand} ` : ''}nổi bật, nổi tiếng hoặc kinh điển (classic) nhất — có thể là sản phẩm mới trending hoặc dòng kinh điển lâu đời${query ? ` liên quan đến "${query}"` : ''}.

TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON (không markdown, không giải thích):
{
  "products": [
    { "name": "Tên nước hoa", "brand": "Tên hãng", "description": "Mô tả ngắn 1 câu tiếng Việt" }
  ]
}

QUAN TRỌNG:
- Ưu tiên sản phẩm nổi tiếng, có thật trên thị trường
- Có thể là sản phẩm mới hoặc dòng classic lâu đời
- Brand phải chính xác
- Description ngắn gọn 1 câu tiếng Việt, mô tả mùi hương đặc trưng`;

    const raw = await AIService.generateResponse(prompt, undefined, 'gemini-3.1-flash-lite');
    const jsonString = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonString);
    const products = parsed.products || parsed;

    if (!Array.isArray(products) || products.length === 0) {
      return {
        success: false,
        message: `Không tìm thấy nước hoa trending nào${brand ? ` cho hãng ${brand}` : ''}.`,
      };
    }

    return {
      success: true,
      message: `Tìm thấy ${products.length} nước hoa trending${brand ? ` của ${brand}` : ''}:`,
      data: products.slice(0, limit).map((p: any) => ({
        name: p.name || '',
        brand: p.brand || brand || '',
        description: p.description || '',
      })),
    };
  } catch (error: any) {
    console.error('❌ [AdminTool searchTrending] Error:', error);
    return { success: false, message: `Lỗi tìm trending: ${error.message}` };
  }
}
