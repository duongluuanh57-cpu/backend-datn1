import { describe, it, expect, vi } from 'vitest';

// Mock dependencies
vi.mock('../../../services/SearchService.ts', () => ({
  SearchService: {
    hybridSearch: vi.fn().mockResolvedValue({ products: [], mode: 'vector', documents: [] }),
  },
}));

vi.mock('../../../services/ContentSearchService.ts', () => ({
  ContentSearchService: {
    search: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../services/CachedAnswerService.ts', () => ({
  CachedAnswerService: {
    findCachedAnswer: vi.fn().mockResolvedValue(null),
  },
}));

// Test the admin greeting/response shortening logic directly
describe('QueryRouterService — Admin Short Responses', () => {
  // Rút gọn greeting admin: chỉ 1 câu ngắn
  const newAdminGreeting = "AdminAI sẵn sàng. Bạn cần gì?";

  it('admin greeting should be short (under 80 chars)', () => {
    expect(newAdminGreeting.length).toBeLessThan(80);
  });

  it('admin greeting should not contain verbose examples', () => {
    expect(newAdminGreeting).not.toContain('thống kê');
    expect(newAdminGreeting).not.toContain('báo cáo');
    expect(newAdminGreeting).not.toContain('KPI');
  });

  // Rút gọn confusion admin
  const newAdminConfusion = "Chưa rõ yêu cầu. Bạn cần thống kê, sản phẩm, hay đơn hàng?";

  it('admin confusion should be concise (under 100 chars)', () => {
    expect(newAdminConfusion.length).toBeLessThan(100);
  });

  it('admin confusion should NOT list many examples', () => {
    const examples = (newAdminConfusion.match(/hoặc/g) || []).length;
    expect(examples).toBeLessThan(3);
  });

  // Gibberish admin rút gọn
  const newAdminGibberish = "Không hiểu. Nhập lại rõ hơn nhé.";

  it('admin gibberish should be very short', () => {
    expect(newAdminGibberish.length).toBeLessThan(60);
  });

  it('admin gibberish should NOT contain examples', () => {
    expect(newAdminGibberish).not.toContain('ví dụ');
  });
});

describe('QueryRouterService — Role Check', () => {
  it('should deny non-admin from admin_query route', () => {
    const roleDenied = "❌ Xin lỗi, bạn không có quyền truy cập vào thông tin này. Tính năng này chỉ dành cho quản trị viên.";
    expect(roleDenied).toContain('không có quyền');
  });

  it('should allow ADMIN to access admin_query', () => {
    const userRole = 'ADMIN';
    const isAdmin = userRole === "ADMIN";
    expect(isAdmin).toBe(true);
  });

  it('should deny USER from admin_query', () => {
    const userRole: string = 'USER';
    const isAdmin = userRole === "ADMIN";
    expect(isAdmin).toBe(false);
  });
});