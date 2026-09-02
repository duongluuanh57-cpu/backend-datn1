import { Article, IArticle } from '../../models/Article.ts';
import { NewsAutoPilotConfig, INewsAutoPilotConfig } from '../../models/NewsAutoPilotConfig.ts';
import { generateResponse } from '../ai/aiResponseService.ts';

// ── Curated high resolution luxury fragrance imagery ──
const CURATED_PERFUME_IMAGES: Record<string, string[]> = {
  KIENTHUC: [
    'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1547887537-6158d64c35b3?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1615655406736-b37c4fabf923?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=1200&q=80',
  ],
  XUHUONG: [
    'https://images.unsplash.com/photo-1523293182086-7651a899d37f?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1587017539504-67cfbddac569?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1592945403407-98e306564619?auto=format&fit=crop&w=1200&q=80',
  ],
  SANPHAM: [
    'https://images.unsplash.com/photo-1595425970377-c9703cf48b6d?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1508746829417-e6f548d8d6ed?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1583445013765-46c20c4a6772?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1563178406-4cdc2923acbc?auto=format&fit=crop&w=1200&q=80',
  ],
  SUKIEN: [
    'https://images.unsplash.com/photo-1616949755610-8c9bbc08f138?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1519669011783-4eaa95fa1b7d?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?auto=format&fit=crop&w=1200&q=80',
  ],
};

function getRandomImage(category: string): string {
  const list = CURATED_PERFUME_IMAGES[category] || CURATED_PERFUME_IMAGES.KIENTHUC;
  return list[Math.floor(Math.random() * list.length)];
}

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${base}-${Date.now().toString(36)}`;
}

export function calculateNextRunDate(config: INewsAutoPilotConfig, fromDate: Date = new Date()): Date {
  const next = new Date(fromDate);

  if (config.scheduleType === 'interval') {
    const hours = Math.max(1, config.intervalHours || 24);
    next.setHours(next.getHours() + hours);
    return next;
  }

  const [hoursStr, minsStr] = (config.scheduleTime || '08:00').split(':');
  const targetHour = parseInt(hoursStr, 10) || 8;
  const targetMin = parseInt(minsStr, 10) || 0;

  if (config.scheduleType === 'daily') {
    next.setHours(targetHour, targetMin, 0, 0);
    if (next.getTime() <= fromDate.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (config.scheduleType === 'weekly') {
    const allowedDays = config.scheduleDays?.length ? config.scheduleDays : [1, 3, 5]; // 1 = Mon ... 7 = Sun
    next.setHours(targetHour, targetMin, 0, 0);

    for (let i = 0; i <= 7; i++) {
      const dayOfWeek = next.getDay() === 0 ? 7 : next.getDay();
      if (allowedDays.includes(dayOfWeek) && next.getTime() > fromDate.getTime()) {
        return next;
      }
      next.setDate(next.getDate() + 1);
      next.setHours(targetHour, targetMin, 0, 0);
    }
    return next;
  }

  next.setDate(next.getDate() + 1);
  return next;
}

export async function getOrCreateAutoPilotConfig(): Promise<INewsAutoPilotConfig> {
  let config = await NewsAutoPilotConfig.findOne();
  if (!config) {
    config = await NewsAutoPilotConfig.create({
      isActive: false,
      topics: [
        'Nghệ thuật chọn nước hoa theo mùa và phong cách sống',
        'Khám phá thế giới nước hoa Niche và những nốt hương độc bản',
        'Bí quyết xịt và bảo quản nước hoa giữ mùi lâu hơn 12 giờ',
        'Top những nốt hương hoa cỏ và gỗ quý được yêu thích nhất',
        'Xu hướng mùi hương nước hoa Unisex hiện đại',
      ],
      categories: ['KIENTHUC', 'XUHUONG', 'SANPHAM'],
      scheduleType: 'daily',
      scheduleTime: '08:00',
      scheduleDays: [1, 3, 5],
      intervalHours: 24,
      publishMode: 'publish',
      autoFeatured: false,
      tone: 'luxury',
      authorName: "L'essence AI Editorial",
      totalGenerated: 0,
      logs: [],
    });
    config.nextRunAt = calculateNextRunDate(config);
    await config.save();
  }
  return config;
}

export interface GenerateArticleResult {
  success: boolean;
  article?: IArticle;
  message: string;
  error?: string;
}

export async function generateAutoArticle(options: {
  triggerType?: 'cron' | 'manual';
  customTopic?: string;
  customCategory?: 'KIENTHUC' | 'XUHUONG' | 'SANPHAM' | 'SUKIEN';
} = {}): Promise<GenerateArticleResult> {
  const config = await getOrCreateAutoPilotConfig();
  const triggerType = options.triggerType || 'manual';

  // Determine category & topic
  const categoriesPool = config.categories?.length ? config.categories : (['KIENTHUC', 'XUHUONG', 'SANPHAM'] as const);
  const category = options.customCategory || categoriesPool[Math.floor(Math.random() * categoriesPool.length)];

  const topicsPool = config.topics?.length ? config.topics : ['Nghệ thuật thưởng thức mùi hương'];
  const topic = options.customTopic || topicsPool[Math.floor(Math.random() * topicsPool.length)];

  const toneInstruction =
    config.tone === 'luxury'
      ? 'sang trọng, quý phái, ngôn từ tinh tế đẳng cấp hoàng gia'
      : config.tone === 'informative'
      ? 'chuyên sâu, khoa học mùi hương, phân tích nốt hương và cấu trúc tầng hương rõ ràng'
      : config.tone === 'storytelling'
      ? 'giàu cảm xúc, dẫn dắt câu chuyện quyến rũ và lãng mạn'
      : 'thân thiện, gần gũi, gợi ý thực tế và dễ áp dụng';

  const prompt = `
Bạn là Trưởng ban biên tập và Chuyên gia nước hoa cao cấp tại boutique "L'essence Parfumerie".
Hãy viết một bài viết tin tức / cẩm nang nước hoa hoàn chỉnh, chuyên nghiệp và hấp dẫn về chủ đề sau:

CHỦ ĐỀ: "${topic}"
DANH MỤC: "${category}" (KIENTHUC = Kiến thức mùi hương, XUHUONG = Xu hướng nước hoa, SANPHAM = Ra mắt sản phẩm, SUKIEN = Sự kiện & Ưu đãi)
PHONG CÁCH VĂN PHONG: ${toneInstruction}.

YÊU CẦU ĐỊNH DẠNG:
Trả về DUY NHẤT một chuỗi JSON hợp lệ (không kèm markdown ngoài JSON, không kèm giải thích thừa) theo cấu trúc chính xác sau:
{
  "title": "Tiêu đề bài viết thật cuốn hút, độ dài 50-80 ký tự, chuẩn SEO và khơi gợi sự tò mò",
  "summary": "Tóm tắt bài viết 2-3 câu ngắn gọn nhưng sâu sắc (100-150 từ)",
  "content": "Nội dung bài viết đầy đủ định dạng HTML chuẩn (dùng các thẻ <h2>, <h3>, <p>, <blockquote>, <ul>, <li>, <strong>). Độ dài bài viết khoảng 450 - 750 từ. Trình bày đẹp mắt như một bài tạp chí cao cấp với các tiêu đề mục rõ ràng, phân tích các nốt hương (Top Notes, Heart Notes, Base Notes) hoặc kinh nghiệm thực tế.",
  "category": "${category}",
  "tags": ["Từ khóa 1", "Từ khóa 2", "Từ khóa 3", "Từ khóa 4", "Nước hoa", "L'essence"]
}
`.trim();

  try {
    const rawAiResponse = await generateResponse(prompt, undefined, 'gemini-3.1-flash-lite');

    // Parse JSON
    let parsed: any = null;
    try {
      const cleaned = rawAiResponse
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // Try regex extract
      const jsonMatch = rawAiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('AI không phản hồi định dạng JSON hợp lệ: ' + rawAiResponse.slice(0, 150));
      }
    }

    if (!parsed.title || !parsed.summary || !parsed.content) {
      throw new Error('Thiếu dữ liệu bài viết bắt buộc từ AI.');
    }

    const title = parsed.title.trim();
    const slug = generateSlug(title);
    const summary = parsed.summary.trim();
    const content = parsed.content.trim();
    const thumbnail = getRandomImage(category);
    const tags = Array.isArray(parsed.tags) ? parsed.tags : [category, 'Nước hoa', 'L\'essence'];
    const isPublished = config.publishMode === 'publish';
    const featured = Boolean(config.autoFeatured);

    const wordCount = content.replace(/<[^>]+>/g, '').split(/\s+/).length;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    const newArticle = await Article.create({
      title,
      slug,
      summary,
      content,
      thumbnail,
      category,
      tags,
      author: {
        name: config.authorName || "L'essence AI Editorial",
      },
      views: Math.floor(Math.random() * 20) + 5,
      isPublished,
      featured,
      readingTimeMinutes,
      publishedAt: new Date(),
    });

    // Record Log & Update Stats
    const now = new Date();
    config.totalGenerated = (config.totalGenerated || 0) + 1;
    config.lastRunAt = now;
    config.nextRunAt = calculateNextRunDate(config, now);

    config.logs.unshift({
      triggeredAt: now,
      status: 'success',
      articleId: newArticle._id as any,
      articleTitle: newArticle.title,
      articleSlug: newArticle.slug,
      category: newArticle.category,
      triggerType,
    });

    // Keep maximum 50 logs
    if (config.logs.length > 50) {
      config.logs = config.logs.slice(0, 50);
    }

    await config.save();

    console.log(`🤖 [NewsAutoPilot] Successfully published article "${newArticle.title}" (ID: ${newArticle._id}, Trigger: ${triggerType})`);

    return {
      success: true,
      article: newArticle,
      message: `Đã tạo và ${isPublished ? 'xuất bản' : 'lưu nháp'} bài viết thành công: "${newArticle.title}"`,
    };
  } catch (err: any) {
    console.error('❌ [NewsAutoPilot] Generation failed:', err);

    // Record failure log
    const now = new Date();
    config.lastRunAt = now;
    config.nextRunAt = calculateNextRunDate(config, now);
    config.logs.unshift({
      triggeredAt: now,
      status: 'failed',
      category,
      triggerType,
      error: err.message || 'Lỗi không xác định khi sinh bài viết AI',
    });
    if (config.logs.length > 50) {
      config.logs = config.logs.slice(0, 50);
    }
    await config.save();

    return {
      success: false,
      message: 'Không thể tạo bài viết tự động',
      error: err.message || 'Unknown error',
    };
  }
}
