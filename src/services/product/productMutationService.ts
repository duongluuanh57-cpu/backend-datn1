import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { redis } from '../../config/redis.ts';
import { Brand } from '../../models/Brand.ts';
import { Tag } from '../../models/Tag.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { Category } from '../../models/Category.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { Favorite } from '../../models/Favorite.ts';
import { CartItem } from '../../models/CartItem.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { ImageService } from '../ImageService.ts';
import { FuzzyMatchCache } from '../FuzzyMatchCache.ts';
import { NEW_AUTO_DISCOUNT_PERCENT, computeLimitedDiscount } from './discountLifecycleService.ts';
import { parseSizes, slugify } from './productHelpers.ts';
import { isLimitedTagRef } from './tagRules.ts';

// Resolve một định danh danh mục (ObjectId string HOẶC tên, không phân biệt hoa thường)
// về ObjectId. Trả null nếu không khớp category nào.
async function resolveCategoryId(input: string): Promise<any | null> {
  const value = String(input).trim();
  if (!value) return null;
  if (mongoose.Types.ObjectId.isValid(value)) {
    const exists = await Category.exists({ _id: value });
    if (exists) return new mongoose.Types.ObjectId(value);
  }
  const cat = await Category.findOne({ name: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id').lean();
  return cat?._id || null;
}

export class ProductMutationService {

  /**
   * Đồng bộ variant của một product mà GIỮ NGUYÊN `_id` của variant cũ.
   *
   * Trước đây updateProduct làm `deleteMany + insertMany` → mọi `_id` variant bị tái
   * tạo, kéo theo `cart_items` (FK theo productVariantId) thành mồ côi sau MỖI lần
   * admin sửa product (row trắng + tiền ảo + sập checkout). Ở đây match theo `size`
   * (business key): size cũ → update tại chỗ (giữ _id), size mới → insert, size bị bỏ
   * → xóa + cascade dọn cart_items trỏ tới nó.
   */
  private static async syncVariantsPreservingIds(
    productId: string,
    incoming: Array<Record<string, any>>
  ): Promise<void> {
    const existing = (await ProductVariant.find({ productId }).select('_id size').lean()) as any[];
    const existingBySize = new Map<string, any>();
    existing.forEach((v) => existingBySize.set(String(v.size), v));

    const incomingSizes = new Set(incoming.map((v) => String(v.size)));
    const removedIds = existing
      .filter((v) => !incomingSizes.has(String(v.size)))
      .map((v) => v._id);
    const removedSizes = existing
      .filter((v) => !incomingSizes.has(String(v.size)))
      .map((v) => String(v.size));

    // OrderItem không còn snapshot product/size; xóa variant đã từng xuất hiện
    // trong đơn sẽ làm mất liên kết lịch sử. Chặn thay đổi trước khi ghi bất kỳ
    // variant nào để tránh cập nhật dở dang.
    if (removedIds.length > 0 && await OrderItem.exists({ productVariantId: { $in: removedIds } })) {
      throw new Error(
        `Không thể xóa biến thể đã có trong đơn hàng: ${removedSizes.join(', ')}. `
        + 'Hãy giữ lại biến thể để bảo toàn lịch sử đơn hàng.'
      );
    }

    for (const v of incoming) {
      const sizeKey = String(v.size);
      const match = existingBySize.get(sizeKey);

      const $set: Record<string, any> = {
        price: v.price,
        quantityInStock: v.quantityInStock,
        isDefault: v.isDefault,
      };
      if (v.sku !== undefined) $set.sku = v.sku;

      if (match) {
        await ProductVariant.updateOne({ _id: match._id }, { $set });
      } else {
        await ProductVariant.insertMany([{ productId, ...v }]);
      }
    }

    if (removedIds.length > 0) {
      await ProductVariant.deleteMany({ _id: { $in: removedIds } });
      await CartItem.deleteMany({ productVariantId: { $in: removedIds } });
    }
  }

  /**
   * Cập nhật sản phẩm
   */
  static async updateProduct(id: string, data: any): Promise<any | null> {
    const existingProduct = await Product.findById(id);
    if (!existingProduct) return null;

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;

    // Discount: admin đặt tay luôn thắng (gỡ cờ autoDiscount để lifecycle không đụng vào)
    if (data.discountPercentage !== undefined) {
      const pct = Math.max(0, Math.min(100, Number(data.discountPercentage) || 0));
      updateData.discountPercentage = pct;
      if (pct > 0) updateData.autoDiscount = false;
    }

    // Specifications sub-document update
    const specFields = ['longevity', 'sillage', 'scentTrail', 'style', 'suitableFor', 'occasion', 'season', 'time'];
    for (const key of specFields) {
      const val = data[key] !== undefined ? data[key] : (data.specifications && data.specifications[key] !== undefined ? data.specifications[key] : undefined);
      if (val !== undefined) {
        updateData[`specifications.${key}`] = val;
      }
    }

    // Brand mapping - chỉ tìm, KHÔNG tạo mới (case-insensitive, bỏ qua khoảng trắng thừa)
    if (data.brand) {
      let brandDoc;
      const trimmedBrand = data.brand.trim();
      const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(trimmedBrand);
      if (isValidObjectId) {
        brandDoc = await Brand.findOne({ _id: trimmedBrand, status: 'active' });
      }
      if (!brandDoc) {
        brandDoc = await Brand.findOne({ name: trimmedBrand, status: 'active' });
      }
      if (brandDoc) {
        updateData.brandId = brandDoc._id;
      } else {
        console.warn(`⚠️ [Brand] "${data.brand}" not found in DB - skipping, will NOT create`);
      }
    }

    // Kiểm tra trùng tên sản phẩm khi cập nhật
    if (updateData.name || updateData.brandId) {
      const checkName = updateData.name || existingProduct.name;
      const checkBrandId = updateData.brandId || existingProduct.brandId;
      if (checkName && checkBrandId) {
        const nameRegex = new RegExp(`^${checkName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const dup = await Product.findOne({ _id: { $ne: id }, name: nameRegex, brandId: checkBrandId });
        if (dup) {
          throw new Error(`Sản phẩm "${checkName.trim()}" đã tồn tại trong thương hiệu này!`);
        }
      }
    }

    // Tags mapping — ghi vào bảng trung gian ProductTag (CHỈ dùng tag đã tồn tại trong DB)
    if (data.tag !== undefined) {
      const tagSlugs = (data.tag as string).split(',').map((s: string) => s.trim()).filter(Boolean);
      const allActiveTags = await Tag.find({ status: 'active' }).lean();
      let tagIds: mongoose.Types.ObjectId[] = [];
      for (const slug of tagSlugs) {
        const matched = allActiveTags.find(
          t => t.slug.toLowerCase() === slug.toLowerCase() || t.name.toLowerCase() === slug.toLowerCase()
        );
        if (matched && !tagIds.some(id => id.equals(matched._id))) {
          tagIds.push(matched._id);
        }
      }
      // Luật loại trừ: New và Standard không đứng chung (New = hàng mới, Standard = hàng cũ).
      // Tập cuối có New thì loại Standard trước khi ghi.
      const isNewTag = (t: any) =>
        /^new$/i.test(t.slug || '') || /^san-pham-moi$/i.test(t.slug || '') ||
        /^sản phẩm mới$/i.test(t.name || '');
      const isStandardTag = (t: any) =>
        /^standard$/i.test(t.slug || '') || /^tiêu chuẩn$/i.test(t.name || '');
      if (tagIds.some(id => { const t = allActiveTags.find(x => x._id.equals(id)); return t && isNewTag(t); })) {
        tagIds = tagIds.filter(id => {
          const t = allActiveTags.find(x => x._id.equals(id));
          return !t || !isStandardTag(t);
        });
      }
      // Link ghi ra từ request này là lựa chọn của admin/AI nên mang 'manual' — sync tồn
      // kho không được tự ý gỡ, không riêng gì Limited.
      // Chỉ xoá link mà request không nhắc tới: chuỗi tag không khớp tag nào trong DB là
      // một tra cứu thất bại, không phải lệnh "bỏ hết tag của sản phẩm".
      if (tagSlugs.length === 0) {
        await ProductTag.deleteMany({ productId: id });
      } else if (tagIds.length > 0) {
        await ProductTag.deleteMany({ productId: id, tagId: { $nin: tagIds } });
        const remainingLinks = await ProductTag.find({ productId: id }).select('tagId').lean();
        const remainingTagIds = new Set(remainingLinks.map(l => String(l.tagId)));
        const toInsert = tagIds.filter(tagId => !remainingTagIds.has(tagId.toString()));
        if (toInsert.length > 0) {
          await ProductTag.insertMany(toInsert.map(tagId => ({ productId: id, tagId, source: 'manual' })));
        }
        // Link còn lại có thể do sync tự gán ('auto', hoặc đời cũ không có field source).
        // Admin/AI vừa chọn lại nó thì nó thành quyết định có chủ đích — phải nâng lên
        // 'manual', nếu không lần sync tồn kho kế tiếp vẫn gỡ đúng tag admin vừa giữ.
        await ProductTag.updateMany(
          { productId: id, tagId: { $in: tagIds }, source: { $ne: 'manual' } },
          { $set: { source: 'manual' } }
        );
      }
    }

    if (data.categoryId !== undefined || data.categories !== undefined) {
      const raw = (data.categoryId ?? data.categories) as string;
      const first = String(raw).split(',')[0]?.trim();
      if (first) {
        const catId = await resolveCategoryId(first);
        if (catId) updateData.categoryId = catId;
      }
    }

    const updatedProduct = await Product.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (updatedProduct) {
      // --- Image sync: chỉ xử lý khi request có gửi image fields ---
      if ('image' in data || 'images' in data) {
        const oldImages = await ProductImage.find({ productId: id }).lean();
        const oldUrls = oldImages.map(i => i.url).filter(Boolean);

        const newImages: string[] = [];
        if (data.image) newImages.push(data.image);
        if (data.images && Array.isArray(data.images)) {
          newImages.push(...data.images.filter((img: string) => img !== data.image));
        }

        // Xóa ảnh đã bị remove khỏi R2
        const removed = oldUrls.filter(u => !newImages.includes(u));
        if (removed.length > 0) {
          await Promise.all(removed.map(u => ImageService.deleteFromR2(u).catch(() => {})));
        }

        // Đồng bộ DB — luôn xóa cũ rồi insert lại
        await ProductImage.deleteMany({ productId: id });
        if (newImages.length > 0) {
          await ProductImage.insertMany(newImages.map((url: string) => ({
            productId: id,
            url
          })));
        }
        // Giữ ảnh chính trên Product đồng bộ với collection ảnh
        const mainImage = data.image || (data.images && data.images[0]) || '';
        await Product.updateOne({ _id: id }, { $set: { image: mainImage } });
      }

      // Sync Variants in ProductVariant collection
      if (Array.isArray(data.variants) && data.variants.length > 0) {
        // Tìm xem có biến thể 50ml hay không
        const has50ml = data.variants.some((v: any) => (v.size || '').trim().toLowerCase() === '50ml');
        let defaultIndex = -1;
        if (has50ml) {
          defaultIndex = data.variants.findIndex((v: any) => (v.size || '').trim().toLowerCase() === '50ml');
        } else {
          defaultIndex = data.variants.findIndex((v: any) => v.isDefault === true);
          if (defaultIndex === -1) {
            defaultIndex = 0;
          }
        }

        const variantsToInsert = data.variants.map((v: any, index: number) => {
          return {
            productId: id,
            size: v.size || '50ml',
            price: Math.max(0, Number(v.price) || 0),
            quantityInStock: Math.max(0, v.quantityInStock !== undefined ? Number(v.quantityInStock) : (v.quantity !== undefined ? Number(v.quantity) : 0)),
            sku: v.sku || '',
            isDefault: index === defaultIndex,
          };
        });
        await ProductMutationService.syncVariantsPreservingIds(id, variantsToInsert);
      } else if (data.size !== undefined) {
        const parsed = parseSizes(data.size);
        if (parsed.length > 0) {
          // Tìm xem có biến thể 50ml hay không trong chuỗi parse
          const has50ml = parsed.some(item => (item.size || '').trim().toLowerCase() === '50ml');
          let defaultIndex = -1;
          if (has50ml) {
            defaultIndex = parsed.findIndex(item => (item.size || '').trim().toLowerCase() === '50ml');
          } else {
            defaultIndex = 0;
          }

          const variantsToInsert = parsed.map((item, index) => {
            return {
              productId: id,
              size: item.size,
              price: item.price,
              quantityInStock: item.quantityInStock !== undefined ? item.quantityInStock : (index === 0 ? (data.quantityInStock || 0) : 0),
              isDefault: index === defaultIndex,
            };
          });
          await ProductMutationService.syncVariantsPreservingIds(id, variantsToInsert);
        } else {
          await ProductMutationService.syncVariantsPreservingIds(id, []);
        }
      }

      // Xóa các cache liên quan sau khi cập nhật (kèm cache chi tiết của chính sản phẩm này)
      await clearProductCache(id);
    }

    return updatedProduct;
  }

  /**
   * Xóa sản phẩm
   */
  static async deleteProduct(id: string): Promise<boolean> {
    const product = await Product.findOne({ _id: id });
    if (!product) return false;

    // Fetch images before deletion from DB
    const images = await ProductImage.find({ productId: id }).lean();
    const variantDocs = await ProductVariant.find({ productId: id }).select('_id').lean();
    const variantIds = variantDocs.map(v => v._id) as mongoose.Types.ObjectId[];

    if (variantIds.length > 0 && await OrderItem.exists({ productVariantId: { $in: variantIds } })) {
      throw new Error('Không thể xóa sản phẩm đã có trong đơn hàng; hãy chuyển sản phẩm sang archived.');
    }

    const result = await Product.deleteOne({ _id: id });
    if (result.deletedCount > 0) {
      // Clean normalized collections
      await ProductImage.deleteMany({ productId: id });
      if (variantIds.length > 0) {
        await ProductVariant.deleteMany({ _id: { $in: variantIds } });
        // Dọn dòng giỏ hàng trỏ tới variant vừa xóa (tránh cart_items mồ côi → row trắng)
        await CartItem.deleteMany({ productVariantId: { $in: variantIds } });
      }
      // Xóa tag links
      await ProductTag.deleteMany({ productId: id });
      // Xóa favorite mồ côi (nếu không, badge navbar đếm cả product đã xóa)
      await Favorite.deleteMany({ productId: id });
      // Delete images and virtual folders from R2
      const foldersToDelete = new Set<string>();
      const imgPromises = images.map(img => {
        const folder = ImageService.getFolderFromUrl(img.url);
        if (folder) foldersToDelete.add(folder);
        return ImageService.deleteFromR2(img.url).catch(err => {
          console.error('Lỗi khi xóa ảnh khỏi R2 trong deleteProduct:', err);
        });
      });
      if (product.name) {
        foldersToDelete.add(`products/${slugify(product.name)}`);
      }
      const folderPromises = [...foldersToDelete].map(folder =>
        ImageService.deleteFolderFromR2(folder).catch(err => {
          console.error('Lỗi khi xóa folder trên R2 trong deleteProduct:', err);
        })
      );
      await Promise.all([...imgPromises, ...folderPromises]);

      await clearProductCache(id);
    }
    return result.deletedCount > 0;
  }

  /**
   * Xóa hàng loạt sản phẩm
   */
  static async bulkDeleteProducts(ids: string[]): Promise<boolean> {
    if (!ids || ids.length === 0) return false;

    // Fetch products and images before deletion from DB
    const products = await Product.find({ _id: { $in: ids } }).lean();
    const images = await ProductImage.find({ productId: { $in: ids } }).lean();
    const variantDocs = await ProductVariant.find({ productId: { $in: ids } }).select('_id').lean();
    const allVariantIds = variantDocs.map(v => v._id) as mongoose.Types.ObjectId[];

    if (allVariantIds.length > 0 && await OrderItem.exists({ productVariantId: { $in: allVariantIds } })) {
      throw new Error('Không thể xóa sản phẩm đã có trong đơn hàng; hãy chuyển sản phẩm sang archived.');
    }

    const result = await Product.deleteMany({ _id: { $in: ids } });
    if (result.deletedCount > 0) {
      // Clean normalized collections in bulk
      await ProductImage.deleteMany({ productId: { $in: ids } });
      if (allVariantIds.length > 0) {
        await ProductVariant.deleteMany({ _id: { $in: allVariantIds } });
        // Dọn dòng giỏ hàng trỏ tới variant vừa xóa (tránh cart_items mồ côi → row trắng)
        await CartItem.deleteMany({ productVariantId: { $in: allVariantIds } });
      }
      // Xóa tag links
      await ProductTag.deleteMany({ productId: { $in: ids } });
      // Xóa favorite mồ côi (nếu không, badge navbar đếm cả product đã xóa)
      await Favorite.deleteMany({ productId: { $in: ids } });
      // Delete images and virtual folders from R2
      const foldersToDelete = new Set<string>();
      const imgPromises = images.map(img => {
        const folder = ImageService.getFolderFromUrl(img.url);
        if (folder) foldersToDelete.add(folder);
        return ImageService.deleteFromR2(img.url).catch(err => {
          console.error('Lỗi khi xóa ảnh khỏi R2 trong bulkDeleteProducts:', err);
        });
      });
      for (const p of products) {
        if (p.name) {
          foldersToDelete.add(`products/${slugify(p.name)}`);
        }
      }
      const folderPromises = [...foldersToDelete].map(folder =>
        ImageService.deleteFolderFromR2(folder).catch(err => {
          console.error('Lỗi khi xóa folder trên R2 trong bulkDeleteProducts:', err);
        })
      );
      await Promise.all([...imgPromises, ...folderPromises]);

      // Kèm key chi tiết của từng sản phẩm vừa xóa — không truyền id thì `product:detail:*`
      // không nằm trong danh sách scan, và trang chi tiết vẫn served bản đã xóa tới hết TTL.
      await clearProductCache(ids);
    }
    return result.deletedCount > 0;
  }

  /**
   * Tạo sản phẩm mới
   */
  static async createProduct(data: any): Promise<any> {
    const productData: any = {};
    if (data.name !== undefined) productData.name = data.name;
    if (data.description !== undefined) productData.description = data.description;
    if (data.discountPercentage !== undefined) productData.discountPercentage = data.discountPercentage;
    if (data.image !== undefined) productData.image = data.image;
    if (data.status !== undefined) productData.status = data.status;
    // Hàng Limited là dòng độc quyền riêng, không xếp vào "Sản phẩm mới"
    const isLimitedTag = isLimitedTagRef(data.tag);
    productData.isNewArrival = !isLimitedTag;

    productData.specifications = {
      longevity: data.longevity || data.specifications?.longevity || '',
      sillage: data.sillage || data.specifications?.sillage || '',
      scentTrail: data.scentTrail || data.specifications?.scentTrail || '',
      style: data.style || data.specifications?.style || '',
      suitableFor: data.suitableFor || data.specifications?.suitableFor || '',
      occasion: data.occasion || data.specifications?.occasion || '',
      season: data.season || data.specifications?.season || '',
      time: data.time || data.specifications?.time || '',
    };

    // Brand mapping - Ưu tiên brandId, fallback sang tên brand (case-insensitive, bỏ qua khoảng trắng thừa)
    if (data.brand) {
      let brandDoc;
      const trimmedBrand = data.brand.trim();

      // Kiểm tra xem có phải là ObjectId hợp lệ không (24 hex characters)
      const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(trimmedBrand);

      if (isValidObjectId) {
        // Tìm theo ID trước (ưu tiên)
        brandDoc = await Brand.findOne({ _id: trimmedBrand, status: 'active' });
        if (brandDoc) {
          console.log(`🔍 [Brand] Tìm theo ID "${trimmedBrand}" → Tìm thấy: "${brandDoc.name}"`);
        } else {
          console.log(`⚠️ [Brand] ID "${trimmedBrand}" không tìm thấy, thử tìm theo tên...`);
        }
      }

      // Nếu không tìm thấy theo ID hoặc không phải ObjectId, tìm theo tên
      if (!brandDoc) {
        brandDoc = await Brand.findOne({ name: trimmedBrand, status: 'active' });
        if (!brandDoc) {
          const { lookup } = await FuzzyMatchCache.getOrFetch(
            `brands:all:active:v1`,
            () => Brand.find({ status: 'active' }).lean()
          );
          brandDoc = FuzzyMatchCache.fuzzyFind(trimmedBrand, lookup, (b: any) => b.name);
        }
        console.log(`🔍 [Brand] Tìm theo tên "${trimmedBrand}" (raw: "${data.brand}") → ${brandDoc ? `Tìm thấy: "${brandDoc.name}"` : 'KHÔNG TÌM THẤY'}`);
      }

      if (brandDoc) {
        productData.brandId = brandDoc._id;
      } else {
        throw new Error('Vui lòng kiểm tra lại tên hãng.');
      }
    } else {
      throw new Error('Vui lòng kiểm tra lại tên hãng.');
    }

    // Kiểm tra trùng tên sản phẩm trong cùng thương hiệu
    if (productData.name && productData.brandId) {
      const nameRegex = new RegExp(`^${productData.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const existingProd = await Product.findOne({ name: nameRegex, brandId: productData.brandId });
      if (existingProd) {
        throw new Error(`Sản phẩm "${productData.name.trim()}" đã tồn tại trong thương hiệu này!`);
      }
    }

    // Tags mapping — ghi vào bảng trung gian ProductTag sau khi save
    const pendingTagSlugs: string[] = [];
    if (data.tag) {
      pendingTagSlugs.push(...data.tag.split(',').map((s: string) => s.trim()).filter(Boolean));
    }

    if (data.categoryId || data.categories) {
      const raw = (data.categoryId ?? data.categories) as string;
      const first = String(raw).split(',')[0]?.trim();
      if (first) {
        const catId = await resolveCategoryId(first);
        if (catId) productData.categoryId = catId;
      }
    }

    // Vòng đời discount trung tâm: đặt sẵn % theo tag để badge hiện ngay.
    // - Hàng mới KHÔNG PHẢI Limited (sẽ mang Tag New) mà chưa có giảm giá -> 5%.
    // - Hàng Limited mà chưa có giảm giá -> mức khan hiếm tính từ tồn kho nhập vào.
    // Giảm giá sẵn có không đụng tới.
    const isLimitedInput = pendingTagSlugs.some(isLimitedTagRef);
    const inputDiscount = Number(data.discountPercentage ?? 0);
    if (!(inputDiscount > 0)) {
      if (!isLimitedInput && NEW_AUTO_DISCOUNT_PERCENT > 0) {
        productData.discountPercentage = NEW_AUTO_DISCOUNT_PERCENT;
        productData.autoDiscount = true;
      } else if (isLimitedInput && Array.isArray(data.variants) && data.variants.length > 0) {
        const inputStock = data.variants.reduce(
          (sum: number, v: any) => sum + (Number(v.quantityInStock ?? v.quantity) || 0), 0
        );
        const limitedLevel = computeLimitedDiscount(inputStock);
        if (limitedLevel > 0) {
          productData.discountPercentage = limitedLevel;
          productData.autoDiscount = true;
        }
      }
    }
    const product = new Product(productData);
    const saved = await product.save();

    await Promise.all([
    ]);

    // Ghi tag links vào bảng trung gian ProductTag (CHỈ dùng tag đã tồn tại trong DB)
    // Tự động gán tag "New" cho bất kỳ sản phẩm nào vừa được thêm vào (thay vì bắt buộc phải gán mặc định tag)
    const allActiveTags = await Tag.find({ status: 'active' }).lean();
    const tagIdsToLink: mongoose.Types.ObjectId[] = [];

    // 1. Kiểm tra nếu Admin chọn tag "Limited"
    const hasLimited = pendingTagSlugs.some(isLimitedTagRef);
    let manualLimitedTagId: string | null = null;

    if (hasLimited) {
      // Sản phẩm Limited là dòng xa xỉ độc quyền: TÁCH HẲN RA, không gán Tag New
      const limitedTagDoc = allActiveTags.find(
        t => isLimitedTagRef(t.slug) || isLimitedTagRef(t.name)
      );
      if (limitedTagDoc) {
        manualLimitedTagId = limitedTagDoc._id.toString();
        tagIdsToLink.push(limitedTagDoc._id);
      }
      // Gán tag Standard (vì chỉ sản phẩm New mới không có Standard)
      const standardTagDoc = allActiveTags.find(
        t => t.slug.toLowerCase() === 'standard' || t.name.toLowerCase() === 'standard'
      );
      if (standardTagDoc && !tagIdsToLink.some(id => id.equals(standardTagDoc._id))) {
        tagIdsToLink.push(standardTagDoc._id);
      }
    } else {
      // 2. Nếu KHÔNG PHẢI Limited -> Tự động đưa sản phẩm vừa thêm vào danh mục "New" / "Sản phẩm mới"
      const newTagDoc = allActiveTags.find(
        t => t.slug.toLowerCase() === 'new' || t.name.toLowerCase() === 'sản phẩm mới'
      );
      if (newTagDoc) {
        tagIdsToLink.push(newTagDoc._id);
      }
    }

    if (tagIdsToLink.length > 0) {
      await ProductTag.insertMany(tagIdsToLink.map(tagId => ({
        productId: saved._id,
        tagId,
        source: manualLimitedTagId === tagId.toString() ? 'manual' : 'auto',
      })));
    }

    // Size / Variants mapping
    if (Array.isArray(data.variants) && data.variants.length > 0) {
      const has50ml = data.variants.some((v: any) => (v.size || '').trim().toLowerCase() === '50ml');
      let defaultIndex = -1;
      if (has50ml) {
        defaultIndex = data.variants.findIndex((v: any) => (v.size || '').trim().toLowerCase() === '50ml');
      } else {
        defaultIndex = data.variants.findIndex((v: any) => v.isDefault === true);
        if (defaultIndex === -1) {
          defaultIndex = 0;
        }
      }

      const variantsToInsert = data.variants.map((v: any, index: number) => {
        return {
          productId: saved._id,
          size: v.size || '50ml',
          price: Math.max(0, Number(v.price) || 0),
          quantityInStock: Math.max(0, v.quantityInStock !== undefined ? Number(v.quantityInStock) : (v.quantity !== undefined ? Number(v.quantity) : 0)),
          sku: v.sku || '',
          isDefault: index === defaultIndex,
        };
      });
      await ProductVariant.insertMany(variantsToInsert);
    } else if (data.size) {
      const parsed = parseSizes(data.size);
      if (parsed.length > 0) {
        const has50ml = parsed.some(item => (item.size || '').trim().toLowerCase() === '50ml');
        let defaultIndex = -1;
        if (has50ml) {
          defaultIndex = parsed.findIndex(item => (item.size || '').trim().toLowerCase() === '50ml');
        } else {
          defaultIndex = 0;
        }

        const variantsToInsert = parsed.map((item, index) => {
          return {
            productId: saved._id,
            size: item.size,
            price: item.price,
            quantityInStock: item.quantityInStock !== undefined ? item.quantityInStock : (index === 0 ? (data.quantityInStock || 0) : 0),
            isDefault: index === defaultIndex,
          };
        });
        await ProductVariant.insertMany(variantsToInsert);
      }
    }

    // Images mapping
    const allImages: string[] = [];
    if (data.image) allImages.push(data.image);
    if (data.images && Array.isArray(data.images)) {
      allImages.push(...data.images.filter((img: string) => img !== data.image));
    }
    if (allImages.length > 0) {
      await ProductImage.insertMany(allImages.map((url: string) => ({
        productId: saved._id,
        url
      })));
    }

    // Clear Redis Cache so that the new product immediately shows up on the homepage/outside!
    await clearProductCache();

    return saved;
  }
}

/**
 * Helper: xóa toàn bộ cache product list, detail và graphql
 */
export async function clearProductCache(productId?: string | string[]): Promise<void> {
  try {
    // Không liệt kê key tĩnh theo tên: mọi key đều đã bị pattern scan bên dưới quét
    // trúng, còn tên version thì đổi liên tục nên danh sách này luôn hỏng.
    const keysToDelete: string[] = [];
    const patterns = [
      'homepage:*',
      'products:new:*',
      'products:limited:*',
      'products:trending:*',
      'products:sale:*',
      'products:public:*',
      'products:seasonal:*',
      'products:suggest:*',
      'graphql:*',
    ];
    const detailIds = (Array.isArray(productId) ? productId : productId ? [productId] : []).filter(Boolean);
    for (const pid of detailIds) {
      // `*` giữa để bắt mọi phiên bản của key chi tiết, chỉ đúng sản phẩm vừa sửa.
      patterns.push(`product:detail:*:${pid}`);
    }
    // redis.keys block toàn server (O(N)) — dùng scan không block
    for (const pattern of patterns) {
      try {
        let cursor = '0';
        do {
          const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
          cursor = next;
          if (keys.length > 0) keysToDelete.push(...keys);
        } while (cursor !== '0');
      } catch (_) {}
    }
    const uniqueKeys = [...new Set(keysToDelete)];
    if (uniqueKeys.length > 0) {
      await redis.del(...uniqueKeys);
    }
    // Xóa in-memory cache trang chủ nếu có
    try {
      const { invalidateHomepageCache } = await import('../../graphql/schema.ts');
      invalidateHomepageCache();
    } catch (_) {}
  } catch (err) {
    console.warn('Failed to clear product caches:', err);
  }
}
