import type { FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../../services/AIService.ts';
import { UserRepository } from '../../repositories/UserRepository.ts';

export async function generateUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { prompt } = req.body as { prompt: string };
    if (!prompt) return reply.status(400).send({ error: 'Prompt is required' });

    console.log(`🧠 [AI Workflow] Generating user info with Gemini for prompt: ${prompt}`);
    const geminiPrompt = `
You are an expert user account manager for a luxury e-commerce system.
Based on the following description, generate a SINGLE user account with realistic information.

Description: "${prompt}"

Your tasks:
1. Generate a valid username (lowercase, no spaces, unique-sounding)
2. Generate a realistic email address
3. Generate a random secure password (8-16 chars, mix of letters and numbers)
4. Choose an appropriate role: "USER", "ADMIN", or "SUBADMIN"
5. Choose status: "active"
6. Generate a full Vietnamese name in fullName field
7. Generate a Vietnamese phone number (starts with 0, 10 digits)

Output STRICTLY a valid JSON object conforming to the schema below.
Do NOT include markdown code block syntax (like \`\`\`json). Just the raw JSON object.

JSON Schema:
{
  "username": "generated_username",
  "email": "generated_email@example.com",
  "password": "generated_password",
  "role": "USER" | "ADMIN" | "SUBADMIN",
  "status": "active",
  "fullName": "Full Vietnamese Name",
  "phoneNumber": "0123456789"
}
`;

    const response = await AIService.generateResponse(geminiPrompt, undefined, 'gemini-3.1-flash-lite');
    let jsonString = response.trim();

    if (jsonString.startsWith('`')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '');
    }

    const userInfo = JSON.parse(jsonString.trim());
    return reply.status(200).send({ success: true, data: userInfo });
  } catch (error: any) {
    console.error('AI User Generation Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}

export async function createUserFromAI(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { userData } = req.body as { userData: any };
    if (!userData || !userData.username || !userData.email || !userData.password) {
      return reply.status(400).send({ success: false, message: 'Missing required user fields' });
    }
    const bcrypt = await import('bcryptjs');

    const passwordHash = await bcrypt.hash(userData.password, 10);

    const newUser = await UserRepository.create({
      username: userData.username,
      email: userData.email,
      passwordHash,
      role: userData.role || 'USER',
      status: userData.status || 'active',
      fullName: userData.fullName || '',
      phoneNumber: userData.phoneNumber || '',
    });

    console.log(`✅ [AI User] Created user ${newUser.username} (${newUser.email})`);
    return reply.status(200).send({ success: true, data: newUser });
  } catch (error: any) {
    console.error('AI Create User Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}