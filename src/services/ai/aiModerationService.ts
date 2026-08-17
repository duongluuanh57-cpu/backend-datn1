import { getGeminiClient, PRIMARY_MODEL } from './aiClient.ts';

export type ModerationCategory = 'profanity' | 'offensive' | 'hate' | 'spam' | 'other' | 'none';

// Chỉ những nhóm này mới khóa vĩnh viễn (admin không thể duyệt lại)
export const LOCKED_MODERATION_CATEGORIES: ModerationCategory[] = ['profanity', 'offensive', 'hate'];

export async function moderateContent(
  text: string
): Promise<{ isAppropriate: boolean; reason?: string; category: ModerationCategory }> {
  try {
    const client = getGeminiClient();
    const model = client.getGenerativeModel({
      model: PRIMARY_MODEL,
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `Bạn là một hệ thống kiểm duyệt bình luận đánh giá sản phẩm nước hoa của cửa hàng.
Hãy kiểm tra xem bình luận sau đây có chứa ngôn từ không phù hợp không (bao gồm: chửi tục, xúc phạm, thô tục, quảng cáo rác, ngôn từ kích động thù địch, spam vô nghĩa).
Hãy phản hồi dưới định dạng JSON với cấu trúc:
{
  "isAppropriate": true hoặc false,
  "reason": "Lý do từ chối ngắn gọn bằng tiếng Việt nếu isAppropriate là false (để trống nếu true)",
  "category": "Một trong các giá trị sau khi isAppropriate là false: profanity (chửi tục/thô tục), offensive (xúc phạm/miệt thị), hate (kích động thù địch), spam (quảng cáo rác/spam vô nghĩa), other (lý do khác). Nếu isAppropriate là true thì để là none."
}

Nội dung bình luận cần kiểm duyệt:
"${text.replace(/"/g, '\\"')}"`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const parsed = JSON.parse(responseText);
    const category: ModerationCategory =
      (['profanity', 'offensive', 'hate', 'spam', 'other', 'none'] as const).find(
        (c) => c === parsed.category
      ) ?? (parsed.isAppropriate ? 'none' : 'other');
    return {
      isAppropriate: !!parsed.isAppropriate,
      reason: parsed.reason || '',
      category
    };
  } catch (error: any) {
    console.error('❌ [AI Moderation Error]:', error.message);
    // Fallback to true (appropriate) to avoid blocking user flow on external API errors
    return { isAppropriate: true, category: 'none' };
  }
}
