import type { FastifyRequest, FastifyReply } from 'fastify';
import { Order } from '../../models/Order.ts';
import { Voucher } from '../../models/Voucher.ts';
import { Review } from '../../models/Review.ts';
import { UserRepository } from '../../repositories/UserRepository.ts';
import { renderEjs, getCommonData, renderAdminPage } from '../../utils/viewHelpers.ts';
import { VoucherService } from '../../services/VoucherService.ts';

async function ud(req:FastifyRequest){return UserRepository.findById((req as any).user?.userId)}

export class AdminCRUDControllerPart2 {
  static async orderList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'order',title:'Đơn hàng',apiEndpoint:'/api/orders/admin/orders',itemsPath:'orders',totalPath:'pagination.total',totalPagesPath:'pagination.totalPages',
      columns:[
        {key:'index',label:'STT',render:'rowIndex'},
        {key:'shippingInfo.customerName',label:'Khách hàng'},
        {key:'totalAmount',label:'Tổng tiền',format:'currency'},
        {key:'status',label:'Trạng thái',render:'editableStatus',statusApiEndpoint:'/api/orders/admin/:id/status',statusOptions:[{v:'pending',l:'Chờ xác nhận'},{v:'processing',l:'Đang xử lý'},{v:'shipped',l:'Đang giao hàng'},{v:'delivered',l:'Hoàn thành'},{v:'cancelled',l:'Đã hủy'}]},
        {key:'cancelRequested',label:'Y/c hủy',render:'cancelRequest'},
        {key:'createdAt',label:'Ngày',format:'date'},
      ],
      detailEndpoint:'/admin/orders/:id',
      searchPlaceholder:'Tên, email, SĐT...',
    });
    const b=renderEjs('admin/crud/list.ejs',{apiToken,config});
    return renderAdminPage(reply,u,'Đơn hàng','orders',b,apiToken,'Quản lý Cửa hàng');
  }
  static async orderDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const orderId=(req.params as any).id;
    const apiEndpoint='/api/orders/admin/'+orderId;
    const b=renderEjs('admin/crud/orders-detail.ejs',{apiToken,apiEndpoint});
    return renderAdminPage(reply,u,'Chi tiết đơn','orders',b,apiToken,'Quản lý Cửa hàng');
  }
  static async voucherList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'voucher',title:'Mã giảm giá',apiEndpoint:'/api/vouchers',itemsPath:'',
      columns:[
        {key:'index',label:'STT',render:'rowIndex'},
        {key:'code',label:'Mã'},
        {key:'value',label:'Giá trị',render:'voucherValue'},
        {key:'applicableTo',label:'Phân loại',render:'voucherApplicableTo'},
        {key:'status',label:'Trạng thái',render:'editableStatus',statusOptions:[{v:'active',l:'Hoạt động'},{v:'inactive',l:'Ẩn'}],statusApiEndpoint:'/api/vouchers/:id'},
        {key:'remaining',label:'Lượt dùng'},
      ],
      detailEndpoint:'/admin/vouchers/:id',
      deleteEndpoint:'/admin/vouchers/:id/delete',
      searchPlaceholder:'Tìm mã...',
    });
    const b=renderEjs('admin/crud/list.ejs',{apiToken,config});
    return renderAdminPage(reply,u,'Mã giảm giá','vouchers',b,apiToken,'Quản lý Cửa hàng');
  }
  static async voucherDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const voucherId=(req.params as any).id;
    const b=renderEjs('admin/crud/voucher-detail.ejs',{apiToken,voucherId});
    return renderAdminPage(reply,u,'Chi tiết mã giảm giá','vouchers',b,apiToken,'Quản lý Cửa hàng',null);
  }
  static async voucherCreate(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const b=renderEjs('admin/crud/voucher-edit.ejs',{apiToken,voucherId:'',IS_NEW:true});
    return renderAdminPage(reply,u,'Thêm mã giảm giá mới','vouchers',b,apiToken,'Quản lý Cửa hàng',null);
  }
  static async voucherEdit(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const voucherId=(req.params as any).id;
    const b=renderEjs('admin/crud/voucher-edit.ejs',{apiToken,voucherId,IS_NEW:false});
    return renderAdminPage(reply,u,'Chỉnh sửa mã giảm giá','vouchers',b,apiToken,'Quản lý Cửa hàng',null);
  }
  static async voucherDelete(req:FastifyRequest,reply:FastifyReply){
    try {
      await VoucherService.delete((req.params as any).id);
      return reply.redirect('/admin/vouchers?toast=Đã+xóa+mã+giảm+giá&type=success');
    } catch (err: any) {
      return reply.redirect('/admin/vouchers?toast=' + encodeURIComponent(err.message || 'Không thể xóa mã giảm giá') + '&type=error');
    }
  }
  static async userList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'user',title:'Người dùng',apiEndpoint:'/api/users?role=USER',itemsPath:'items',
      columns:[
        {key:'index',label:'STT',render:'rowIndex'},
        {key:'username',label:'Username'},
        {key:'email',label:'Email'},
        {key:'fullName',label:'Họ tên'},
        {key:'phoneNumber',label:'SĐT'},
        {key:'status',label:'Trạng thái',render:'status',statusMap:{active:'Hoạt động',suspended:'Khóa',unverified:'Chưa KH'},colorMap:{active:'#22c55e',suspended:'#ef4444',unverified:'#f59e0b'},fallbackStatus:'—',fallbackColor:'#94a3b8'},
      ],
      deleteEndpoint:'/admin/users/:id/delete',
      searchPlaceholder:'Tìm người dùng...',
    });
    const b=renderEjs('admin/crud/list.ejs',{apiToken,config});
    return renderAdminPage(reply,u,'Người dùng','users',b,apiToken,'Quản lý Cửa hàng');
  }

  static async systemUserList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'user',title:'Quản lý quản trị viên',apiEndpoint:'/api/users?role=ADMIN',itemsPath:'items',
      columns:[
        {key:'index',label:'STT',render:'rowIndex'},
        {key:'username',label:'Username'},
        {key:'email',label:'Email'},
        {key:'role',label:'Quyền',render:'role'},
        {key:'status',label:'Trạng thái',render:'status',statusMap:{active:'Hoạt động',suspended:'Khóa',unverified:'Chưa KH'},colorMap:{active:'#22c55e',suspended:'#ef4444',unverified:'#f59e0b'},fallbackStatus:'—',fallbackColor:'#94a3b8'},
      ],
      deleteEndpoint:'/admin/users/:id/delete',
      searchPlaceholder:'Tìm quản trị viên...',
    });
    const b=renderEjs('admin/crud/list.ejs',{apiToken,config});
    return renderAdminPage(reply,u,'Quản lý quản trị viên','system-users',b,apiToken,'Hệ thống');
  }

  static async userDelete(req:FastifyRequest,reply:FastifyReply){await UserRepository.delete((req.params as any).id);return reply.redirect('/admin/users?toast=Đã+xóa+người+dùng&type=success')}


  static async reviewList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const config=JSON.stringify({
      entityName:'review',title:'Đánh giá',apiEndpoint:'/api/reviews/all',itemsPath:'reviews',totalPath:'total',totalPagesPath:'totalPages',
      columns:[
        {key:'index',label:'STT',render:'rowIndex'},
        {key:'productId',label:'Sản phẩm',render:'reviewProduct'},
        {key:'userId',label:'Người dùng',render:'reviewUser'},
        {key:'rating',label:'Sao'},
        {key:'status',label:'Trạng thái',render:'editableStatus',statusApiEndpoint:'/api/reviews/:id/moderate',statusOptions:[{v:'visible',l:'Hiển thị'},{v:'rejected',l:'Không được duyệt'}],statusMap:{visible:'Hiển thị',hidden:'Ẩn',pending:'Chờ duyệt AI',rejected:'Không được duyệt'},fallbackStatus:'Ẩn'},
        {key:'createdAt',label:'Ngày',format:'date'},
      ],
      detailEndpoint:'/admin/reviews/:id',
      searchPlaceholder:'Tên SP, email...',
    });
    const b=renderEjs('admin/crud/list.ejs',{apiToken,config});
    return renderAdminPage(reply,u,'Đánh giá','reviews',b,apiToken,'Quản lý Cửa hàng');
  }

  static async reviewDetail(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const reviewId=(req.params as any).id;
    const b=renderEjs('admin/crud/review-detail.ejs',{apiToken,reviewId});
    return renderAdminPage(reply,u,'Chi tiết đánh giá','reviews',b,apiToken,'Quản lý Cửa hàng');
  }

  static async reviewModerate(req:FastifyRequest,reply:FastifyReply){
    const {id}=req.params as {id:string};
    const review=await Review.findById(id);
    if(!review) return reply.redirect('/admin/reviews?toast=Không+tìm+thấy+đánh+giá&type=error');
    review.status=review.status==='visible'?'hidden':'visible';
    await review.save();
    const msg=review.status==='visible'?'Đã+hiện+đánh+giá':'Đã+ẩn+đánh+giá';
    return reply.redirect('/admin/reviews/'+id+'?toast='+msg+'&type=success');
  }

  static async flashSaleList(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const b=renderEjs('admin/crud/flash-sale-list.ejs',{apiToken});
    return renderAdminPage(reply,u,'Sự kiện Flash Sale','flash-sales',b,apiToken,'Quản lý Cửa hàng');
  }

  static async flashSaleCreate(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const b=renderEjs('admin/crud/flash-sale-edit.ejs',{apiToken,flashSaleId:'',IS_NEW:true});
    return renderAdminPage(reply,u,'Tạo đợt Flash Sale mới','flash-sales',b,apiToken,'Quản lý Cửa hàng',null);
  }

  static async flashSaleEdit(req:FastifyRequest,reply:FastifyReply){
    const u=await ud(req);const apiToken=(req as any).token||'';
    const flashSaleId=(req.params as any).id;
    const b=renderEjs('admin/crud/flash-sale-edit.ejs',{apiToken,flashSaleId,IS_NEW:false});
    return renderAdminPage(reply,u,'Chỉnh sửa đợt Flash Sale','flash-sales',b,apiToken,'Quản lý Cửa hàng',null);
  }
}
