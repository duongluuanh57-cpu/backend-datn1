import type { FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../../services/AIService.ts';
import { VoucherService } from '../../services/VoucherService.ts';

export async function generateVoucher(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { prompt } = req.body as { prompt: string };
    if (!prompt) return reply.status(400).send({ error: 'Prompt is required' });

    console.log(`🧠 [AI Workflow] Generating voucher with Gemini for prompt: ${prompt}`);
    const geminiPrompt = `
You are an expert marketing promotions manager for a luxury perfume e-commerce system.
Based on the following description, generate a discount voucher/coupon with Vietnamese information.

Description: "${prompt}"

Your tasks:
1. Generate a short, memorable voucher code (uppercase letters and numbers, 5-10 chars, e.g. "SALE20", "WELCOME10")
2. Choose type: "percentage" (giảm theo %) or "fixed" (giảm số tiền cố định)
3. Set value: if percentage, 5-50; if fixed, 20000-500000 VND
4. Set minOrderAmount: reasonable minimum order amount
5. Set maxDiscount: if percentage, set a max discount cap
6. Set maxUsage: number of times this voucher can be used (0 = unlimited)
7. Generate startDate: today or a few days from now (ISO date string YYYY-MM-DD)
8. Generate endDate: 30-90 days from startDate (ISO date string YYYY-MM-DD)
9. Set status to "active"

Output STRICTLY a valid JSON object conforming to the schema below.
Do NOT include markdown code block syntax (like \`\`\`json). Just the raw JSON object.

JSON Schema:
{
  "code": "VOUCHERCODE",
  "type": "percentage" | "fixed",
  "value": 20,
  "minOrderAmount": 500000,
  "maxDiscount": 200000,
  "maxUsage": 100,
  "startDate": "2026-07-01",
  "endDate": "2026-08-30",
  "status": "active"
}
`;

    const response = await AIService.generateResponse(geminiPrompt, undefined, 'gemini-3.1-flash-lite');
    let jsonString = response.trim();

    if (jsonString.startsWith('`')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '');
    }

    const voucherInfo = JSON.parse(jsonString.trim());
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