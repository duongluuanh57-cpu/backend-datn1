import { z } from 'zod';

export const AIPromptSchema = z.object({
  prompt: z.string().min(1, 'Câu hỏi không được để trống').max(2000),
});
