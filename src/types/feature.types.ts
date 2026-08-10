import { z } from 'zod';

export const AIPromptSchema = z.object({
  prompt: z.string().min(1, 'Câu hỏi không được để trống').max(2000),
});

export const AIGenerateNameSchema = z.object({
  name: z.string().min(1, 'Tên không được để trống').max(200),
});
