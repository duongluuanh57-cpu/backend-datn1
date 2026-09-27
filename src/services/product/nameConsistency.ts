/**
 * So khớp tên sản phẩm với mô tả (của AI hoặc của dữ liệu đã import).
 * Dùng chung cho guard lúc generate và cho script dọn dữ liệu để hai bên không
 * mỗi đứa một định nghĩa "khớp".
 */

const GENERIC_NAME_WORDS = new Set([
  'edp', 'edt', 'edc', 'eau', 'parfum', 'de', 'la', 'le', 'les', 'pour', 'homme', 'femme',
  'limited', 'edition', 'nuoc', 'hoa', 'giftset', 'pcs', 'intense', 'extreme', 'new',
  'men', 'women', 'woman', 'man', 'ladies', 'for', 'of', 'and', 'the', 'one', 'du', 'et',
  // Từ chỉ quy cách đóng gói / dung tích: không phân biệt được chai nào với chai nào.
  'vial', 'decant', 'fullbox', 'mini', 'set', 'box', 'tester', 'batch',
]);

/** "3PCS", "100ml", "5075" — chữ số lẫn chữ cũng không phải định danh hương. */
function isPackagingToken(word: string): boolean {
  return /\d/.test(word) && /[a-z]/.test(word);
}

/** "Chloé"/"Chloe", "Idôle"/"Idole", "Lancôme"/"Lancome" là một — không gấp dấu thì báo nhầm. */
export function foldNameText(value: unknown): string {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function nameWords(value: unknown): string[] {
  return foldNameText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Từ đặc trưng của tên, đã trừ brand và các từ ai cũng có.
 * Brand không chứng minh được mô tả viết đúng chai: "Creed Spring Flower EDP" vẫn đầy chữ "Creed".
 */
export function distinctiveNameWords(name: unknown, brand: unknown): string[] {
  const brandWords = new Set(nameWords(brand));
  return nameWords(name).filter(
    w => w.length >= 3 && !GENERIC_NAME_WORDS.has(w) && !isPackagingToken(w) && !brandWords.has(w)
  );
}

/** Không có từ đặc trưng nào (vd "Nước hoa Chloe EDP") thì coi như khớp — so gì cũng vô nghĩa. */
export function descriptionMatchesName(description: unknown, signatureWords: string[]): boolean {
  if (signatureWords.length === 0) return true;
  const folded = foldNameText(description);
  const hit = signatureWords.filter(word => folded.includes(word)).length;
  return hit / signatureWords.length >= 0.5;
}
