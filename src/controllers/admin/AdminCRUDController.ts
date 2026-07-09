import type { FastifyRequest, FastifyReply } from 'fastify';
import { UserRepository } from '../../repositories/UserRepository.ts';
import { Product } from '../../models/Product.ts';
import { Brand } from '../../models/Brand.ts';
import { Category } from '../../models/Category.ts';
import { ImageService } from '../../services/ImageService.ts';
import ejs from 'ejs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const v=join(dirname(fileURLToPath(import.meta.url)),'../../views');
function r(t:string,d:any={}){return ejs.render(readFileSync(join(v,t),'utf-8'),d,{views:[v]})}
async function ud(req:FastifyRequest){return UserRepository.findById((req as any).user?.userId)}
function m(d:any,t:string,p:string,c?:string){const n=d?.fullName||d?.username||'Admin';return{pageTitle:t,currentPage:p,userName:n,userInitials:(n.charAt(0)||'A').toUpperCase(),userRole:d?.role==='ADMIN'?'Quản trị viên':'Nhân viên',breadcrumb:c||''}}
function ren(reply:FastifyReply,mt:any,b:string,apiToken?:string){return reply.view('admin/layout.ejs',{...mt,body:b,apiToken:apiToken||''})}

export class AdminCRUDController {
  static async productList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'product',title:'Sản phẩm',apiEndpoint:'/api/products',itemsPath:'items',
      columns:[
        {key:'image',label:'Ảnh',render:'image',width:'60px'},
        {key:'name',label:'Tên sản phẩm'},
        {key:'price',label:'Giá',format:'currency'},
        {key:'quantityInStock',label:'Tồn kho'},
        {key:'soldCount',label:'Đã bán'},
      ],
      deleteEndpoint:'/admin/products/:id/delete',
      detailEndpoint:'/admin/products/:id',
      searchPlaceholder:'Tìm sản phẩm...',
    });
    const b=r('admin/crud/list.ejs',{apiToken,config});
    return ren(reply,m(u,'Sản phẩm','products','Quản lý Cửa hàng'),b,apiToken);
  }
  static async productDelete(req:FastifyRequest,reply:FastifyReply){await Product.findByIdAndDelete((req.params as any).id);return reply.redirect('/admin/products?toast=Đã+xóa+sản+phẩm&type=success')}

  static async productDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const productId=(req.params as any).id;
    const b=r('admin/crud/detail.ejs',{apiToken,productId});
    return ren(reply,m(u,'Chi tiết sản phẩm','products','Quản lý Cửa hàng'),b,apiToken);
  }

  static async brandList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'brand',title:'Thương hiệu',apiEndpoint:'/api/brands',itemsPath:'items',
      columns:[
        {key:'name',label:'Thương hiệu'},
        {key:'origin',label:'Xuất xứ'},
        {key:'status',label:'Trạng thái',render:'status',statusMap:{active:'Hoạt động'},colorMap:{active:'#22c55e'},fallbackStatus:'Ẩn',fallbackColor:'#ef4444'},
      ],
      deleteEndpoint:'/admin/brands/:id/delete',
      searchPlaceholder:'Tìm thương hiệu...',
    });
    const b=r('admin/crud/list.ejs',{apiToken,config});
    return ren(reply,m(u,'Thương hiệu','brands','Quản lý Cửa hàng'),b,apiToken);
  }
  static async brandDelete(req:FastifyRequest,reply:FastifyReply){await Brand.findByIdAndDelete((req.params as any).id);return reply.redirect('/admin/brands?toast=Đã+xóa+thương+hiệu&type=success')}

  static async categoryList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'category',title:'Danh mục',apiEndpoint:'/api/categories',itemsPath:'items',
      columns:[
        {key:'name',label:'Danh mục'},
        {key:'slug',label:'Slug'},
        {key:'status',label:'Trạng thái',render:'status',statusMap:{active:'Hoạt động'},colorMap:{active:'#22c55e'},fallbackStatus:'Ẩn',fallbackColor:'#ef4444'},
      ],
      deleteEndpoint:'/admin/categories/:id/delete',
      searchPlaceholder:'Tìm danh mục...',
    });
    const b=r('admin/crud/list.ejs',{apiToken,config});
    return ren(reply,m(u,'Danh mục','categories','Quản lý Cửa hàng'),b,apiToken);
  }
  static async categoryDelete(req:FastifyRequest,reply:FastifyReply){await Category.findByIdAndDelete((req.params as any).id);return reply.redirect('/admin/categories?toast=Đã+xóa+danh+mục&type=success')}

  /**
   * GET /admin/products/supplement — Trang bổ sung thông tin sản phẩm
   */
  static async productSupplement(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const b=r('admin/supplement.ejs',{apiToken});
    return ren(reply,m(u,'Bổ sung sản phẩm','products','Quản lý Cửa hàng'),b,apiToken);
  }

  /**
   * GET /admin/products/supplement/:id — Trang chi tiết bổ sung sản phẩm (có tương tác)
   */
  static async productSupplementDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const productId=(req.params as any).id;
    const b=r('admin/supplement-detail.ejs',{apiToken,productId,mode:'supplement'});
    return ren(reply,m(u,'Bổ sung sản phẩm','products','Quản lý Cửa hàng'),b,apiToken);
  }

  /**
   * GET /admin/products/:id/edit — Trang chỉnh sửa sản phẩm (full form)
   */
  static async productEdit(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const productId=(req.params as any).id;
    const b=r('admin/supplement-detail.ejs',{apiToken,productId,mode:'edit'});
    return ren(reply,m(u,'Chỉnh sửa sản phẩm','products','Quản lý Cửa hàng'),b,apiToken);
  }

  /**
   * POST /admin/products/cleanup-images — Xóa ảnh broken (URL không tồn tại trên R2) khỏi DB
   */
  static async cleanupProductImages(req: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await ImageService.cleanupInvalidProductImages();
      
      return reply.redirect(`/admin/products?toast=Đã+xóa+${result.removed}+URL+ảnh+không+hợp+lệ+(${result.fixedProducts}+sản+phẩm+được+sửa)&type=success`);
    } catch (error: any) {
      return reply.redirect('/admin/products?toast=Lỗi+xử+lý+ảnh&type=error');
    }
  }
}