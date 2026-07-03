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
import { Brand } from '../../models/Brand.ts';
import { Tag } from '../../models/Tag.ts';
import { Category } from '../../models/Category.ts';
import { BrandService } from '../BrandService.ts';
import { AIService } from '../AIService.ts';
import { generateProduct } from '../../controllers/aiCatalog/generateProductController.ts';
import { generateBrand } from '../../controllers/aiCatalog/generateBrandController.ts';

/** Kiểu dữ liệu trả về từ các tool */
export interface ToolResult {
  success: boolean;
  message: string;
  data?: any;
}

/** Dependency injection type để test */
export interface AdminToolDeps {
  findProductById?: (id: string, tenantId: string) => Promise<any | null>;
  findProductsByName?: (query: string, tenantId: string, limit?: number) => Promise<any[]>;
  createProduct?: (data: any, tenantId: string) => Promise<any>;
  updateProduct?: (id: string, data: any, tenantId: string) => Promise<any>;
  deleteProduct?: (id: string, tenantId: string) => Promise<boolean>;
  /** Lấy danh sách brands active */
  getBrands?: (tenantId: string) => Promise<{ name: string }[]>;
  /** Lấy danh sách tags active */
  getTags?: (tenantId: string) => Promise<{ name: string }[]>;
  /** Lấy danh sách categories active */
  getCategories?: (tenantId: string) => Promise<{ name: string }[]>;
}

/** Default implementations gọi thẳng Mongoose/ProductService */
const defaultDeps: AdminToolDeps = {
  findProductById: async (id, tenantId) => {
    const product = await Product.findOne({ _id: id, tenantId }).select('name').lean();
    return product || null;
  },
  findProductsByName: async (query, tenantId, limit = 5) => {
    return Product.find({ tenantId, name: { $regex: query, $options: 'i' } })
      .select('name brandId price')
      .populate('brandId', 'name')
      .limit(limit)
      .lean();
  },
  createProduct: (data, tenantId) => ProductService.createProduct(data, tenantId),
  updateProduct: (id, data, tenantId) => ProductService.updateProduct(id, data, tenantId),
  deleteProduct: (id, tenantId) => ProductService.deleteProduct(id, tenantId),
  getBrands: async (tenantId) => {
    return Brand.find({ tenantId, status: 'active' }).select('name').lean();
  },
  getTags: async (tenantId) => {
    return Tag.find({ tenantId, status: 'active' }).select('name').lean();
  },
  getCategories: async (tenantId) => {
    return Category.find({ tenantId, status: 'active' }).select('name').lean();
  },
};

/** Resolve deps — merge injected deps over defaults */
function resolve(maybeDeps?: AdminToolDeps): AdminToolDeps {
  return { ...defaultDeps, ...(maybeDeps || {}) };
}

/**
 * createProductFromName — Dùng AI generate toàn bộ thông tin từ tên, rồi create
 */
export async function createProductFromName(
  name: string,
  tenantId: string,
  overrides?: { price?: number; brand?: string; discountPercentage?: number },
  deps?: AdminToolDeps
): Promise<ToolResult> {
  const { createProduct, getBrands, getTags, getCategories } = resolve(deps);
  try {
    // Build context data từ DB
    const [allBrands, allTags, allCategories] = await Promise.all([
      getBrands!(tenantId),
      getTags!(tenantId),
      getCategories!(tenantId),
    ]);

    // Gọi generateProduct internal (dùng AI để sinh full product info)
    // Dùng generateProduct trực tiếp với mock req/reply
    let generatedInfo: any = null;

    // Tạo mock req
    const mockReq: any = {
      body: {
        name,
        availableBrands: allBrands.map((b: any) => b.name),
        availableTags: allTags.map((t: any) => t.name),
        availableCategories: allCategories.map((c: any) => c.name),
        availableGenders: ['male', 'female', 'unisex'],
        availableSizes: ['2ml', '5ml', '10ml', '30ml', '50ml', '75ml', '100ml', '125ml', '150ml'],
        ...overrides,
      },
      user: { tenantId },
    };

    let mockReplyData: any = null;
    const mockReply: any = {
      status: function (code: number) {
        return {
          send: function (data: any) {
            mockReplyData = { status: code, ...data };
            return mockReply;
          },
        };
      },
      send: function (data: any) {
        mockReplyData = { status: 200, ...data };
        return mockReply;
      },
    };

    await generateProduct(mockReq, mockReply);

    if (!mockReplyData || !mockReplyData.success) {
      return {
        success: false,
        message: mockReplyData?.error || mockReplyData?.message || 'AI không thể tạo thông tin sản phẩm',
      };
    }

    generatedInfo = mockReplyData.data;

    // Gán lại name từ tham số gốc (AI trong generateProductController không trả ra field "name" trong JSON)
    generatedInfo.name = name;

    // Chuyển categories, tag từ array → string nếu cần (tránh lỗi .split is not a function)
    if (Array.isArray(generatedInfo.categories)) {
      generatedInfo.categories = generatedInfo.categories.join(', ');
    }
    if (Array.isArray(generatedInfo.tag)) {
      generatedInfo.tag = generatedInfo.tag.join(', ');
    }

    // Merge overrides
    if (overrides?.price) generatedInfo.price = overrides.price;
    if (overrides?.discountPercentage) generatedInfo.discountPercentage = overrides.discountPercentage;

    // Kiểm tra sản phẩm trùng tên (case-insensitive)
    const existingProducts = await Product.find({
      tenantId,
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    }).limit(1).lean();
    if (existingProducts.length > 0) {
      return {
        success: true,
        message: `ℹ️ Sản phẩm "${name}" đã tồn tại trong cửa hàng.`,
        data: { id: existingProducts[0]._id, name, existed: true },
      };
    }

    // Brand phải có sẵn trong DB (đã được resolve từ generateProductController)
    if (!generatedInfo.brandId) {
      return { success: false, message: `Hãng "${generatedInfo.brand || 'Không rõ'}" không tồn tại trong hệ thống. Vui lòng tạo hãng thủ công trước.` };
    }

    // Gọi ProductService.createProduct
    const newProduct = await ProductService.createProduct(generatedInfo, tenantId);

    return {
      success: true,
      message: `Đã tạo sản phẩm "${newProduct.name}" thành công!`,
      data: {
        id: newProduct._id,
        name: newProduct.name,
        price: generatedInfo.price,
        brand: generatedInfo.brand,
        tags: generatedInfo.tag,
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
  tenantId: string,
  deps?: AdminToolDeps
): Promise<ToolResult> {
  const { findProductById, updateProduct } = resolve(deps);
  try {
    const existing = await findProductById!(id, tenantId);
    if (!existing) {
      return { success: false, message: `Không tìm thấy sản phẩm với ID: ${id}` };
    }

    const updated = await updateProduct!(id, fields, tenantId);
    if (!updated) {
      return { success: false, message: `Không thể cập nhật sản phẩm ${id}` };
    }

    const changedFields = Object.keys(fields).join(', ');
    return {
      success: true,
      message: `Đã cập nhật sản phẩm "${existing.name}" (${changedFields})`,
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
  id: string,
  tenantId: string
): Promise<ToolResult> {
  try {
    const existing = await Product.findOne({ _id: id, tenantId }).select('name').lean();
    if (!existing) {
      return { success: false, message: `Không tìm thấy sản phẩm với ID: ${id}` };
    }

    const success = await ProductService.deleteProduct(id, tenantId);
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
  tenantId: string,
  limit = 5
): Promise<ToolResult> {
  try {
    const products = await Product.find({
      tenantId,
      name: { $regex: query, $options: 'i' },
    })
      .select('name brandId price')
      .populate('brandId', 'name')
      .limit(limit)
      .lean();

    if (!products.length) {
      return { success: false, message: `Không tìm thấy sản phẩm nào khớp với "${query}"` };
    }

    const list = products.map((p: any) => ({
      id: p._id,
      name: p.name,
      brand: p.brandId?.name || '',
      price: p.price,
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
 * ensureBrand — Kiểm tra brand tồn tại, nếu chưa có → AI generate + lưu DB
 *
 * Dùng cho Query Decomposition: 1 tool gói gọn logic check + create if missing.
 * Tận dụng generateBrandController (AI sinh origin + description) + BrandService (lưu DB).
 */
export async function ensureBrand(
  name: string,
  tenantId: string
): Promise<ToolResult> {
  try {
    // 1. Check exists (case-insensitive exact match)
    const existing = await Brand.findOne({
      tenantId,
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    }).lean();

    if (existing) {
      return {
        success: true,
        message: `Hãng "${existing.name}" đã tồn tại.`,
        data: { brandId: existing._id, name: existing.name, existed: true },
      };
    }

    // 2. Generate brand info bằng generateBrandController (internal mock req/reply)
    let mockReplyData: any = null;
    const mockReq: any = {
      body: { name },
      user: { tenantId },
    };
    const mockReply: any = {
      status: (code: number) => ({
        send: (data: any) => { mockReplyData = { status: code, ...data }; return mockReply; },
      }),
      send: (data: any) => { mockReplyData = { status: 200, ...data }; return mockReply; },
    };

    await generateBrand(mockReq, mockReply);

    if (!mockReplyData?.success || !mockReplyData.data) {
      return {
        success: false,
        message: `AI không thể generate thông tin cho hãng "${name}": ${mockReplyData?.message || 'Unknown error'}`,
      };
    }

    const { origin, description } = mockReplyData.data;

    // 3. Lưu brand qua BrandService
    const newBrand = await BrandService.createBrand(
      { name, origin: origin || '', description: description || '', logo: '', status: 'active', featured: false },
      tenantId,
    );

    console.log(`✅ [ensureBrand] Created brand "${newBrand.name}" (ID: ${newBrand._id})`);
    return {
      success: true,
      message: `Đã tạo hãng "${newBrand.name}" thành công! (Xuất xứ: ${origin || 'Chưa rõ'})`,
      data: { brandId: newBrand._id, name: newBrand.name, existed: false, origin },
    };
  } catch (error: any) {
    console.error('❌ [AdminTool ensureBrand] Error:', error);
    return { success: false, message: `Lỗi ensure brand: ${error.message}` };
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
  tenantId: string,
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
