/**
 * SynonymMap — Perfume domain synonyms + abbreviations + common typos
 *
 * Dùng cho: query rewriting, search expansion, brand resolution
 */

// ── Brand abbreviations / common typos → canonical name ──
const BRAND_SYNONYMS: Record<string, string> = {
  'ck': 'Calvin Klein',
  'calvin klein': 'Calvin Klein',
  'd&g': 'Dolce & Gabbana',
  'd g': 'Dolce & Gabbana',
  'dolce': 'Dolce & Gabbana',
  'dolce gabbana': 'Dolce & Gabbana',
  'dior': 'Christian Dior',
  'christian dior': 'Christian Dior',
  'chanel': 'Chanel',
  'channel': 'Chanel',       // common typo
  'chanal': 'Chanel',        // common typo
  'gucci': 'Gucci',
  'lv': 'Louis Vuitton',
  'louis vuitton': 'Louis Vuitton',
  'tf': 'Tom Ford',
  'tom ford': 'Tom Ford',
  'ysl': 'Yves Saint Laurent',
  'yves saint laurent': 'Yves Saint Laurent',
  'yves': 'Yves Saint Laurent',
  'bj': 'Bombshell',
  'bombshell': 'Bombshell',
  'vs': 'Victoria\'s Secret',
  'victoria secret': 'Victoria\'s Secret',
  'versace': 'Versace',
  'armani': 'Giorgio Armani',
  'giorgio armani': 'Giorgio Armani',
  'prada': 'Prada',
  'burberry': 'Burberry',
  'hermes': 'Hermès',
  'hermès': 'Hermès',
  'cartier': 'Cartier',
  'baccarat': 'Baccarat Rouge',
  'maison francis': 'Maison Francis Kurkdjian',
  'mFK': 'Maison Francis Kurkdjian',
  'le labo': 'Le Labo',
  'byredo': 'Byredo',
  'jo malone': 'Jo Malone',
  'jomalone': 'Jo Malone',
  'narciso': 'Narciso Rodriguez',
  'narciso rodriguez': 'Narciso Rodriguez',
};

// ── Perfume note synonyms (mùi hương) ──
const NOTE_SYNONYMS: Record<string, string[]> = {
  'fresh': ['fresh', 'mát', 'thanh lịch', 'sạch sẽ', 'dịu nhẹ'],
  'sweet': ['sweet', 'ngọt', 'dễ thương', 'bánh', 'kẹo'],
  'woody': ['woody', 'gỗ', 'gỗ đàn hương', 'gỗ trầm hương', 'warm'],
  'floral': ['floral', 'hoa', 'hoa hồng', 'hoa nhài', 'hoa cam', 'nữ tính'],
  'citrus': ['citrus', 'chanh', 'cam', 'bưởi', 'mọng', 'tươi'],
  'oriental': ['oriental', 'hương phương', 'hương liệu', 'nồng nàn', 'ấm'],
  'aquatic': ['aquatic', 'biển', 'nước', 'mưa', 'biển cả'],
  'spicy': ['spicy', 'cay', 'hạt tiêu', 'quế', 'hồi', 'nồng'],
  'powdery': ['powdery', 'bụi', 'mịn', 'powder', 'kem'],
  'green': ['green', 'xanh', 'lá', 'cỏ', 'tự nhiên', 'thảo mộc'],
  'fruity': ['fruity', 'trái cây', 'mọng', 'dâu', 'táo', 'đào'],
  'gourmand': ['gourmand', 'thức ăn', 'socola', 'vanilla', 'caramel'],
  'smoky': ['smoky', 'khói', 'thuốc lá', 'tobacco', 'burnt'],
  'musky': ['musky', 'xạ hương', 'musks', 'skin scent'],
};

// ── Occasion synonyms (dịp sử dụng) ──
const OCCASION_SYNONYMS: Record<string, string[]> = {
  'party': ['party', 'dạ tiệc', 'tối', 'đêm', 'lung linh'],
  'work': ['work', 'công sở', 'văn phòng', 'đi làm', 'chuyên nghiệp'],
  'daily': ['daily', 'hàng ngày', 'mỗi ngày', 'đi học', 'đi chơi'],
  'date': ['date', 'hẹn hò', 'gặp gỡ', 'lãng mạn'],
  'wedding': ['wedding', 'cưới', 'đám cưới', 'tiệc cưới'],
  'summer': ['summer', 'mùa hè', 'nóng', 'trời nắng'],
  'winter': ['winter', 'mùa đông', 'lạnh', 'trời lạnh'],
};

// ── Gender synonyms ──
const GENDER_SYNONYMS: Record<string, string[]> = {
  'nam': ['nam', 'men', 'boy', 'đàn ông', 'gentleman'],
  'nữ': ['nữ', 'women', 'girl', 'nữ giới', 'lady'],
  'unisex': ['unisex', 'genderless', 'cả nam nữ', 'ai cũng dùng được'],
};

/**
 * Resolve brand name từ text (abbreviation, typo, or full name)
 * Trả về canonical name hoặc null nếu không match
 */
export function resolveBrandName(input: string): string | null {
  const lower = input.toLowerCase().trim();
  const direct = BRAND_SYNONYMS[lower];
  if (direct) return direct;
  // Fuzzy: check partial match
  for (const [key, canonical] of Object.entries(BRAND_SYNONYMS)) {
    if (lower.includes(key) || key.includes(lower)) return canonical;
  }
  return null;
}

/**
 * Expand query với synonyms để improve search recall
 * Trả về query mới + các synonym terms
 */
export function expandQueryWithSynonyms(query: string): {
  expanded: string;
  synonyms: string[];
} {
  const lower = query.toLowerCase();
  const foundSynonyms: string[] = [];

  // Check note synonyms
  for (const [key, synonyms] of Object.entries(NOTE_SYNONYMS)) {
    if (lower.includes(key) || synonyms.some(s => lower.includes(s))) {
      foundSynonyms.push(...synonyms.filter(s => !lower.includes(s)));
    }
  }

  // Check occasion synonyms
  for (const [key, synonyms] of Object.entries(OCCASION_SYNONYMS)) {
    if (lower.includes(key) || synonyms.some(s => lower.includes(s))) {
      foundSynonyms.push(...synonyms.filter(s => !lower.includes(s)));
    }
  }

  // Check gender synonyms
  for (const [key, synonyms] of Object.entries(GENDER_SYNONYMS)) {
    if (lower.includes(key) || synonyms.some(s => lower.includes(s))) {
      foundSynonyms.push(...synonyms.filter(s => !lower.includes(s)));
    }
  }

  const uniqueSynonyms = [...new Set(foundSynonyms)].slice(0, 5);
  const expanded = uniqueSynonyms.length > 0
    ? `${query} ${uniqueSynonyms.join(' ')}`
    : query;

  return { expanded, synonyms: uniqueSynonyms };
}

/**
 * Get all brand synonyms as a flat map (dùng cho FuzzyMatchCache pre-seeding)
 */
export function getAllBrandSynonyms(): Record<string, string> {
  return { ...BRAND_SYNONYMS };
}
