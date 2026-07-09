/**
 * interviewStateManager — Quản lý session state cho Product Interview Flow
 *
 * Mỗi admin có 1 session, lưu trong memory Map với TTL 15 phút.
 * Khi admin bắt đầu tạo sản phẩm, state được khởi tạo và duy trì qua các bước.
 */
import { AIService } from '../AIService.ts';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProductOption {
  id: string;
  name: string;
  brand: string;
  description: string;
}

export interface ProductDetail {
  name: string;
  descriptionLevel: 'low' | 'medium' | 'high';
  volumeCount: 3 | 5;
  price: number | null;
  tags: string[];
  discountPercentage: number | null;
  discountStartDate: string | null;
  discountEndDate: string | null;
}

export interface InterviewState {
  sessionId: string;
  adminId: string;
  step: 'select_products' | 'product_detail' | 'confirm' | 'done';
  brandName: string;
  availableProducts: ProductOption[];
  selectedProductIndices: number[];
  currentProductIndex: number;
  currentFieldIndex: number;
  productDetails: ProductDetail[];
  createdAt: number;
}

export type InterviewAction =
  | { type: 'select_products'; selectedIndices: number[] }
  | { type: 'skip_all_products' }
  | { type: 'product_detail'; field: string; value: any }
  | { type: 'skip_all_fields' }
  | { type: 'skip_product' }
  | { type: 'confirm'; confirmed: boolean }
  | { type: 'go_back' };

export type InterviewResponse =
  | { type: 'select_products'; title: string; subtitle: string; options: ProductOption[]; allowSkipAll: true }
  | { type: 'choice_single'; title: string; subtitle: string; field: string; options: { label: string; value: string; description?: string }[]; allowSkip: true; defaultValue?: string }
  | { type: 'choice_multi'; title: string; subtitle: string; field: string; options: { label: string; value: string }[]; maxSelect: number; allowSkip: true }
  | { type: 'input_number'; title: string; subtitle: string; field: string; placeholder: string; allowSkip: true }
  | { type: 'input_date_range'; title: string; subtitle: string; startField: string; endField: string; allowSkip: true }
  | { type: 'confirm'; title: string; subtitle: string; items: { label: string; value: string }[] }
  | { type: 'price_suggestion'; title: string; subtitle: string; field: string; productName: string; brandName: string; options: { label: string; value: string; price: number; costPrice: number; profitPercent: number; description?: string }[]; allowSkip: true }
  | { type: 'done'; message: string; results: { name: string; id?: string; success: boolean; message: string }[] };

// ── State Manager ──────────────────────────────────────────────────────────

const SESSION_TTL = 15 * 60 * 1000; // 15 phút
const sessions = new Map<string, InterviewState>();

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of sessions.entries()) {
    if (now - state.createdAt > SESSION_TTL) {
      sessions.delete(key);
    }
  }
}, 60 * 1000);

export class InterviewStateManager {
  static createSession(adminId: string, brandName: string, products: ProductOption[]): string {
    const sessionId = `interview_${adminId}_${Date.now()}`;
    const state: InterviewState = {
      sessionId,
      adminId,
      step: 'select_products',
      brandName,
      availableProducts: products,
      selectedProductIndices: [],
      currentProductIndex: 0,
      currentFieldIndex: 0,
      productDetails: [],
      createdAt: Date.now(),
    };
    sessions.set(sessionId, state);
    return sessionId;
  }

  static getSession(sessionId: string): InterviewState | null {
    const state = sessions.get(sessionId);
    if (!state) return null;
    if (Date.now() - state.createdAt > SESSION_TTL) {
      sessions.delete(sessionId);
      return null;
    }
    return state;
  }

  static updateSession(sessionId: string, updater: (state: InterviewState) => void): InterviewState | null {
    const state = sessions.get(sessionId);
    if (!state) return null;
    updater(state);
    return state;
  }

  static deleteSession(sessionId: string) {
    sessions.delete(sessionId);
  }
}

// ── Interview Agent ────────────────────────────────────────────────────────

const DESCRIPTION_OPTIONS = [
  { label: 'Thấp — 2-3 câu ngắn', value: 'low', description: 'Chỉ mô tả cơ bản về mùi hương' },
  { label: 'Trung bình — 5-7 câu', value: 'medium', description: 'Mô tả chi tiết mùi hương, phong cách' },
  { label: 'Cao — 10-15 câu', value: 'high', description: 'Mô tả đầy đủ: mùi hương, phong cách, cảm xúc, dịp sử dụng' },
];

const VOLUME_OPTIONS = [
  { label: '3 size (30ml, 50ml, 100ml)', value: '3' },
  { label: '5 size (10ml, 30ml, 50ml, 75ml, 100ml)', value: '5' },
];

const TAG_OPTIONS = [
  { label: 'Hương hoa', value: 'Hương hoa' },
  { label: 'Hương gỗ', value: 'Hương gỗ' },
  { label: 'Hương trái cây', value: 'Hương trái cây' },
  { label: 'Hương biển', value: 'Hương biển' },
  { label: 'Dịu nhẹ', value: 'Dịu nhẹ' },
  { label: 'Mạnh mẽ', value: 'Mạnh mẽ' },
  { label: 'Cao cấp', value: 'Cao cấp' },
  { label: 'Thanh lịch', value: 'Thanh lịch' },
  { label: 'Trẻ trung', value: 'Trẻ trung' },
  { label: 'Cổ điển', value: 'Cổ điển' },
  { label: 'Lãng mạn', value: 'Lãng mạn' },
  { label: 'Phe phái', value: 'Phe phái' },
];

export class ProductInterviewAgent {
  /**
   * Gọi AI để sinh gợi ý giá cho sản phẩm kèm % lợi nhuận
   */
  static async generatePriceSuggestions(
    productName: string,
    brandName: string,
  ): Promise<{ label: string; value: string; price: number; costPrice: number; profitPercent: number; description?: string }[]> {
    try {
      const prompt = `Bạn là chuyên gia định giá nước hoa. Hãy phân tích sản phẩm "${productName}" của hãng "${brandName}" và đề xuất 3 mức giá bán lẻ khác nhau.

Chi phí nhập/xuất xưởng tham khảo cho nước hoa cao cấp:
- Chi phí (cost price) thường chiếm 30-45% giá bán
- % lợi nhuận gộp thường 55-70%
- Nước hoa niche có biên lợi nhuận cao hơn mainstream

TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON (không markdown, không giải thích):
{
  "suggestions": [
    {
      "label": "Phổ thông (cạnh tranh)",
      "price": 2500000,
      "costPrice": 1000000,
      "profitPercent": 60,
      "description": "Giá cạnh tranh, phù hợp thị trường đại chúng"
    },
    {
      "label": "Trung cấp (phổ biến)",
      "price": 3500000,
      "costPrice": 1200000,
      "profitPercent": 66,
      "description": "Giá phổ biến cho nước hoa hãng lớn, cân bằng lợi nhuận"
    },
    {
      "label": "Cao cấp (premium)",
      "price": 5000000,
      "costPrice": 1500000,
      "profitPercent": 70,
      "description": "Giá premium, định vị thương hiệu cao cấp, lợi nhuận tối đa"
    }
  ]
}

QUAN TRỌNG:
- price: giá bán lẻ đề xuất (VNĐ)
- costPrice: chi phí nhập vào ước tính (VNĐ)
- profitPercent: % lợi nhuận = ((price - costPrice) / price) * 100
- 3 mức giá: phổ thông, trung cấp, cao cấp — giá trị cụ thể tuỳ theo thương hiệu
- Số liệu phải thực tế, khớp với mặt bằng giá thị trường nước hoa`;

      const raw = await AIService.generateResponse(prompt, undefined, 'gemini-3.1-flash-lite');
      const jsonString = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(jsonString);
      const suggestions = parsed.suggestions || [];

      if (suggestions.length === 0) {
        // Fallback suggestions
        return [
          { label: 'Phổ thông (cạnh tranh)', value: '2000000', price: 2000000, costPrice: 800000, profitPercent: 60, description: 'Giá cạnh tranh' },
          { label: 'Trung cấp (phổ biến)', value: '3500000', price: 3500000, costPrice: 1200000, profitPercent: 66, description: 'Giá phổ biến' },
          { label: 'Cao cấp (premium)', value: '5000000', price: 5000000, costPrice: 1500000, profitPercent: 70, description: 'Giá premium' },
        ];
      }

      return suggestions.map((s: any, i: number) => ({
        label: s.label || `Mức ${i + 1}`,
        value: String(s.price),
        price: s.price,
        costPrice: s.costPrice || Math.round(s.price * 0.4),
        profitPercent: s.profitPercent || Math.round(((s.price - (s.costPrice || Math.round(s.price * 0.4))) / s.price) * 100),
        description: s.description || '',
      }));
    } catch (err) {
      console.error('❌ [PriceSuggestion] Error:', err);
      // Fallback
      return [
        { label: 'Phổ thông (cạnh tranh)', value: '2000000', price: 2000000, costPrice: 800000, profitPercent: 60, description: 'Giá cạnh tranh' },
        { label: 'Trung cấp (phổ biến)', value: '3500000', price: 3500000, costPrice: 1200000, profitPercent: 66, description: 'Giá phổ biến' },
        { label: 'Cao cấp (premium)', value: '5000000', price: 5000000, costPrice: 1500000, profitPercent: 70, description: 'Giá premium' },
      ];
    }
  }

  /**
   * Bắt đầu interview: tìm sản phẩm trending cho brand → trả về bước chọn sản phẩm
   */
  static async startInterview(
    brandName: string,
    adminId: string,
  ): Promise<{ sessionId: string; response: InterviewResponse }> {
    // Tìm sản phẩm trending cho brand
    const prompt = `Bạn là chuyên gia nước hoa. Liệt kê 5 loại nước hoa nổi bật nhất của hãng "${brandName}" — có thể là sản phẩm mới trending hoặc dòng kinh điển lâu đời.

TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON (không markdown, không giải thích):
{
  "products": [
    { "name": "Tên nước hoa", "brand": "${brandName}", "description": "Mô tả ngắn 1 câu tiếng Việt" }
  ]
}

QUAN TRỌNG:
- Ưu tiên sản phẩm nổi tiếng, có thật trên thị trường
- Brand phải chính xác
- Description ngắn gọn 1 câu tiếng Việt`;

    const raw = await AIService.generateResponse(prompt, undefined, 'gemini-3.1-flash-lite');
    const jsonString = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonString);
    const products: ProductOption[] = (parsed.products || []).map((p: any, i: number) => ({
      id: `prod_${i}`,
      name: p.name || '',
      brand: p.brand || brandName,
      description: p.description || '',
    }));

    if (products.length === 0) {
      // Fallback: tạo sản phẩm mẫu
      products.push(
        { id: 'prod_0', name: `${brandName} Signature`, brand: brandName, description: `Nước hoa đặc trưng của ${brandName}` },
        { id: 'prod_1', name: `${brandName} Classic`, brand: brandName, description: `Dòng nước hoa kinh điển của ${brandName}` },
        { id: 'prod_2', name: `${brandName} Modern`, brand: brandName, description: `Phiên bản hiện đại của ${brandName}` },
      );
    }

    const sessionId = InterviewStateManager.createSession(adminId, brandName, products);

    return {
      sessionId,
      response: {
        type: 'select_products',
        title: `Chọn sản phẩm ${brandName} muốn tạo`,
        subtitle: `Tìm thấy ${products.length} sản phẩm nổi bật. Chọn sản phẩm bạn muốn tạo:`,
        options: products,
        allowSkipAll: true,
      },
    };
  }

  /**
   * Xử lý action từ admin và trả về response tiếp theo
   */
  static async processAction(
    sessionId: string,
    action: InterviewAction,
  ): Promise<InterviewResponse> {
    const state = InterviewStateManager.getSession(sessionId);
    if (!state) {
      return {
        type: 'done',
          message: 'Phiên làm việc đã hết hạn. Vui lòng bắt đầu lại.',
        results: [],
      };
    }

    switch (state.step) {
      case 'select_products':
        return this.handleSelectProducts(state, action);
      case 'product_detail':
        return this.handleProductDetail(state, action);
      case 'confirm':
        return this.handleConfirm(state, action);
      default:
        return {
          type: 'done',
          message: 'Hoàn tất!',
          results: [],
        };
    }
  }

  private static async handleSelectProducts(state: InterviewState, action: InterviewAction): Promise<InterviewResponse> {
    if (action.type === 'skip_all_products') {
      // Chọn tất cả sản phẩm
      state.selectedProductIndices = state.availableProducts.map((_, i) => i);
    } else if (action.type === 'select_products') {
      state.selectedProductIndices = action.selectedIndices;
    }

    if (state.selectedProductIndices.length === 0) {
      return {
        type: 'select_products',
        title: `Chọn sản phẩm ${state.brandName} muốn tạo`,
        subtitle: 'Vui lòng chọn ít nhất 1 sản phẩm!',
        options: state.availableProducts,
        allowSkipAll: true,
      };
    }

    // Khởi tạo product details
    state.productDetails = state.selectedProductIndices.map(i => ({
      name: state.availableProducts[i].name,
      descriptionLevel: 'medium' as const,
      volumeCount: 3 as const,
      price: null,
      tags: [],
      discountPercentage: null,
      discountStartDate: null,
      discountEndDate: null,
    }));

    state.currentProductIndex = 0;
    state.currentFieldIndex = 0;
    state.step = 'product_detail';

    return this.getCurrentFieldResponse(state);
  }

  private static async getCurrentFieldResponse(state: InterviewState): Promise<InterviewResponse> {
    const detail = state.productDetails[state.currentProductIndex];
    const total = state.productDetails.length;
    const current = state.currentProductIndex + 1;
    const prefix = `Sản phẩm ${current}/${total}: "${detail.name}"`;

    // Field 2 (price) is async — generate AI suggestions
    if (state.currentFieldIndex === 2) {
      const suggestions = await this.generatePriceSuggestions(detail.name, state.brandName);
      return {
        type: 'price_suggestion',
        title: `${prefix} — Chọn mức giá`,
        subtitle: 'AI đề xuất các mức giá dựa trên thị trường. Chọn mức phù hợp:',
        field: 'price',
        productName: detail.name,
        brandName: state.brandName,
        options: suggestions,
        allowSkip: true,
      };
    }

    const fields: (() => InterviewResponse)[] = [
      // Field 0: Mức độ mô tả
      () => ({
        type: 'choice_single',
        title: `${prefix} — Mức độ mô tả`,
        subtitle: 'Bạn muốn mô tả sản phẩm ở mức độ nào?',
        field: 'descriptionLevel',
        options: DESCRIPTION_OPTIONS,
        allowSkip: true,
        defaultValue: 'medium',
      }),
      // Field 1: Dung tích
      () => ({
        type: 'choice_single',
        title: `${prefix} — Số lượng dung tích`,
        subtitle: 'Bạn muốn tạo bao nhiêu size cho sản phẩm này?',
        field: 'volumeCount',
        options: VOLUME_OPTIONS,
        allowSkip: true,
        defaultValue: '3',
      }),
      // Field 3: Tags
      () => ({
        type: 'choice_multi',
        title: `${prefix} — Chọn tag`,
        subtitle: 'Chọn tối đa 4 tag phù hợp cho sản phẩm (bỏ qua → AI tự chọn)',
        field: 'tags',
        options: TAG_OPTIONS,
        maxSelect: 4,
        allowSkip: true,
      }),
      // Field 4: Giảm giá
      () => ({
        type: 'choice_single',
        title: `${prefix} — Giảm giá`,
        subtitle: 'Bạn có muốn thêm giảm giá cho sản phẩm này không?',
        field: 'discountPercentage',
        options: [
          { label: 'Không giảm giá', value: '0' },
          { label: 'Giảm 5%', value: '5' },
          { label: 'Giảm 10%', value: '10' },
          { label: 'Giảm 15%', value: '15' },
          { label: 'Giảm 20%', value: '20' },
          { label: 'Giảm 25%', value: '25' },
          { label: 'Giảm 30%', value: '30' },
          { label: 'Giảm 50%', value: '50' },
        ],
        allowSkip: true,
        defaultValue: '0',
      }),
      // Field 5: Ngày giảm giá (chỉ nếu discount > 10%)
      () => ({
        type: 'input_date_range',
        title: `${prefix} — Thời gian giảm giá`,
        subtitle: 'Chọn ngày bắt đầu và kết thúc cho chương trình giảm giá (nếu giảm trên 10%)',
        startField: 'discountStartDate',
        endField: 'discountEndDate',
        allowSkip: true,
      }),
    ];

    if (state.currentFieldIndex >= fields.length) {
      // Chuyển sang sản phẩm tiếp theo
      state.currentProductIndex++;
      state.currentFieldIndex = 0;

      if (state.currentProductIndex >= state.productDetails.length) {
        // Hết sản phẩm → chuyển sang confirm
        state.step = 'confirm';
        return this.getConfirmResponse(state);
      }

      return this.getCurrentFieldResponse(state);
    }

    return fields[state.currentFieldIndex]();
  }

  private static async handleProductDetail(state: InterviewState, action: InterviewAction): Promise<InterviewResponse> {
    const detail = state.productDetails[state.currentProductIndex];

    if (action.type === 'skip_all_fields') {
      // Skip tất cả fields cho sản phẩm hiện tại → dùng mặc định
      state.currentProductIndex++;
      state.currentFieldIndex = 0;

      if (state.currentProductIndex >= state.productDetails.length) {
        state.step = 'confirm';
        return this.getConfirmResponse(state);
      }
      return this.getCurrentFieldResponse(state);
    }

    if (action.type === 'skip_product') {
      // Bỏ qua sản phẩm này
      state.productDetails.splice(state.currentProductIndex, 1);
      state.selectedProductIndices.splice(state.currentProductIndex, 1);

      if (state.productDetails.length === 0) {
        return {
          type: 'done',
          message: 'Bạn đã bỏ qua tất cả sản phẩm. Không có sản phẩm nào được tạo.',
          results: [],
        };
      }

      if (state.currentProductIndex >= state.productDetails.length) {
        state.step = 'confirm';
        return this.getConfirmResponse(state);
      }
      state.currentFieldIndex = 0;
      return this.getCurrentFieldResponse(state);
    }

    if (action.type === 'go_back') {
      if (state.currentFieldIndex > 0) {
        state.currentFieldIndex--;
      } else if (state.currentProductIndex > 0) {
        state.currentProductIndex--;
        state.currentFieldIndex = 5; // field cuối
      } else {
        state.step = 'select_products';
        return {
          type: 'select_products',
          title: `Chọn sản phẩm ${state.brandName} muốn tạo`,
          subtitle: 'Chọn lại sản phẩm bạn muốn tạo:',
          options: state.availableProducts,
          allowSkipAll: true,
        };
      }
      return this.getCurrentFieldResponse(state);
    }

    if (action.type === 'product_detail') {
      const { field, value } = action;

      // Xử lý discount: nếu chọn 0 → không hỏi date range
      if (field === 'discountPercentage') {
        const val = parseInt(value);
        detail.discountPercentage = val;
        if (val <= 10) {
          // Không cần hỏi date range, skip field 5
          state.currentFieldIndex = 6; // skip date range field
          return this.getCurrentFieldResponse(state);
        }
        state.currentFieldIndex++;
        return this.getCurrentFieldResponse(state);
      }

      // Xử lý date range (startField nhận JSON {start, end})
      if (field === 'discountStartDate' && typeof value === 'string' && value.startsWith('{')) {
        try {
          const parsed = JSON.parse(value);
          detail.discountStartDate = parsed.start || null;
          detail.discountEndDate = parsed.end || null;
          // Skip luôn endDate field (vì đã có cả 2)
          state.currentFieldIndex = 6; // skip to end of fields
          return this.getCurrentFieldResponse(state);
        } catch {
          // fallback: gán start
          detail.discountStartDate = value;
        }
      }

      // Ghi nhận giá trị
      switch (field) {
        case 'descriptionLevel':
          detail.descriptionLevel = value as 'low' | 'medium' | 'high';
          break;
        case 'volumeCount':
          detail.volumeCount = parseInt(value) as 3 | 5;
          break;
        case 'price':
          detail.price = value ? parseInt(value) : null;
          break;
        case 'tags':
          detail.tags = Array.isArray(value) ? value : [value];
          break;
        case 'discountStartDate':
          if (typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              detail.discountStartDate = parsed.start || null;
              detail.discountEndDate = parsed.end || null;
            } catch {
              detail.discountStartDate = value;
            }
          } else {
            detail.discountStartDate = value;
          }
          break;
        case 'discountEndDate':
          detail.discountEndDate = value;
          break;
      }

      state.currentFieldIndex++;
      return this.getCurrentFieldResponse(state);
    }

    return this.getCurrentFieldResponse(state);
  }

  private static getConfirmResponse(state: InterviewState): InterviewResponse {
    const items = state.productDetails.map((d, i) => ({
      label: `Sản phẩm ${i + 1}: ${d.name}`,
      value: [
        `Mô tả: ${d.descriptionLevel === 'low' ? 'Thấp' : d.descriptionLevel === 'medium' ? 'Trung bình' : 'Cao'}`,
        `Dung tích: ${d.volumeCount} size`,
        d.price ? `Giá: ${d.price.toLocaleString('vi-VN')}đ` : 'Giá: AI tự quyết định',
        d.tags.length > 0 ? `Tags: ${d.tags.join(', ')}` : 'Tags: AI tự chọn',
        d.discountPercentage && d.discountPercentage > 0
          ? `Giảm: ${d.discountPercentage}%${d.discountStartDate ? ` (${d.discountStartDate} → ${d.discountEndDate})` : ''}`
          : 'Không giảm giá',
      ].join(' | '),
    }));

    return {
      type: 'confirm',
      title: 'Xác nhận tạo sản phẩm',
      subtitle: `Bạn sắp tạo ${state.productDetails.length} sản phẩm. Kiểm tra lại thông tin:`,
      items,
    };
  }

  private static async handleConfirm(state: InterviewState, action: InterviewAction): Promise<InterviewResponse> {
    if (action.type === 'confirm' && action.confirmed) {
      // Thực hiện tạo sản phẩm
      const results: { name: string; id?: string; success: boolean; message: string }[] = [];

      for (const detail of state.productDetails) {
        try {
          // Gọi createProductFromName với các thông số đã chọn
          const { createProductFromName } = await import('./adminTools.ts');
          const result = await createProductFromName(
            detail.name,
            {
              price: detail.price || undefined,
              brand: state.brandName,
              discountPercentage: detail.discountPercentage || undefined,
            },
          );

          if (result.success) {
            results.push({
              name: detail.name,
              id: result.data?.id,
              success: true,
              message: result.message,
            });
          } else {
            results.push({
              name: detail.name,
              success: false,
              message: result.message,
            });
          }
        } catch (err: any) {
          results.push({
            name: detail.name,
            success: false,
            message: err.message || 'Lỗi không xác định',
          });
        }
      }

      state.step = 'done';
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      let message = `Đã tạo thành công ${successCount} sản phẩm!`;
      if (failCount > 0) {
        message += ` ${failCount} sản phẩm thất bại.`;
      }
      message += '\n\n' + results.map(r =>
        `${r.success ? '[OK]' : '[FAIL]'} ${r.name}: ${r.message}`
      ).join('\n');

      InterviewStateManager.deleteSession(state.sessionId);

      return {
        type: 'done',
        message,
        results,
      };
    }

    // Quay lại
    state.step = 'product_detail';
    state.currentProductIndex = 0;
    state.currentFieldIndex = 0;
    return this.getCurrentFieldResponse(state);
  }
}