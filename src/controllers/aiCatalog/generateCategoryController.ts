import type { FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../../services/AIService.ts';
import { Category } from '../../models/Category.ts';

export async function generateCategory(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { prompt } = req.body as { prompt: string };
    if (!prompt) return reply.status(400).send({ error: 'Prompt is required' });

    console.log(`🧠 [AI Workflow] Generating category with Gemini for prompt: ${prompt}`);
    const geminiPrompt = `
You are an expert category manager for a luxury perfume e-commerce system.
Based on the following description, generate a product category with Vietnamese information.

Description: "${prompt}"

Your tasks:
1. Generate a category name in Vietnamese (short, descriptive, e.g. "Nước hoa Nam cao cấp")
2. Generate an English slug from the name (lowercase, hyphens instead of spaces, no special chars)
3. Set status to "active"

Output STRICTLY a valid JSON object conforming to the schema below.
Do NOT include markdown code block syntax (like \`\`\`json). Just the raw JSON object.

JSON Schema:
{
  "name": "Tên danh mục bằng tiếng Việt",
  "slug": "ten-danh-muc-bang-tieng-viet",
  "status": "active"
}
`;

    const response = await AIService.generateResponse(geminiPrompt, undefined, 'gemini-3.1-flash-lite');
    let jsonString = response.trim();

    if (jsonString.startsWith('`')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '');
    }

    const categoryInfo = JSON.parse(jsonString.trim());
    return reply.status(200).send({ success: true, data: categoryInfo });
  } catch (error: any) {
    console.error('AI Category Generation Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}

export async function createCategoryFromAI(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { categoryData } = req.body as { categoryData: any };
    if (!categoryData || !categoryData.name || !categoryData.slug) {
      return reply.status(400).send({ success: false, message: 'Missing required category fields' });
    }

    const newCategory = await Category.create({
      name: categoryData.name,
      slug: categoryData.slug,
      status: categoryData.status || 'active',
    });

    console.log(`✅ [AI Category] Created category ${newCategory.name} (${newCategory.slug})`);
    return reply.status(200).send({ success: true, data: newCategory });
  } catch (error: any) {
    console.error('AI Create Category Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}