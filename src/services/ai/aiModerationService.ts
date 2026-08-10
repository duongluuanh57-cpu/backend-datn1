import { getGeminiClient, PRIMARY_MODEL } from './aiClient.ts';

export async function moderateContent(text: string): Promise<{ isAppropriate: boolean; reason?: string }> {
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
  "reason": "Lý do từ chối ngắn gọn bằng tiếng Việt nếu isAppropriate là false (để trống nếu true)"
}

Nội dung bình luận cần kiểm duyệt:
"${text.replace(/"/g, '\\"')}"`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const parsed = JSON.parse(responseText);
    return {
      isAppropriate: !!parsed.isAppropriate,
      reason: parsed.reason || ''
    };
  } catch (error: any) {
    console.error('❌ [AI Moderation Error]:', error.message);
    // Fallback to true (appropriate) to avoid blocking user flow on external API errors
    return { isAppropriate: true };
  }
}
