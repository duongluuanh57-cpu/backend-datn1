import type { FastifyRequest, FastifyReply } from 'fastify';
import { UserRepository } from '../../repositories/UserRepository.ts';
import { ProductService } from '../../services/ProductService.ts';
import { BrandService } from '../../services/BrandService.ts';
import { CategoryService } from '../../services/CategoryService.ts';
import { Brand } from '../../models/Brand.ts';
import { FlashSale } from '../../models/FlashSale.ts';
import { renderEjs, getCommonData, renderAdminPage } from '../../utils/viewHelpers.ts';

async function ud(req:FastifyRequest){return UserRepository.findById((req as any).user?.userId)}

export class AdminCRUDController {
  static async productList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const activeFlashSales = await FlashSale.find({ status: { $in: ['active', 'scheduled'] } }).select('name status').sort({ createdAt: -1 }).lean() as any[];
    const flashSaleOptions = activeFlashSales.map(fs => ({
      v: fs._id.toString(),
      l: fs.name,
      status: fs.status
    }));
    const config=JSON.stringify({
      entityName:'product',title:'Sản phẩm',apiEndpoint:'/api/products',itemsPath:'items',
      columns:[
        {key:'image',label:'Ảnh',render:'image',width:'60px'},
        {key:'name',label:'Tên sản phẩm'},
        {key:'price',label:'Giá',format:'currency'},
        {key:'quantityInStock',label:'Tồn kho'},
        {key:'soldCount',label:'Đã bán'},
        {key:'flashSale',label:'Sự kiện',render:'editableFlashSale',flashSaleOptions},
        {key:'status',label:'Trạng thái',render:'editableStatus'},
      ],
      deleteEndpoint:'/admin/products/:id/delete',
      bulkDeleteEndpoint:'/api/products/bulk-delete',
      detailEndpoint:'/admin/products/:id',
      searchPlaceholder:'Tìm sản phẩm...',
    });
    const b=renderEjs('admin/crud/list.ejs',{apiToken,config});
    return renderAdminPage(reply,u,'Sản phẩm','products',b,apiToken,'Quản lý Cửa hàng');
  }
  static async productDelete(req:FastifyRequest,reply:FastifyReply){await ProductService.deleteProduct((req.params as any).id);return reply.redirect('/admin/products?toast=Đã+xóa+sản+phẩm&type=success')}

  static async productDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const productId=(req.params as any).id;
    const b=renderEjs('admin/crud/detail.ejs',{apiToken,productId});
    return renderAdminPage(reply,u,'Chi tiết sản phẩm','products',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async brandList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'brand',title:'Thương hiệu',apiEndpoint:'/api/brands',itemsPath:'items',
      columns:[
        {key:'index',label:'STT',render:'rowIndex'},
        {key:'logo',label:'Logo',render:'image',width:'60px'},
        {key:'name',label:'Thương hiệu'},
        {key:'origin',label:'Xuất xứ'},
        {key:'status',label:'Trạng thái',render:'editableStatus',statusOptions:[{v:'active',l:'Hoạt động'},{v:'inactive',l:'Ẩn'}]},
      ],
      deleteEndpoint:'/admin/brands/:id/delete',
      bulkDeleteEndpoint:'/api/brands/bulk-delete',
      detailEndpoint:'/admin/brands/:id',
      searchPlaceholder:'Tìm thương hiệu...',
    });
    const b=renderEjs('admin/crud/list.ejs',{apiToken,config});
    return renderAdminPage(reply,u,'Thương hiệu','brands',b,apiToken,'Quản lý Cửa hàng');
  }
  static async brandDelete(req:FastifyRequest,reply:FastifyReply){await BrandService.deleteBrand((req.params as any).id);return reply.redirect('/admin/brands?toast=Đã+xóa+thương+hiệu&type=success')}

  static async brandDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const brandId=(req.params as any).id;
    const b=renderEjs('admin/crud/brand-detail.ejs',{apiToken,brandId});
    return renderAdminPage(reply,u,'Chi tiết thương hiệu','brands',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async brandCreate(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const b=renderEjs('admin/crud/brand-edit.ejs',{apiToken,brandId:'',IS_NEW:true});
    return renderAdminPage(reply,u,'Thêm thương hiệu mới','brands',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async brandEdit(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const brandId=(req.params as any).id;
    const b=renderEjs('admin/crud/brand-edit.ejs',{apiToken,brandId,IS_NEW:false});
    return renderAdminPage(reply,u,'Chỉnh sửa thương hiệu','brands',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async categoryList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'category',title:'Danh mục',apiEndpoint:'/api/categories',itemsPath:'items',
      columns:[
        {key:'index',label:'STT',render:'rowIndex'},
        {key:'name',label:'Danh mục'},
        {key:'slug',label:'Slug'},
        {key:'status',label:'Trạng thái',render:'editableStatus',statusOptions:[{v:'active',l:'Hoạt động'},{v:'inactive',l:'Ẩn'}],statusApiEndpoint:'/api/categories/:id'},
      ],
      deleteEndpoint:'/admin/categories/:id/delete',
      bulkDeleteEndpoint:'/api/categories/bulk-delete',
      detailEndpoint:'/admin/categories/:id',
      searchPlaceholder:'Tìm danh mục...',
    });
    const b=renderEjs('admin/crud/list.ejs',{apiToken,config});
    return renderAdminPage(reply,u,'Danh mục','categories',b,apiToken,'Quản lý Cửa hàng');
  }
  static async categoryDelete(req:FastifyRequest,reply:FastifyReply){await CategoryService.delete((req.params as any).id);return reply.redirect('/admin/categories?toast=Đã+xóa+danh+mục&type=success')}

  static async categoryCreate(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const b=renderEjs('admin/crud/category-edit.ejs',{apiToken,categoryId:'',IS_NEW:true});
    return renderAdminPage(reply,u,'Thêm danh mục mới','categories',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async categoryEdit(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const categoryId=(req.params as any).id;
    const b=renderEjs('admin/crud/category-edit.ejs',{apiToken,categoryId,IS_NEW:false});
    return renderAdminPage(reply,u,'Chỉnh sửa danh mục','categories',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async categoryDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const categoryId=(req.params as any).id;
    const b=renderEjs('admin/crud/category-detail.ejs',{apiToken,categoryId});
    return renderAdminPage(reply,u,'Chi tiết danh mục','categories',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async tagEdit(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const tagId=(req.params as any).id;
    const b=renderEjs('admin/crud/tag-edit.ejs',{apiToken,tagId});
    return renderAdminPage(reply,u,'Chỉnh sửa tag','tags',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async tagCreate(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const b=renderEjs('admin/crud/tag-edit.ejs',{apiToken,tagId:'',IS_NEW:true});
    return renderAdminPage(reply,u,'Thêm tag mới','tags',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async tagDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const tagId=(req.params as any).id;
    const b=renderEjs('admin/crud/tag-detail.ejs',{apiToken,tagId});
    return renderAdminPage(reply,u,'Chi tiết tag','tags',b,apiToken,'Quản lý Cửa hàng',null);
  }

  /**
   * GET /admin/products/create — Trang tạo sản phẩm mới (dùng layout supplement-detail với mode='edit')
   */
  static async productCreate(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const b=renderEjs('admin/supplement-detail.ejs',{apiToken,productId:'',mode:'edit',isNew:true});
    return renderAdminPage(reply,u,'Thêm sản phẩm mới','products',b,apiToken,'Quản lý Cửa hàng',null);
  }

  /**
   * GET /admin/products/supplement — Trang bổ sung thông tin sản phẩm
   */
  static async productSupplement(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const b=renderEjs('admin/supplement.ejs',{apiToken});
    return renderAdminPage(reply,u,'Bổ sung sản phẩm','products',b,apiToken,'Quản lý Cửa hàng');
  }

  /**
   * GET /admin/products/supplement/:id — Trang chi tiết bổ sung sản phẩm (có tương tác)
   */
  static async productSupplementDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const productId=(req.params as any).id;
    const b=renderEjs('admin/supplement-detail.ejs',{apiToken,productId,mode:'supplement'});
    return renderAdminPage(reply,u,'Bổ sung sản phẩm','products',b,apiToken,'Quản lý Cửa hàng');
  }

  /**
   * GET /admin/products/:id/edit — Trang chỉnh sửa sản phẩm (full form)
   */
  static async productEdit(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const productId=(req.params as any).id;
    const b=renderEjs('admin/supplement-detail.ejs',{apiToken,productId,mode:'edit'});
    return renderAdminPage(reply,u,'Chỉnh sửa sản phẩm','products',b,apiToken,'Quản lý Cửa hàng',null);
  }
}