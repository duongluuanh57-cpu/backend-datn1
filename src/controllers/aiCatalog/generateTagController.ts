import type { FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../../services/AIService.ts';
import { Tag } from '../../models/Tag.ts';

export async function generateTag(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { prompt } = req.body as { prompt: string };
    if (!prompt) return reply.status(400).send({ error: 'Prompt is required' });

    console.log(`🧠 [AI Workflow] Generating tag with Gemini for prompt: ${prompt}`);
    const geminiPrompt = `
You are an expert tag/taxonomy manager for a luxury perfume e-commerce system.
Based on the following description, generate a product tag with Vietnamese information.

Description: "${prompt}"

Your tasks:
1. Generate a tag name in Vietnamese (short, descriptive, e.g. "Hương gỗ", "Dịu nhẹ", "Cao cấp")
2. Generate an English slug from the name (lowercase, hyphens instead of spaces, no special chars)
3. Set status to "active"

Output STRICTLY a valid JSON object conforming to the schema below.
Do NOT include markdown code block syntax (like \`\`\`json). Just the raw JSON object.

JSON Schema:
{
  "name": "Tên tag bằng tiếng Việt",
  "slug": "ten-tag-bang-tieng-viet",
  "status": "active"
}
`;

    const response = await AIService.generateResponse(geminiPrompt, undefined, 'gemini-3.1-flash-lite');
    let jsonString = response.trim();

    if (jsonString.startsWith('`')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '');
    }

    const tagInfo = JSON.parse(jsonString.trim());
    return reply.status(200).send({ success: true, data: tagInfo });
  } catch (error: any) {
    console.error('AI Tag Generation Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}

export async function createTagFromAI(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { tagData } = req.body as { tagData: any };
    if (!tagData || !tagData.name || !tagData.slug) {
      return reply.status(400).send({ success: false, message: 'Missing required tag fields' });
    }

    const newTag = await Tag.create({
      name: tagData.name,
      slug: tagData.slug,
      status: tagData.status || 'active',
    });

    console.log(`✅ [AI Tag] Created tag ${newTag.name} (${newTag.slug})`);
    return reply.status(200).send({ success: true, data: newTag });
  } catch (error: any) {
    console.error('AI Create Tag Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}