/**
 * OrderController — Barrel file (re-export từ các module nhỏ hơn)
 *
 * File này được giữ lại để backward compatibility.
 * Code thực tế đã được tách vào thư mục `controllers/order/`:
 *   - orderHelpers.ts          → requireAdmin, enhanceItemsWithProductData, recalculateTotalAmount, buildDateFilter
 *   - orderUserController.ts   → getMyOrders, getOrderById
 *   - orderAdminController.ts  → getAllOrdersForAdmin, getOrderByIdForAdmin, updateOrderStatus, updatePaymentStatus, deleteOrder
 */
export { requireAdmin, enhanceItemsWithProductData, recalculateTotalAmount, buildDateFilter } from './order/orderHelpers.ts';
export { getMyOrders, getOrderById } from './order/orderUserController.ts';
export { getAllOrdersForAdmin, getOrderByIdForAdmin, updateOrderStatus, updatePaymentStatus, deleteOrder } from './order/orderAdminController.ts';

// Re-import cho backward-compatible class
import { getMyOrders as _getMyOrders, getOrderById as _getOrderById } from './order/orderUserController.ts';
import { getAllOrdersForAdmin as _getAllOrdersForAdmin, getOrderByIdForAdmin as _getOrderByIdForAdmin, updateOrderStatus as _updateOrderStatus, updatePaymentStatus as _updatePaymentStatus, deleteOrder as _deleteOrder } from './order/orderAdminController.ts';

import type { FastifyRequest, FastifyReply } from 'fastify';

// ============================================================
// Backward-compatible OrderController class
// ============================================================
export class OrderController {
  static async getMyOrders(req: FastifyRequest, reply: FastifyReply) {
    return _getMyOrders(req, reply);
  }
  static async getOrderById(req: FastifyRequest, reply: FastifyReply) {
    return _getOrderById(req, reply);
  }
  static async getAllOrdersForAdmin(req: FastifyRequest, reply: FastifyReply) {
    return _getAllOrdersForAdmin(req, reply);
  }
  static async getOrderByIdForAdmin(req: FastifyRequest, reply: FastifyReply) {
    return _getOrderByIdForAdmin(req, reply);
  }
  static async updateOrderStatus(req: FastifyRequest, reply: FastifyReply) {
    return _updateOrderStatus(req, reply);
  }
  static async updatePaymentStatus(req: FastifyRequest, reply: FastifyReply) {
    return _updatePaymentStatus(req, reply);
  }
  static async deleteOrder(req: FastifyRequest, reply: FastifyReply) {
    return _deleteOrder(req, reply);
  }
}