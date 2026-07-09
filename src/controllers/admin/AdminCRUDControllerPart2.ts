import type { FastifyRequest, FastifyReply } from 'fastify';
import { Order } from '../../models/Order.ts';
import { Voucher } from '../../models/Voucher.ts';
import { UserRepository } from '../../repositories/UserRepository.ts';
import ejs from 'ejs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const v=join(dirname(fileURLToPath(import.meta.url)),'../../views');
function r(t:string,d:any={}){return ejs.render(readFileSync(join(v,t),'utf-8'),d,{views:[v]})}
async function ud(req:FastifyRequest){return UserRepository.findById((req as any).user?.userId)}
function m(d:any,t:string,p:string,c?:string){const n=d?.fullName||d?.username||'Admin';return{pageTitle:t,currentPage:p,userName:n,userInitials:(n.charAt(0)||'A').toUpperCase(),userRole:d?.role==='ADMIN'?'Quản trị viên':'Nhân viên',breadcrumb:c||''}}
function ren(reply:FastifyReply,mt:any,b:string,apiToken?:string){return reply.view('admin/layout.ejs',{...mt,body:b,apiToken:apiToken||''})}

export class AdminCRUDControllerPart2 {
  static async orderList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'order',title:'Đơn hàng',apiEndpoint:'/api/orders/admin/orders',itemsPath:'orders',totalPath:'pagination.total',totalPagesPath:'pagination.totalPages',
      columns:[
        {key:'customerName',label:'Khách hàng'},
        {key:'totalAmount',label:'Tổng tiền',format:'currency'},
        {key:'status',label:'Trạng thái',render:'orderStatus'},
        {key:'createdAt',label:'Ngày',format:'date'},
      ],
      detailEndpoint:'/admin/orders/:id',
      searchPlaceholder:'Tên, email, SĐT...',
    });
    const b=r('admin/crud/list.ejs',{apiToken,config});
    return ren(reply,m(u,'Đơn hàng','orders','Quản lý Cửa hàng'),b,apiToken);
  }
  static async orderDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const orderId=(req.params as any).id;
    const apiEndpoint='/api/orders/admin/'+orderId;
    const b=r('admin/crud/orders-detail.ejs',{apiToken,apiEndpoint});
    return ren(reply,m(u,'Chi tiết đơn','orders','Quản lý Cửa hàng'),b,apiToken);
  }
  static async voucherList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'voucher',title:'Mã giảm giá',apiEndpoint:'/api/vouchers',itemsPath:'',
      columns:[
        {key:'code',label:'Mã'},
        {key:'value',label:'Giá trị',render:'voucherValue'},
        {key:'status',label:'Trạng thái',render:'status',statusMap:{active:'Hoạt động'},colorMap:{active:'#22c55e'},fallbackStatus:'Ẩn',fallbackColor:'#ef4444'},
        {key:'maxUsage',label:'Lượt dùng'},
      ],
      deleteEndpoint:'/admin/vouchers/:id/delete',
      searchPlaceholder:'Tìm mã...',
    });
    const b=r('admin/crud/list.ejs',{apiToken,config});
    return ren(reply,m(u,'Mã giảm giá','vouchers','Quản lý Cửa hàng'),b,apiToken);
  }
  static async voucherDelete(req:FastifyRequest,reply:FastifyReply){await Voucher.findByIdAndDelete((req.params as any).id);return reply.redirect('/admin/vouchers?toast=Đã+xóa+mã+giảm+giá&type=success')}
  static async userList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'user',title:'Người dùng',apiEndpoint:'/api/users',itemsPath:'items',
      columns:[
        {key:'username',label:'Username'},
        {key:'email',label:'Email'},
        {key:'role',label:'Role',render:'role'},
        {key:'status',label:'Trạng thái',render:'status',statusMap:{active:'Hoạt động',suspended:'Khóa',unverified:'Chưa KH'},colorMap:{active:'#22c55e',suspended:'#ef4444',unverified:'#f59e0b'},fallbackStatus:'—',fallbackColor:'#94a3b8'},
      ],
      deleteEndpoint:'/admin/users/:id/delete',
      searchPlaceholder:'Tìm người dùng...',
    });
    const b=r('admin/crud/list.ejs',{apiToken,config});
    return ren(reply,m(u,'Người dùng','users','Hệ thống'),b,apiToken);
  }
  static async userDelete(req:FastifyRequest,reply:FastifyReply){await UserRepository.delete((req.params as any).id);return reply.redirect('/admin/users?toast=Đã+xóa+người+dùng&type=success')}
}
