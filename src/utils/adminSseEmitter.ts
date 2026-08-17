/**
 * adminSseEmitter.ts
 * Singleton quản lý danh sách SSE connections của admin panel.
 * Khi có đơn hàng mới, gọi emitNewOrder() để push event đến tất cả admin đang mở trang.
 */

import type { FastifyReply } from 'fastify';

interface SseClient {
  id: string;
  reply: FastifyReply;
}

const clients: Map<string, SseClient> = new Map();

/** Thêm một admin SSE client mới */
export function addSseClient(id: string, reply: FastifyReply) {
  clients.set(id, { id, reply });
}

/** Xóa client khi đóng kết nối */
export function removeSseClient(id: string) {
  clients.delete(id);
}

/** Mask tên người dùng: giữ 2 ký tự đầu + *** + 2 ký tự cuối */
export function maskUsername(name: string): string {
  if (!name) return '***';
  const trimmed = name.trim();
  if (trimmed.length <= 4) return trimmed[0] + '***';
  const parts = trimmed.split(' ');
  // Nếu họ tên 2+ từ: mask từng từ giữa
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    const maskFirst = first.length > 2 ? first[0] + '*'.repeat(first.length - 1) : first;
    const maskLast = last.length > 2 ? last[0] + '*'.repeat(last.length - 2) + last[last.length - 1] : last;
    return maskFirst + ' ' + maskLast;
  }
  // Tên đơn: giữ 2 đầu + *** + 1 cuối
  return trimmed.slice(0, 2) + '***' + trimmed.slice(-1);
}

/**
 * Push thông báo đơn hàng mới đến tất cả admin SSE clients
 */
export function emitNewOrder(payload: {
  orderId: string;
  username: string;   // Tên gốc — sẽ được mask ở đây
  amount: number;
}) {
  const maskedName = maskUsername(payload.username);
  const data = JSON.stringify({
    type: 'new_order',
    orderId: payload.orderId,
    maskedName,
    amount: payload.amount,
    time: new Date().toISOString(),
  });

  const deadClients: string[] = [];
  for (const [id, client] of clients) {
    try {
      (client.reply.raw as any).write(`data: ${data}\n\n`);
    } catch {
      deadClients.push(id);
    }
  }
  // Dọn dẹp client đã ngắt kết nối
  for (const id of deadClients) clients.delete(id);
}

export function getSseClientCount() {
  return clients.size;
}
