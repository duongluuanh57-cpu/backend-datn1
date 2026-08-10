/**
 * Query Router Types — định nghĩa kiểu dữ liệu cho Query Routing
 */

/** 4 route chính + routes đặc biệt */
export type RouteType =
  | 'vector_search'      // Tìm theo mùi hương, cảm xúc (Vector Search)
  | 'sql_search'         // Tìm theo tên, hãng, giá (MongoDB keyword)
  | 'web_search'         // Tra cứu web (tin tức, xu hướng)
  | 'graph_search'       // Tra cứu đồ thị (gợi ý liên quan)
  | 'admin_query'        // Câu hỏi quản trị (dành cho ADMIN/SUBADMIN)
  | 'greeting'           // Chào hỏi — không cần AI
  | 'confusion'          // User không hiểu — response mềm mỏng
  | 'gibberish';         // Vô nghĩa — hỏi lại lịch sự

/** User role */
export type UserRole = 'USER' | 'ADMIN' | 'SUBADMIN' | undefined;

/** Route nào yêu cầu role gì */
export const ROUTE_ROLE_MAP: Partial<Record<RouteType, UserRole[]>> = {
  // Admin-only routes (dùng chung web_search & graph_search nhưng thêm context admin)
  // Các route public không cần check
};

/** Input cho Query Router */
export interface RouteInput {
  message: string;
  messages: any[];
  image?: string;
  userRole: UserRole;
  userId?: string;
  userName?: string;
}

/** Output từ Query Router */
export interface RouteResult {
  type: 'direct' | 'stream';
  content?: string;
  streamResponse?: Response;
  error?: string;
  products?: any[];
}

/** Kết quả phân loại route */
export interface RouteClassification {
  route: RouteType;
  confidence: number;
  /** Nếu là admin/secret, router có thể inject context bổ sung */
  requiresAdmin?: boolean;
}

/** Context cho từng route */
export interface RouteContext {
  products: any[];
  documents: any[];
  mode: string;
  storeOverview: string;
  historyContext: string;
  adaptiveDirective: string;
}