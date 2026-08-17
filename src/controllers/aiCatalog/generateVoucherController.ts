import type { FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../../services/AIService.ts';
import { VoucherService } from '../../services/VoucherService.ts';

export async function generateVoucher(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { prompt } = req.body as { prompt: string };
    if (!prompt) return reply.status(400).send({ error: 'Prompt is required' });

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const defaultEnd = new Date(now);
    defaultEnd.setDate(defaultEnd.getDate() + 30);
    const defaultEndStr = defaultEnd.toISOString().split('T')[0];

    console.log(`🧠 [AI Workflow] Generating voucher with Gemini for prompt: ${prompt} (Current Date: ${todayStr})`);
    const geminiPrompt = `
You are an expert marketing promotions manager for a luxury perfume e-commerce system in Vietnam.
Today's actual date is: "${todayStr}".
The admin typed a voucher name/code or promotion idea: "${prompt}".
Analyze the voucher code/name and intelligently infer all the promotion parameters suitable for a luxury perfume brand in Vietnam.

Examples of inference:
- "GIARE50K" or "GIAM50K" -> fixed 50000 VND, min order 300000 VND, category: discount
- "FREESHIP", "FSEXPRESS" -> voucherCategory: freeship, type: fixed, value: 0, min order 200000 VND
- "VIPMEMBER" or "MEMBER10" -> applicableTo: membership, minTier: "MEMBER", type: percentage, value: 10, maxDiscount: 100000 VND
- "SUMMERSALE20" -> type: percentage, value: 20, maxDiscount: 200000 VND, description: "Ưu đãi mùa hè giảm 20%"
- "CHAOBANMOI" -> description: "Mã giảm giá chào mừng thành viên mới", min order 100000 VND

Your tasks:
1. "code": Uppercase clean voucher code (e.g. "${prompt}".toUpperCase() or clean version without spaces)
2. "description": A concise Vietnamese description (e.g. "Ưu đãi giảm 50.000đ cho đơn từ 300k")
3. "voucherCategory": "discount" (giảm giá tiền / %) or "freeship" (miễn phí vận chuyển)
4. "type": "percentage" (giảm theo %) or "fixed" (giảm số tiền cố định). If freeship, set "fixed"
5. "value": if freeship set 0; if percentage: integer 5-50 (5% to 50%); if fixed: amount in VND (e.g. 20000, 50000, 100000, 200000)
6. "minOrderAmount": reasonable minimum order in VND (e.g. 0, 100000, 200000, 500000)
7. "maxDiscount": if percentage, a reasonable max cap in VND (e.g. 50000, 100000, 200000); if fixed or freeship set null
8. "applicableTo": "all" (toàn sàn), "membership" (hạng thành viên), or "minigame" (mini game)
9. "minTier": if applicableTo is membership, choose one from "MEMBER", "Bac", "Vang", "KimCuong", otherwise null
10. "maxUsage": max number of usages (e.g. 50, 100, 500, or 0 for unlimited)
11. "startDate": "${todayStr}" (MUST BE today: ${todayStr})
12. "endDate": a date between 30 to 90 days from today (${todayStr})
13. "status": "active"

Output STRICTLY a valid JSON object matching this schema. No markdown wrapping.

JSON Schema:
{
  "code": "CODE",
  "description": "Mô tả",
  "voucherCategory": "discount",
  "type": "fixed",
  "value": 50000,
  "minOrderAmount": 300000,
  "maxDiscount": null,
  "applicableTo": "all",
  "minTier": null,
  "maxUsage": 100,
  "startDate": "${todayStr}",
  "endDate": "${defaultEndStr}",
  "status": "active"
}
`;

    const response = await AIService.generateResponse(geminiPrompt, undefined, 'gemini-3.1-flash-lite');
    let jsonString = response.trim();

    if (jsonString.startsWith('`')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '');
    }

    const voucherInfo = JSON.parse(jsonString.trim());

    // Sanitize dates to always ensure they are in the present / future
    if (!voucherInfo.startDate || new Date(voucherInfo.startDate) < new Date(todayStr)) {
      voucherInfo.startDate = todayStr;
    }
    if (!voucherInfo.endDate || new Date(voucherInfo.endDate) <= new Date(voucherInfo.startDate)) {
      voucherInfo.endDate = defaultEndStr;
    }

    return reply.status(200).send({ success: true, data: voucherInfo });
  } catch (error: any) {
    console.error('AI Voucher Generation Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
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