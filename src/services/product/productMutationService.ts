import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { redis } from '../../config/redis.ts';
import { Brand } from '../../models/Brand.ts';
import { Tag } from '../../models/Tag.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { Category } from '../../models/Category.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ImageService } from '../ImageService.ts';
import { FuzzyMatchCache } from '../FuzzyMatchCache.ts';
import { parseSizes, slugify } from './productHelpers.ts';

export class ProductMutationService {

  /**
   * Cập nhật sản phẩm
   */
  static async updateProduct(id: string, data: any): Promise<any | null> {
    const existingProduct = await Product.findById(id);
    if (!existingProduct) return null;

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.reviewsCount !== undefined) updateData.reviewsCount = data.reviewsCount;
    if (data.discountPercentage !== undefined) updateData.discountPercentage = data.discountPercentage;
    if (data.status !== undefined) updateData.status = data.status;

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
        brandDoc = await Brand.findOne({ _id: trimmedBrand });
      }
      if (!brandDoc) {
        brandDoc = await Brand.findOne({ name: trimmedBrand });
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
      const tagDocs = await Tag.find({ slug: { $in: tagSlugs } }).lean();
      const foundSlugs = new Set(tagDocs.map(t => t.slug));
      const skipped = tagSlugs.filter(s => !foundSlugs.has(s));
      if (skipped.length > 0) {
        console.warn(`⚠️ [Tag] Skipping ${skipped.length} tag(s) not found in DB: ${skipped.join(', ')} — will NOT auto-create`);
      }
      const tagIds = tagDocs.map(t => t._id);
      // Xóa tags cũ rồi insert lại
      await ProductTag.deleteMany({ productId: id });
      if (tagIds.length > 0) {
        await ProductTag.insertMany(tagIds.map(tagId => ({ productId: id, tagId })));
      }
    }

    if (data.categories !== undefined) {
      const catNames = data.categories.split(',').map((s: string) => s.trim()).filter(Boolean);
      const catIds = (await Promise.all(catNames.map(async (n: string) => {
        const cat = await Category.findOne({ name: { $regex: `^${n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
        return cat?._id || null;
      }))).filter(Boolean);
      if (catIds.length > 0) updateData.categories = catIds;
      else updateData.categories = [];
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
      }

      // Sync Variants in ProductVariant collection
      if (Array.isArray(data.variants) && data.variants.length > 0) {
        await ProductVariant.deleteMany({ productId: id });

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

        try {
          const fs = require('fs');
          fs.appendFileSync('variants_debug.log', `[Variants Debug] productId=${id} has50ml=${has50ml} defaultIndex=${defaultIndex}\nInput variants: ${JSON.stringify(data.variants)}\n\n`);
        } catch (e) {}

        const variantsToInsert = data.variants.map((v: any, index: number) => ({
          productId: id,
          size: v.size || '50ml',
          price: Number(v.price) || 0,
          quantityInStock: v.quantityInStock !== undefined ? Number(v.quantityInStock) : (v.quantity !== undefined ? Number(v.quantity) : 0),
          isDefault: index === defaultIndex,
          sortOrder: index,
        }));
        const insertedVariants = await ProductVariant.insertMany(variantsToInsert);
        const newVariantIds = insertedVariants.map(v => v._id);
        await Product.findOneAndUpdate({ _id: id }, { $set: { variants: newVariantIds } });
      } else if (data.size !== undefined) {
        await ProductVariant.deleteMany({ productId: id });

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

          const variantsToInsert = parsed.map((item, index) => ({
            productId: id,
            size: item.size,
            price: item.price,
            quantityInStock: item.quantityInStock !== undefined ? item.quantityInStock : (index === 0 ? (data.quantityInStock || 0) : 0),
            isDefault: index === defaultIndex,
            sortOrder: index
          }));
          const insertedVariants = await ProductVariant.insertMany(variantsToInsert);
          const newVariantIds = insertedVariants.map(v => v._id);
          await Product.findOneAndUpdate(
            { _id: id },
            { $set: { variants: newVariantIds } }
          );
        } else {
          await Product.findOneAndUpdate(
            { _id: id },
            { $set: { variants: [] } }
          );
        }
      }

      // Xóa các cache liên quan sau khi cập nhật
      await clearProductCache();
      try {
        await redis.del(`products:${id}`);
      } catch (_) {}
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
    const variantIds = (product.variants || []) as mongoose.Types.ObjectId[];

    const result = await Product.deleteOne({ _id: id });
    if (result.deletedCount > 0) {
      // Clean normalized collections
      await ProductImage.deleteMany({ productId: id });
      if (variantIds.length > 0) {
        await ProductVariant.deleteMany({ _id: { $in: variantIds } });
      }
      // Xóa tag links
      await ProductTag.deleteMany({ productId: id });
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

      await clearProductCache();
      try {
        await redis.del(`products:${id}`);
      } catch (_) {}
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
    const allVariantIds = products.flatMap(p => (p.variants || []) as mongoose.Types.ObjectId[]);

    const result = await Product.deleteMany({ _id: { $in: ids } });
    if (result.deletedCount > 0) {
      // Clean normalized collections in bulk
      await ProductImage.deleteMany({ productId: { $in: ids } });
      if (allVariantIds.length > 0) {
        await ProductVariant.deleteMany({ _id: { $in: allVariantIds } });
      }
      // Xóa tag links
      await ProductTag.deleteMany({ productId: { $in: ids } });
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

      await clearProductCache();
      for (const id of ids) {
        try {
          await redis.del(`products:${id}`);
        } catch (_) {}
      }
    }
    return result.deletedCount > 0;
  }

  /**
   * Cập nhật hàng loạt sản phẩm (status, categories)
   */
  static async bulkUpdateProducts(ids: string[], updateData: { status?: string; categories?: string[] }): Promise<boolean> {
    if (!ids || ids.length === 0) return false;
    const updateQuery: any = {};
    if (updateData.status) {
      updateQuery.status = updateData.status;
    }
    if (updateData.categories && Array.isArray(updateData.categories)) {
      updateQuery.categories = updateData.categories.map(id => new mongoose.Types.ObjectId(id));
    }
    if (Object.keys(updateQuery).length === 0) return false;
    const result = await Product.updateMany({ _id: { $in: ids } }, { $set: updateQuery });
    if (result.modifiedCount > 0) {
      await clearProductCache();
      for (const id of ids) {
        try {
          await redis.del(`products:${id}`);
        } catch (_) {}
      }
      return true;
    }
    return false;
  }

  /**
   * Tạo sản phẩm mới
   */
  static async createProduct(data: any): Promise<any> {
    const productData: any = {};
    if (data.name !== undefined) productData.name = data.name;
    if (data.description !== undefined) productData.description = data.description;
    if (data.reviewsCount !== undefined) productData.reviewsCount = data.reviewsCount;
    if (data.discountPercentage !== undefined) productData.discountPercentage = data.discountPercentage;
    if (data.image !== undefined) productData.image = data.image;
    if (data.status !== undefined) productData.status = data.status;

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
        brandDoc = await Brand.findOne({ _id: trimmedBrand });
        if (brandDoc) {
          console.log(`🔍 [Brand] Tìm theo ID "${trimmedBrand}" → Tìm thấy: "${brandDoc.name}"`);
        } else {
          console.log(`⚠️ [Brand] ID "${trimmedBrand}" không tìm thấy, thử tìm theo tên...`);
        }
      }

      // Nếu không tìm thấy theo ID hoặc không phải ObjectId, tìm theo tên
      if (!brandDoc) {
        brandDoc = await Brand.findOne({ name: trimmedBrand });
        if (!brandDoc) {
          const { lookup } = await FuzzyMatchCache.getOrFetch(
            `brands:all`,
            () => Brand.find({}).lean()
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

    if (data.categories) {
      const catNames = data.categories.split(',').map((s: string) => s.trim()).filter(Boolean);
      const catIds = (await Promise.all(catNames.map(async (n: string) => {
        const cat = await Category.findOne({ name: { $regex: `^${n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
        return cat?._id || null;
      }))).filter(Boolean);
      if (catIds.length > 0) productData.categories = catIds;
    }
    const product = new Product(productData);
    const saved = await product.save();

    await Promise.all([
    ]);

    // Ghi tag links vào bảng trung gian ProductTag (CHỈ dùng tag đã tồn tại trong DB)
    if (pendingTagSlugs.length > 0) {
      const tagDocs = await Tag.find({ slug: { $in: pendingTagSlugs } }).lean();
      const foundSlugs = new Set(tagDocs.map(t => t.slug));
      const skipped = pendingTagSlugs.filter(s => !foundSlugs.has(s));
      if (skipped.length > 0) {
        console.warn(`⚠️ [Tag] Skipping ${skipped.length} tag(s) not found in DB: ${skipped.join(', ')} — will NOT auto-create`);
      }
      const tagIds = tagDocs.map(t => t._id);
      if (tagIds.length > 0) {
        await ProductTag.insertMany(tagIds.map(tagId => ({ productId: saved._id, tagId })));
      }
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

      const variantsToInsert = data.variants.map((v: any, index: number) => ({
        productId: saved._id,
        size: v.size || '50ml',
        price: Number(v.price) || 0,
        quantityInStock: v.quantityInStock !== undefined ? Number(v.quantityInStock) : (v.quantity !== undefined ? Number(v.quantity) : 0),
        isDefault: index === defaultIndex,
        sortOrder: index,
      }));
      const insertedVariants = await ProductVariant.insertMany(variantsToInsert);
      const variantIds = insertedVariants.map(v => v._id);
      await Product.findOneAndUpdate({ _id: saved._id }, { $set: { variants: variantIds } });
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

        const variantsToInsert = parsed.map((item, index) => ({
          productId: saved._id,
          size: item.size,
          price: item.price,
          quantityInStock: item.quantityInStock !== undefined ? item.quantityInStock : (index === 0 ? (data.quantityInStock || 0) : 0),
          isDefault: index === defaultIndex,
          sortOrder: index
        }));
        const insertedVariants = await ProductVariant.insertMany(variantsToInsert);
        const variantIds = insertedVariants.map(v => v._id);
        await Product.findOneAndUpdate(
          { _id: saved._id },
          { $set: { variants: variantIds } }
        );
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

  static async duplicateProduct(id: string) {
    const original = await Product.findById(id).lean();
    if (!original) return null;

    const { _id, createdAt, updatedAt, __v, name, slug, ...rest } = original;
    const duplicatedName = `${name} (Copy)`;
    const slugName = `${slug}-copy-${Date.now().toString().slice(-4)}`;

    const newProduct = new Product({
      ...rest,
      name: duplicatedName,
      slug: slugName,
      status: 'draft',
    });
    const saved = await newProduct.save();

    const originalVariants = await ProductVariant.find({ productId: id }).lean();
    if (originalVariants.length > 0) {
      const newVariants = originalVariants.map(({ _id, createdAt, updatedAt, __v, productId, ...vRest }) => ({
        ...vRest,
        productId: saved._id,
      }));
      const insertedVariants = await ProductVariant.insertMany(newVariants);
      const newVariantIds = insertedVariants.map(v => v._id);
      await Product.updateOne({ _id: saved._id }, { $set: { variants: newVariantIds } });
    }

    const originalTags = await ProductTag.find({ productId: id }).lean();
    if (originalTags.length > 0) {
      const newTags = originalTags.map(({ _id, productId, ...tRest }) => ({
        ...tRest,
        productId: saved._id,
      }));
      await ProductTag.insertMany(newTags);
    }

    const originalImages = await ProductImage.find({ productId: id }).lean();
    if (originalImages.length > 0) {
      const newImages = originalImages.map(({ _id, productId, ...iRest }) => ({
        ...iRest,
        productId: saved._id,
      }));
      await ProductImage.insertMany(newImages);
    }

    await clearProductCache();

    return saved;
  }
}

/**
 * Helper: xóa toàn bộ cache product list
 */
async function clearProductCache(): Promise<void> {
  try {
    const keysToDelete = [
      `products:new:tag`,
      `products:new:tag:v3`,
      `products:limited:tag:v2`,
      `products:sale:tag`,
      `products:trending:tag`,
      `products:trending:tag:v3`,
    ];
    await Promise.all(keysToDelete.map(k => redis.del(k)));
  } catch (err) {
    console.warn('Failed to clear product caches:', err);
  }
}
