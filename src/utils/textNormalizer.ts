/**
 * TextNormalizer — Shared text preprocessing pipeline
 *
 * Thay thế 4 hàm normalize/slugify đang duplicate trong codebase.
 * Cung cấp: normalize, slugify, tokenize, removeStopwords, normalizeForSearch
 */

// ── Vietnamese stopwords (common words that add noise to search/embedding) ──
const VIETNAMESE_STOPWORDS = new Set([
  'của', 'và', 'các', 'cho', 'cùng', 'có', 'được', 'để', 'từ', 'là',
  'này', 'đó', 'một', 'những', 'với', 'không', 'trong', 'đã', 'sẽ',
  'khi', 'còn', 'nhưng', 'hay', 'hoặc', 'đến', 'tại', 'trên', 'dưới',
  'sau', 'trước', 'về', 'theo', 'qua', 'lại', 'đang', 'rất', 'quá',
  'nào', 'gì', 'đều', 'cũng', 'vì', 'nếu', 'mà', 'bởi', 'do',
  'thì', 'vậy', 'hãy', 'nên', 'phải', 'đúng', 'sai', 'tốt', 'đẹp',
  'nhiều', 'ít', 'hơn', 'nhất', 'đây', 'đó', 'kia', 'nọ',
  'mình', 'tôi', 'tao', 'bạn', 'anh', 'chị', 'em', 'chúng',
  'xin', 'chào', 'hello', 'hi', 'hey', 'cảm ơn', 'thanks',
  'có', 'không', 'được', 'bị', 'phải', 'cần', 'muốn', 'thích',
  'nhà', 'nước', 'hoa', 'hương', 'thơm',  // too generic for perfume search
]);

// ── Perfume-specific abbreviations → full names ──
const PERFUME_ABBREVIATIONS: Record<string, string> = {
  'ck': 'Calvin Klein',
  'd&g': 'Dolce Gabbana',
  'dior': 'Christian Dior',
  'chanel': 'Chanel',
  'channel': 'Chanel',   // common typo
  'gucci': 'Gucci',
  'lv': 'Louis Vuitton',
  'tf': 'Tom Ford',
  'ysl': 'Yves Saint Laurent',
  'bj': 'Bombshell',
  'vs': 'Victoria Secret',
};

// ── Core functions ──

/**
 * Strip Vietnamese diacritics via Unicode NFD decomposition
 */
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalize text: lowercase + strip diacritics + trim
 * Dùng cho: fuzzy matching, comparison, dedup
 */
export function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Slugify: kebab-case from text
 * Dùng cho: URL slugs, tag slugs, category slugs
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

/**
 * Tokenize: split text into words, filter short words
 */
export function tokenize(text: string, minWordLength: number = 2): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= minWordLength);
}

/**
 * Remove Vietnamese stopwords from token list
 */
export function removeStopwords(tokens: string[]): string[] {
  return tokens.filter(t => !VIETNAMESE_STOPWORDS.has(t));
}

/**
 * Full search normalization pipeline:
 * lowercase → strip diacritics → remove punctuation → remove stopwords → join
 * Dùng trước khi embed hoặc search để giảm noise
 */
export function normalizeForSearch(text: string): string {
  const tokens = tokenize(text);
  const filtered = removeStopwords(tokens);
  return filtered.join(' ');
}

/**
 * Expand abbreviations/typos in text
 * Dùng trước khi embed để improve recall
 */
export function expandAbbreviations(text: string): string {
  let result = text.toLowerCase();
  for (const [abbr, full] of Object.entries(PERFUME_ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, full);
  }
  return result;
}

/**
 * Full preprocessing pipeline for embedding/search:
 * expand abbreviations → normalizeForSearch
 */
export function preprocessForEmbedding(text: string): string {
  const expanded = expandAbbreviations(text);
  return normalizeForSearch(expanded);
}
