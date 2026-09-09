/**
 * webSearchHelper — Tìm kiếm thông tin thực tế trên mạng về sản phẩm
 */
export async function searchWebForProduct(productName: string): Promise<string[]> {
  try {
    const query = `${productName} perfume limited edition`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    
    // Bóc tách các đoạn tóm tắt kết quả (snippet)
    const matches = html.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi) || [];
    const snippets = matches.map(m => {
      return m
        .replace(/^class="result__snippet"[^>]*>/i, '')
        .replace(/<\/a>$/i, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
    }).filter(s => s.length > 20).slice(0, 5);

    return snippets;
  } catch (err) {
    console.warn('⚠️ [WebSearch] Lỗi khi tra cứu trên mạng:', err);
    return [];
  }
}
