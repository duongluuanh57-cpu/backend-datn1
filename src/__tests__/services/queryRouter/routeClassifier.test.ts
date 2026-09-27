import { describe, it, expect, vi } from 'vitest';

// classifyRoute cho guest không chạm DB/LLM; mock SearchService để an toàn cho nhánh ADMIN
vi.mock('../../../services/SearchService.ts', () => ({
  SearchService: {
    hybridSearch: vi.fn().mockResolvedValue({ products: [], brands: [], mode: 'general' }),
  },
  extractPriceRange: vi.fn().mockReturnValue(null),
}));

import { classifyRoute } from '../../../services/queryRouter/routeClassifier.ts';
import { normalize } from '../../../utils/textNormalizer.ts';

describe('RouteClassifier — Fast paths (test trên text đã normalize)', () => {
  it('"alo" KHÔNG bị coi là confusion → vector_search', async () => {
    const r = await classifyRoute({ message: 'alo', messages: [], userRole: undefined });
    expect(r.route).toBe('vector_search');
  });

  it('"anh ơi tư vấn giúp em" → vector_search', async () => {
    const r = await classifyRoute({ message: 'anh ơi tư vấn giúp em', messages: [], userRole: undefined });
    expect(r.route).toBe('vector_search');
  });

  it('"xin chào" → greeting', async () => {
    const r = await classifyRoute({ message: 'xin chào', messages: [], userRole: undefined });
    expect(r.route).toBe('greeting');
  });

  it('"ủa" → confusion', async () => {
    const r = await classifyRoute({ message: 'ủa', messages: [], userRole: undefined });
    expect(r.route).toBe('confusion');
  });

  it('"tại sao" → confusion', async () => {
    const r = await classifyRoute({ message: 'tại sao', messages: [], userRole: undefined });
    expect(r.route).toBe('confusion');
  });

  it('"ý là sao" → confusion', async () => {
    const r = await classifyRoute({ message: 'ý là sao', messages: [], userRole: undefined });
    expect(r.route).toBe('confusion');
  });

  it('"tìm nước hoa dưới 1 triệu" → vector_search', async () => {
    const r = await classifyRoute({ message: 'tìm nước hoa dưới 1 triệu', messages: [], userRole: undefined });
    expect(r.route).toBe('vector_search');
  });
});

describe('RouteClassifier — Admin Keywords', () => {
  // Regex admin keywords (không dấu) từ routeClassifier.ts, test trên normalize(message)
  const adminKeywords = /tao|them|xoa|sua|cap nhat|doi|thong ke|bao cao|doanh thu|don hang|brand|hang\s+\w+|san pham\s+moi|quan ly|san pham|product|danh muc|category|tag|nguoi dung|user|voucher|ma giam gia|bao nhieu|may|co may|liet ke|danh sach|ke ten|dem|tong|thuong hieu/i;

  it('should detect "tạo sản phẩm" as admin keyword', () => {
    expect(adminKeywords.test(normalize('tạo sản phẩm chanel'))).toBe(true);
  });

  it('should detect "thêm nước hoa" as admin keyword', () => {
    expect(adminKeywords.test(normalize('thêm nước hoa mới'))).toBe(true);
  });

  it('should detect "xóa sản phẩm" as admin keyword', () => {
    expect(adminKeywords.test(normalize('xóa sản phẩm ID 123'))).toBe(true);
  });

  it('should detect "sửa giá" as admin keyword', () => {
    expect(adminKeywords.test(normalize('sửa giá sản phẩm thành 500k'))).toBe(true);
  });

  it('should detect "cập nhật mô tả" as admin keyword', () => {
    expect(adminKeywords.test(normalize('cập nhật mô tả nước hoa'))).toBe(true);
  });

  it('should detect "thống kê doanh thu" as admin keyword', () => {
    expect(adminKeywords.test(normalize('thống kê doanh thu hôm nay'))).toBe(true);
  });

  it('should detect "báo cáo bán hàng" as admin keyword', () => {
    expect(adminKeywords.test(normalize('báo cáo bán hàng tháng này'))).toBe(true);
  });

  it('should detect "đơn hàng" as admin keyword', () => {
    expect(adminKeywords.test(normalize('đơn hàng đang xử lý'))).toBe(true);
  });

  it('ADMIN gửi "tạo sản phẩm chanel" → admin_query (rule-based)', async () => {
    const r = await classifyRoute({ message: 'tạo sản phẩm chanel', messages: [], userRole: 'ADMIN' });
    expect(r.route).toBe('admin_query');
    expect(r.requiresAdmin).toBe(true);
  });

  it('USER gửi "thêm nước hoa mới" → KHÔNG phải admin_query', async () => {
    const r = await classifyRoute({ message: 'thêm nước hoa mới vào giỏ', messages: [], userRole: 'USER' });
    expect(r.route).not.toBe('admin_query');
  });
});
