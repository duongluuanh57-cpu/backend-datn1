import { describe, it, expect } from 'vitest';
import {
  descriptionMatchesName,
  distinctiveNameWords,
  foldNameText,
} from '../../../services/product/nameConsistency.ts';

describe('foldNameText', () => {
  it('bỏ dấu để Chloé khớp với Chloe', () => {
    expect(foldNameText('Chloé Idôle Lancôme')).toBe('chloe idole lancome');
  });

  it('giữ nguyên chữ thường và số', () => {
    expect(foldNameText('Boss Bottled 3PCS')).toBe('boss bottled 3pcs');
  });
});

describe('distinctiveNameWords', () => {
  it('bỏ brand và từ chung, giữ từ định danh của chai', () => {
    expect(distinctiveNameWords('Creed Aventus Absolu Limited Edition EDP', 'Creed')).toEqual(['aventus', 'absolu']);
  });

  it('bỏ cả từ quy cách đóng gói và token có chữ số', () => {
    expect(distinctiveNameWords('Vial Jimmy Choo Man Extreme EDP', 'Jimmy Choo')).toEqual([]);
    expect(distinctiveNameWords('Giftset Lancome Idole Power EDP 3PCS', 'Lancome')).toEqual(['idole', 'power']);
  });

  it('brand không chứng minh được gì: hai chai cùng Creed vẫn khác nhau', () => {
    expect(distinctiveNameWords('Creed Spring Flower EDP', 'Creed')).toEqual(['spring', 'flower']);
  });
});

describe('descriptionMatchesName', () => {
  const descWrong =
    '**Mô tả hương thơm:** Creed Spring Flower EDP là hiện thân của sự tươi mới, dịu dàng với đào và hoa hồng.';
  const descRight =
    '**Mô tả hương thơm:** Creed Aventus Absolu mở đầu bằng dứa và quả mọng, kết thúc bằng gỗ khói và long diên hương.';

  it('mô tả kể về chai khác thì không khớp', () => {
    expect(descriptionMatchesName(descWrong, ['aventus', 'absolu'])).toBe(false);
  });

  it('mô tả đúng chai thì khớp', () => {
    expect(descriptionMatchesName(descRight, ['aventus', 'absolu'])).toBe(true);
  });

  it('tên không còn từ định danh nào thì coi như khớp, không có cơ sở mà bỏ', () => {
    expect(descriptionMatchesName(descWrong, [])).toBe(true);
  });

  it('khớp một phần vẫn đạt nếu từ 50% số từ định danh', () => {
    // 2/3 từ -> đạt; 1/4 từ -> không đạt.
    expect(descriptionMatchesName('Lancome Idole Power mang đến luồng gió mới', ['idole', 'power', 'aventus'])).toBe(true);
    expect(descriptionMatchesName('Lancome Idole mang đến luồng gió mới', ['idole', 'power', 'nectar', 'aventus'])).toBe(false);
  });
});
