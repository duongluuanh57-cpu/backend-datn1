import type { FastifyRequest, FastifyReply } from 'fastify';
import { generateText } from 'ai';
import { AIService } from '../../services/AIService.ts';
import { VoucherService } from '../../services/VoucherService.ts';
import { getGoogleProvider } from '../../services/ai/aiInteractionService.ts';

const expansionsCache = new Map<string, { timestamp: number; data: any[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

export async function generateVoucher(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { prompt } = req.body as { prompt: string };
    if (!prompt) return reply.status(400).send({ error: 'Prompt is required' });

    const now = new Date();
    const currentYear = now.getFullYear();
    const todayStr = now.toISOString().split('T')[0];
    const defaultEnd = new Date(now);
    defaultEnd.setDate(defaultEnd.getDate() + 30);
    const defaultEndStr = defaultEnd.toISOString().split('T')[0];

    console.log(`🧠 [AI Workflow] Generating voucher with Gemini for prompt: ${prompt} (Current Date: ${todayStr}, Year: ${currentYear})`);
    const geminiPrompt = `
You are an expert marketing promotions manager for a luxury perfume e-commerce brand in Vietnam.
Today's actual date is: "${todayStr}" (Current Year: ${currentYear}).
The admin typed a voucher name/code or promotion idea: "${prompt}".
Analyze the voucher code/name and intelligently infer all the promotion parameters suitable for a luxury perfume brand in Vietnam.

CRITICAL DATE & EVENT INTELLIGENCE:
Determine if the prompt/code refers to a specific calendar date, double-day mega sale, holiday, or seasonal event:
- Double day flash sales:
  * "9THANG9", "9.9", "MEGA99", "SALE99", "SIEUDEAL99" -> startDate: "${currentYear}-09-09", endDate: "${currentYear}-09-12" (3-day mega sale)
  * "10THANG10", "10.10" -> startDate: "${currentYear}-10-10", endDate: "${currentYear}-10-13"
  * "11THANG11", "11.11" -> startDate: "${currentYear}-11-11", endDate: "${currentYear}-11-14"
  * "12THANG12", "12.12" -> startDate: "${currentYear}-12-12", endDate: "${currentYear}-12-15"
- Vietnamese holidays & seasonal campaigns:
  * "20THANG10", "PHUNUVN" -> startDate: "${currentYear}-10-18", endDate: "${currentYear}-10-21"
  * "8THANG3", "QUOCTEPHUNU" -> startDate: "${currentYear}-03-05", endDate: "${currentYear}-03-09"
  * "NOEL", "GIANGSINH", "XMAS" -> startDate: "${currentYear}-12-20", endDate: "${currentYear}-12-26"
  * "BLACKFRIDAY", "BF" -> startDate: "${currentYear}-11-25", endDate: "${currentYear}-11-30"
  * "TET", "NEWYEAR" -> Lunar New Year / New Year period
- If the event date for the current year (${currentYear}) has already passed relative to today (${todayStr}), set the year to ${currentYear + 1}.
- If the event date is upcoming in ${currentYear}, use ${currentYear}.
- If the voucher is for membership or mini game ("applicableTo": "membership" or "minigame"):
  * It has NO fixed calendar start or end date (it operates continuously based on dynamic tier/spin)!
  * Set "validityDays": number of days valid after claiming (e.g. 30 for membership, 7 for minigame).
  * Set "startDate": null, "endDate": null.
- If the voucher code has NO specific date implied and applicableTo is "all":
  Set "startDate": "${todayStr}", "endDate": "${defaultEndStr}".

Other parameter rules:
1. "code": Uppercase clean voucher code (e.g. "${prompt}".toUpperCase() or clean version without spaces)
2. "voucherCategory": "discount" (giảm giá tiền / %) or "freeship" (miễn phí vận chuyển)
3. "type": "percentage" (giảm theo %) or "fixed" (giảm số tiền cố định). If freeship, set "fixed"
4. "value": if freeship set 0; if percentage: integer 5-50 (5% to 50%); if fixed: amount in VND (e.g. 20000, 50000, 100000, 200000)
5. "minOrderAmount": reasonable minimum order in VND (e.g. 0, 300000, 500000, 1000000, 2000000)
6. "maxDiscount": if percentage, a reasonable max cap in VND (e.g. 50000, 100000, 200000, 500000); if fixed or freeship set null
7. "applicableTo": "all" (toàn sàn), "membership" (hạng thành viên), or "minigame" (mini game)
8. "minTier": if applicableTo is membership, choose one from "MEMBER", "Bac", "Vang", "KimCuong", otherwise null
9. "validityDays": if applicableTo is "membership" or "minigame", set integer days (e.g. 30 for membership, 7 for minigame), otherwise null
10. "maxUsage": max number of usages (MUST BE between 10 and 100, MAXIMUM 100 usages, e.g. 20, 50, 100. NEVER exceed 100)
11. "startDate": "YYYY-MM-DD" or null (if membership or minigame)
12. "endDate": "YYYY-MM-DD" (strictly after startDate) or null (if membership or minigame)
13. "status": "active"

Output STRICTLY a valid JSON object matching this schema. No markdown wrapping.

JSON Schema:
{
  "code": "CODE",
  "voucherCategory": "discount",
  "type": "fixed",
  "value": 50000,
  "minOrderAmount": 300000,
  "maxDiscount": null,
  "applicableTo": "all",
  "minTier": null,
  "validityDays": null,
  "maxUsage": 100,
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "status": "active"
}
`;

    const response = await AIService.generateResponse(geminiPrompt, undefined, 'gemini-3.1-flash-lite');
    let jsonString = response.trim();

    if (jsonString.startsWith('`')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '');
    }

    const voucherInfo = JSON.parse(jsonString.trim());

    // Cap maxUsage to maximum 100
    if (voucherInfo.maxUsage !== undefined && voucherInfo.maxUsage !== null) {
      const numUsage = Number(voucherInfo.maxUsage);
      voucherInfo.maxUsage = isNaN(numUsage) || numUsage <= 0 ? 100 : Math.min(100, Math.max(1, Math.round(numUsage)));
    } else {
      voucherInfo.maxUsage = 100;
    }

    // Membership or Mini Game vouchers have no fixed calendar dates
    if (voucherInfo.applicableTo === 'membership' || voucherInfo.applicableTo === 'minigame') {
      voucherInfo.validityDays = Number(voucherInfo.validityDays) || (voucherInfo.applicableTo === 'membership' ? 30 : 7);
      voucherInfo.startDate = null;
      voucherInfo.endDate = null;
      return reply.status(200).send({ success: true, data: voucherInfo });
    }

    // Sanitize dates intelligently
    const todayMidnight = new Date(`${todayStr}T00:00:00Z`);
    if (!voucherInfo.startDate || isNaN(new Date(voucherInfo.startDate).getTime())) {
      voucherInfo.startDate = todayStr;
    } else {
      const sDateStr = voucherInfo.startDate.split('T')[0];
      const sDateObj = new Date(`${sDateStr}T00:00:00Z`);
      if (sDateObj < todayMidnight) {
        // If the date passed this year (e.g. March when it's September), bump to next year
        const [y, m, d] = sDateStr.split('-');
        if (m && d) {
          const nextYearDate = new Date(`${currentYear + 1}-${m}-${d}T00:00:00Z`);
          voucherInfo.startDate = nextYearDate > todayMidnight ? `${currentYear + 1}-${m}-${d}` : todayStr;
        } else {
          voucherInfo.startDate = todayStr;
        }
      } else {
        voucherInfo.startDate = sDateStr;
      }
    }

    if (
      !voucherInfo.endDate ||
      isNaN(new Date(voucherInfo.endDate).getTime()) ||
      new Date(voucherInfo.endDate) <= new Date(voucherInfo.startDate)
    ) {
      const s = new Date(voucherInfo.startDate);
      s.setDate(s.getDate() + 7);
      voucherInfo.endDate = s.toISOString().split('T')[0];
    } else {
      voucherInfo.endDate = voucherInfo.endDate.split('T')[0];
    }

    return reply.status(200).send({ success: true, data: voucherInfo });
  } catch (error: any) {
    console.error('AI Voucher Generation Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}

export async function suggestVoucherIdeas(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { topic } = ((req.body as any) || {}) as { topic?: string };
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentYear = now.getFullYear();

    const prompt = `
You are a luxury perfume e-commerce marketing director for "L'essence" in Vietnam.
Today's actual date: "${todayStr}" (Current Year: ${currentYear}).
Admin's requested campaign theme (optional): "${topic || 'Các chiến dịch khuyến mãi hot nhất, sáng tạo nhất phù hợp với thời điểm hiện tại'}".

Generate 6 high-converting, creative voucher / promotional campaign ideas for luxury perfumes.
Include varied campaign types:
1. Double-day or seasonal event (e.g. 9/9 Mega Sale, Thu Đông, Giáng Sinh, 20/10)
2. Free shipping (e.g. Freeship Hỏa Tốc, Freeship đơn từ 500k)
3. VIP member reward (e.g. Gold, Diamond tier special discount)
4. New member welcome voucher
5. High-basket incentive (e.g. Giảm lớn cho đơn từ 2 triệu)
6. Weekend Flash Sale or Trending Scent promo

Each idea must have:
- "code": UPPERCASE alphanumeric code without spaces (e.g. "MEGA99", "FREESHIPHOATOC", "VIPLUXURY", "HUONGTHU", "CHAOBANMOI", "SEXYNIGHT")
- "title": Attractive short title in Vietnamese (max 8 words)
- "description": Clear Vietnamese description detailing the offer and terms
- "badge": Short badge string (e.g. "HOT 9/9", "FREESHIP", "VIP", "MỚI", "FLASH SALE")
- "voucherCategory": "discount" or "freeship"
- "type": "percentage" or "fixed" (if freeship: "fixed" and value: 0)
- "value": integer (if percentage: 5 to 30; if fixed: 30000 to 300000; if freeship: 0)
- "minOrderAmount": integer in VND (e.g. 0, 300000, 500000, 1000000, 2000000)
- "maxDiscount": integer in VND or null (for percentage only)
- "applicableTo": "all" or "membership"
- "minTier": if applicableTo is membership, one of "MEMBER", "Bac", "Vang", "KimCuong", otherwise null
- "maxUsage": integer between 20 and 100 (maximum 100 usages, e.g. 30, 50, 100. NEVER exceed 100)
- "startDate": "YYYY-MM-DD" (smartly inferred, e.g. 9/9 campaign starts on 2026-09-09)
- "endDate": "YYYY-MM-DD" (strictly after startDate, e.g. 2026-09-12)

Output STRICTLY a valid JSON array of 6 items. No markdown wrapping.
`;

    const response = await AIService.generateResponse(prompt, undefined, 'gemini-3.1-flash-lite');
    let jsonString = response.trim();
    if (jsonString.startsWith('`')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '');
    }
    const ideas = JSON.parse(jsonString.trim());
    const sanitizedIdeas = (Array.isArray(ideas) ? ideas : [ideas]).map((item: any) => ({
      ...item,
      maxUsage: Math.min(100, Math.max(1, Number(item.maxUsage) || 100)),
    }));
    return reply.status(200).send({ success: true, data: sanitizedIdeas });
  } catch (err: any) {
    console.error('AI Suggest Voucher Ideas Error:', err);
    const now = new Date();
    const currentYear = now.getFullYear();
    const fallbackIdeas = [
      {
        code: 'MEGA99',
        title: 'Siêu Sale Ngày Đôi 9.9',
        description: 'Giảm 9% tối đa 150.000đ cho đơn nước hoa từ 1.200.000đ dịp 9.9',
        badge: 'HOT 9/9',
        voucherCategory: 'discount',
        type: 'percentage',
        value: 9,
        minOrderAmount: 1200000,
        maxDiscount: 150000,
        applicableTo: 'all',
        minTier: null,
        maxUsage: 100,
        startDate: `${currentYear}-09-09`,
        endDate: `${currentYear}-09-12`,
      },
      {
        code: 'FREESHIPHOATOC',
        title: 'Miễn Phí Vận Chuyển Hỏa Tốc',
        description: 'Freeship toàn quốc cho đơn hàng nước hoa từ 500.000đ',
        badge: 'FREESHIP',
        voucherCategory: 'freeship',
        type: 'fixed',
        value: 0,
        minOrderAmount: 500000,
        maxDiscount: null,
        applicableTo: 'all',
        minTier: null,
        maxUsage: 100,
        startDate: now.toISOString().split('T')[0],
        endDate: new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0],
      },
      {
        code: 'VIPGOLD200K',
        title: 'Đặc Quyền Thành Viên Vàng',
        description: 'Giảm ngay 200.000đ cho khách hàng hạng Vàng trở lên với đơn từ 2.000.000đ',
        badge: 'VIP GOLD',
        voucherCategory: 'discount',
        type: 'fixed',
        value: 200000,
        minOrderAmount: 2000000,
        maxDiscount: null,
        applicableTo: 'membership',
        minTier: 'Vang',
        maxUsage: 50,
        startDate: now.toISOString().split('T')[0],
        endDate: new Date(now.getTime() + 60 * 86400000).toISOString().split('T')[0],
      },
      {
        code: 'CHAOBANMOI',
        title: 'Chào Đón Thành Viên Mới',
        description: 'Giảm ngay 50.000đ cho đơn hàng đầu tiên từ 400.000đ',
        badge: 'NEW MEMBER',
        voucherCategory: 'discount',
        type: 'fixed',
        value: 50000,
        minOrderAmount: 400000,
        maxDiscount: null,
        applicableTo: 'all',
        minTier: null,
        maxUsage: 100,
        startDate: now.toISOString().split('T')[0],
        endDate: new Date(now.getTime() + 90 * 86400000).toISOString().split('T')[0],
      },
      {
        code: 'HUONGTHUDONG',
        title: 'Bộ Sưu Tập Nước Hoa Thu Đông',
        description: 'Giảm 12% tối đa 250.000đ cho các dòng nước hoa ấm áp mùa Thu Đông',
        badge: 'MÙA MỚI',
        voucherCategory: 'discount',
        type: 'percentage',
        value: 12,
        minOrderAmount: 1500000,
        maxDiscount: 250000,
        applicableTo: 'all',
        minTier: null,
        maxUsage: 100,
        startDate: now.toISOString().split('T')[0],
        endDate: new Date(now.getTime() + 45 * 86400000).toISOString().split('T')[0],
      },
      {
        code: 'LUXURY500K',
        title: 'Đơn Hàng Thượng Lưu',
        description: 'Giảm ngay 500.000đ cho đơn hàng nước hoa Niche từ 5.000.000đ',
        badge: 'ĐẲNG CẤP',
        voucherCategory: 'discount',
        type: 'fixed',
        value: 500000,
        minOrderAmount: 5000000,
        maxDiscount: null,
        applicableTo: 'all',
        minTier: null,
        maxUsage: 30,
        startDate: now.toISOString().split('T')[0],
        endDate: new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0],
      }
    ];
    return reply.status(200).send({ success: true, data: fallbackIdeas });
  }
}

export async function suggestCodeExpansions(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { prefix } = (req.body as any) || {};
    const cleanPrefix = String(prefix || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanPrefix || cleanPrefix.length < 2) {
      return reply.status(200).send({ success: true, data: [] });
    }

    // 1. Check in-memory cache for instant (0ms) response
    const cached = expansionsCache.get(cleanPrefix);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return reply.status(200).send({ success: true, data: cached.data });
    }

    const currentYear = new Date().getFullYear();

    const prompt = `
You are an expert luxury perfume marketing copywriter in Vietnam for brand "L'essence".
Admin is typing voucher code prefix: "${cleanPrefix}". The current year is ${currentYear}.
Invent 5 distinct promotional campaign voucher codes that EXPAND upon "${cleanPrefix}".

Rules:
1. "code": UPPERCASE alphanumeric, NO spaces, NO accents. MUST start with "${cleanPrefix}". Pure Vietnamese without accents (e.g. AMAP, VUIVE, RANGRO, QUATANG, TRIAN, DONNAMMOI, BUNGNO, UUDAI, GIAONHANH, THUONGLUU). NO French words. If year is mentioned, MUST be ${currentYear}.
2. "label": Tiêu đề tiếng Việt có dấu ngắn gọn (tối đa 5 từ).
3. "desc": Mô tả ưu đãi tiếng Việt có dấu ngắn gọn (tối đa 12 từ).

Output STRICTLY JSON array of objects. No markdown.
`;

    const provider = getGoogleProvider();
    const result = await generateText({
      model: provider('gemini-2.5-flash-lite'),
      prompt,
    });

    let jsonString = result.text.trim();
    if (jsonString.startsWith('`')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '');
    }
    let data = JSON.parse(jsonString.trim());
    if (!Array.isArray(data)) data = [data];

    // Post-process to guarantee current year and clean Vietnamese codes
    data = data.map((item: any) => {
      let code = String(item.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      code = code.replace(/202[0-5]/g, String(currentYear)); // replace any outdated 2020-2025 with currentYear
      let label = String(item.label || '').replace(/202[0-5]/g, String(currentYear));
      let desc = String(item.desc || '').replace(/202[0-5]/g, String(currentYear));
      return {
        code,
        label,
        desc,
      };
    });

    // Cache the result
    expansionsCache.set(cleanPrefix, { timestamp: Date.now(), data });

    return reply.status(200).send({ success: true, data });
  } catch (err: any) {
    console.error('Suggest Code Expansions Error:', err);
    return reply.status(200).send({ success: true, data: [] });
  }
}

export async function createVoucherFromAI(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { voucherData } = req.body as { voucherData: any };
    if (!voucherData || !voucherData.code || !voucherData.type || voucherData.value === undefined) {
      return reply.status(400).send({ success: false, message: 'Missing required voucher fields' });
    }

    const newVoucher = await VoucherService.create({
      code: voucherData.code,
      type: voucherData.type,
      value: voucherData.value,
      minOrderAmount: voucherData.minOrderAmount || 0,
      maxDiscount: voucherData.maxDiscount,
      maxUsage: voucherData.maxUsage || 0,
      startDate: voucherData.startDate,
      endDate: voucherData.endDate,
    });

    console.log(`✅ [AI Voucher] Created voucher ${newVoucher.code}`);
    return reply.status(200).send({ success: true, data: newVoucher });
  } catch (error: any) {
    console.error('AI Create Voucher Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}