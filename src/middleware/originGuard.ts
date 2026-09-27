import type { FastifyRequest, FastifyReply } from 'fastify';
import { isTrustedOrigin, isSameHostAsServer } from '../config/origins.ts';

/**
 * Vì sao cần guard này:
 * Cookie session chuyển sang SameSite=None (bắt buộc vì FE/Vercel và API/Render khác
 * site) nghĩa là trình duyệt sẽ gửi cookie cho MỌI request, kể cả request do trang
 * khác phát động. CORS không cứu được: CORS chỉ chặn bên tấn công ĐỌC response, còn
 * request thì vẫn tới server và vẫn mang cookie. Riêng POST `multipart/form-data` /
 * `application/x-www-form-urlencoded` còn là "simple request" — không preflight, nên
 * một form độc trên site lạ có thể ghi dữ liệu bằng danh tính nạn nhân.
 *
 * Origin là header do trình duyệt tự sinh, JS trang khác không giả mạo được. Vì vậy
 * request KHÔNG có Origin (server-to-server: VNPay IPN, webhook, cron, curl) được cho
 * qua — những request đó cũng không mang cookie session của browser. Origin có mặt mà
 * không khớp FE trong ALLOWED_ORIGINS, không phải chính host backend, hoặc parse không
 * được thì chặn.
 *
 * Chỉ soi method ghi: GET/HEAD là method đọc, OPTIONS đã @fastify/cors trả lời trước.
 *
 * Ngoại lệ: callback của bên thứ ba (VNPay IPN) do server của họ gọi. VNPay không gửi
 * header Origin, nhưng nếu một ngày họ có gửi thì chặn ở đây là âm thầm mất toàn bộ
 * xác nhận thanh toán. Route này đã tự bảo vệ bằng HMAC + check số tiền nên cho qua.
 */
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const THIRD_PARTY_CALLBACKS = new Set(['/api/payments/vnpay-ipn']);

export async function originGuard(req: FastifyRequest, reply: FastifyReply) {
  if (!STATE_CHANGING.has(req.method)) return;

  const pathname = req.url.split('?')[0];
  if (THIRD_PARTY_CALLBACKS.has(pathname)) return;

  const origin = req.headers.origin;
  if (!origin) return;

  if (isTrustedOrigin(origin) || isSameHostAsServer(origin, req.headers.host)) return;

  req.log.warn({ method: req.method, url: req.url, origin }, 'Chặn request có Origin lạ');
  return reply.status(403).send({
    success: false,
    message: 'Origin không được phép — vui lòng thao tác từ giao diện của site.',
  });
}
