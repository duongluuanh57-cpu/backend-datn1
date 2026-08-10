import { describe, it, expect } from 'vitest';

// We test the keyword detection logic directly since classifyRoute calls SearchService
// which requires DB. We test the regex patterns and admin keyword matching.

describe('RouteClassifier — Admin Keywords', () => {
  // Admin keywords from routeClassifier.ts line 169:
  const adminKeywords = /tạo|thêm|xóa|sửa|cập nhật|đổi|thống kê|báo cáo|doanh thu|đơn hàng|brand|hãng\s+\w+|sản phẩm\s+mới|quản lý/i;

  it('should detect "tạo sản phẩm" as admin keyword', () => {
    expect(adminKeywords.test('tạo sản phẩm chanel')).toBe(true);
  });

  it('should detect "thêm nước hoa" as admin keyword', () => {
    expect(adminKeywords.test('thêm nước hoa mới')).toBe(true);
  });

  it('should detect "xóa sản phẩm" as admin keyword', () => {
    expect(adminKeywords.test('xóa sản phẩm ID 123')).toBe(true);
  });

  it('should detect "sửa giá" as admin keyword', () => {
    expect(adminKeywords.test('sửa giá sản phẩm thành 500k')).toBe(true);
  });

  it('should detect "cập nhật mô tả" as admin keyword', () => {
    expect(adminKeywords.test('cập nhật mô tả nước hoa')).toBe(true);
  });

  it('should detect "thống kê doanh thu" as admin keyword', () => {
    expect(adminKeywords.test('thống kê doanh thu hôm nay')).toBe(true);
  });

  it('should detect "báo cáo bán hàng" as admin keyword', () => {
    expect(adminKeywords.test('báo cáo bán hàng tháng này')).toBe(true);
  });

  it('should detect "doanh thu" as admin keyword', () => {
    expect(adminKeywords.test('doanh thu 7 ngày qua')).toBe(true);
  });

  it('should detect "đơn hàng" as admin keyword', () => {
    expect(adminKeywords.test('đơn hàng đang xử lý')).toBe(true);
  });

  it('should detect "brand" as admin keyword', () => {
    expect(adminKeywords.test('brand chanel')).toBe(true);
  });

  it('should detect "hãng X" as admin keyword', () => {
    expect(adminKeywords.test('hãng dior có chưa')).toBe(true);
  });

  it('should detect "sản phẩm mới" as admin keyword', () => {
    expect(adminKeywords.test('sản phẩm mới hôm nay')).toBe(true);
  });

  it('should detect "quản lý" as admin keyword', () => {
    expect(adminKeywords.test('quản lý kho hàng')).toBe(true);
  });

  it('should NOT detect normal chat as admin keyword', () => {
    expect(adminKeywords.test('nước hoa nào thơm')).toBe(false);
    expect(adminKeywords.test('giá bao nhiêu')).toBe(false);
    expect(adminKeywords.test('cho mình hỏi')).toBe(false);
  });
});

describe('RouteClassifier — Fast Path Patterns', () => {
  const greetingPatterns = [
    /^(xin )?chào/i, /^hi+$/i, /^hello+$/i, /^hey+$/i,
    /^good (morning|afternoon|evening)/i,
    /^(chúc )?buổi (sáng|chiều|tối)/i,
    /^(bạn|mình) (có )?khỏe/i,
    /^(có ai|ai đó) (ở đây|không)/i,
    /^(cảm ơn|thanks|thank you)/i,
    /^tạm biệt|bye|goodbye/i,
  ];

  function isGreeting(text: string): boolean {
    return greetingPatterns.some(p => p.test(text));
  }

  it('should detect "chào" as greeting', () => {
    expect(isGreeting('chào')).toBe(true);
  });

  it('should detect "xin chào" as greeting', () => {
    expect(isGreeting('xin chào bạn')).toBe(true);
  });

  it('should detect "cảm ơn" as greeting', () => {
    expect(isGreeting('cảm ơn bạn nhé')).toBe(true);
  });

  it('should NOT detect product queries as greeting', () => {
    expect(isGreeting('nước hoa chanel')).toBe(false);
  });

  const confusionPatterns = [
    /^ủa+$/i, /^hả+$/i, /^gì(\s+vậy)?$/i,
    /^sao(\s+cơ)?$/i, /^ý(\s+là)?(\s+sao)?/i,
    /^cái(\s+gì)?$/i, /^đâu(\s+có)?/i,
    /^tại(\s+sao)?$/i, /^là(\s+sao)?$/i,
  ];

  function isConfusion(text: string): boolean {
    return confusionPatterns.some(p => p.test(text));
  }

  it('should detect "ủa" as confusion', () => {
    expect(isConfusion('ủa')).toBe(true);
  });

  it('should detect "hả" as confusion', () => {
    expect(isConfusion('hả')).toBe(true);
  });

  it('should detect "sao cơ" as confusion', () => {
    expect(isConfusion('sao cơ')).toBe(true);
  });
});