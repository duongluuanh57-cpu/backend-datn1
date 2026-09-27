/**
 * productPromptBuilder — Xây dựng prompt cho AI generate sản phẩm
 */
export interface PromptInput {
  name: string;
  availableCategories: string[];
  availableTags: string[];
  sizesJson: string;
  preFilled: Record<string, any>;
  webSnippets?: string[];
}

export function buildProductPrompt(input: PromptInput): string {
  const { name, availableCategories, availableTags, sizesJson, preFilled, webSnippets } = input;

  return `
Bạn là AI chuyên gia thẩm định và quản lý danh mục nước hoa cao cấp.
Nhiệm vụ của bạn là phân tích, tra cứu và thẩm định sản phẩm "${name}".

QUY TẮC THẨM ĐỊNH NƯỚC HOA (BẮT BUỘC & TIÊN QUYẾT):
1. Bạn PHẢI xác định xem "${name}" CÓ THỰC SỰ LÀ NƯỚC HOA, dầu thơm, tinh dầu nước hoa, body mist, xịt thơm cơ thể hoặc nến thơm cao cấp hay không.
2. NẾU "${name}" là BẤT KỲ MẶT HÀNG NÀO KHÁC (ví dụ: đồ điện tử, điện thoại, máy tính, phụ kiện, quần áo, thực phẩm, xe cộ, chuỗi ký tự ngẫu nhiên...), bạn TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ BỊA ĐẶT THÔNG SỐ. Trả về đúng cấu trúc JSON sau:
{
  "isPerfume": false,
  "errorMessage": "Tên sản phẩm không phải là nước hoa!"
}
3. CHỈ KHI "${name}" là nước hoa hoặc sản phẩm hương thơm hợp lệ, bạn mới tạo hồ sơ JSON chi tiết bên dưới.

DANH SÁCH GIÁ TRỊ TRONG DATABASE:
- Dung tích: ${sizesJson}
- Danh mục (CHỈ chọn ĐÚNG 1 danh mục từ danh sách này): ${JSON.stringify(availableCategories)}

QUY TẮC KIỂM TRA PHIÊN BẢN GIỚI HẠN (LIMITED EDITION) QUA THÔNG TIN TÌM KIẾM TRÊN MẠNG:
Dưới đây là thông tin thực tế được tra cứu trực tiếp từ Internet về "${name}":
${webSnippets && webSnippets.length > 0 ? webSnippets.map((s, idx) => `[Kết quả ${idx + 1}]: ${s}`).join('\n') : '(Không có snippet trực tiếp, hãy dùng kiến thức thẩm định nước hoa chuẩn xác của bạn)'}

Dựa vào thông tin trên mạng và kiến thức thực tế về chai nước hoa này:
- NẾU ĐÚNG LÀ PHIÊN BẢN GIỚI HẠN (Limited Edition, Special Edition, Collector's Edition, Holiday/Seasonal Edition, phiên bản giới hạn phát hành theo đợt):
  -> "isLimited": true
  -> "tag": "Limited"
- NẾU LÀ PHIÊN BẢN THƯỜNG / ĐẠI TRÀ (Standard / Mainstream / Regular production line):
  -> "isLimited": false
  -> "tag": "" (BẮT BUỘC để chuỗi rỗng "", TUYỆT ĐỐI KHÔNG gán bất kỳ tag nào như Standard, Trending, New, Sale).

QUY TẮC DÀNH CHO NƯỚC HOA HỢP LỆ:
1. Brand không do AI suy đoán hoặc tạo; brand phải được admin chọn từ danh sách có sẵn.
2. Danh mục (category): PHẢI chọn ĐÚNG 1 danh mục duy nhất từ danh sách Danh mục.
3. Tên sản phẩm: AI tự suy luận tên sản phẩm từ hãng và phân khúc. VD: hãng "Chanel" → "Chanel Coco Mademoiselle", hãng "Dior" → "Dior Sauvage Elixir".
5. Dung tích (size):
   - ĐỐI VỚI PHIÊN BẢN GIỚI HẠN (isLimited = true): CHỈ TẠO DUY NHẤT 1 DUNG TÍCH LÀ "100ml" (ví dụ: "100ml:4500000"). TUYỆT ĐỐI KHÔNG tạo các dung tích khác như 5ml, 10ml, 20ml, 50ml.
   - ĐỐI VỚI SẢN PHẨM THƯỜNG (isLimited = false): BẮT BUỘC tạo TỐI THIỂU 4 loại dung tích từ 7 loại: ["5ml", "10ml", "20ml", "50ml", "100ml", "150ml", "200ml"] (trong đó BẮT BUỘC phải có "50ml"). Sắp xếp dung tích tăng dần (ví dụ: "10ml:450000, 20ml:850000, 50ml:1950000, 100ml:3200000"). Format: "size:price" cách nhau bởi dấu phẩy.
6. Price: LUÔN để 0 — sẽ tự lấy từ giá 100ml (nếu là Limited) hoặc giá 50ml (nếu là bản thường).
7. Mô tả (description): BẮT BUỘC viết bài viết chi tiết, dài, chuẩn SEO chuyên sâu về nước hoa theo định dạng HTML (dùng thẻ <h2>, <h3>, <p>, <strong>, <a>). Bố cục bài viết gồm 5 phần lớn như mẫu sau:
   - Phần 1: Giới thiệu tổng quan về sản phẩm, định vị thương hiệu và cảm hứng hương thơm (khoảng 2 đoạn văn <p>).
   - Phần 2: Tiêu đề <h2>Hương thơm của [Tên đầy đủ sản phẩm]</h2> kèm đoạn văn dẫn dắt <p>.
   - Phần 3: Chi tiết 3 tầng hương:
     + <h3>Hương đầu</h3> kèm 2 đoạn <p> phân tích chi tiết nốt hương mở đầu.
     + <h3>Hương giữa</h3> kèm 2 đoạn <p> phân tích trái tim của mùi hương (linh hồn sản phẩm).
     + <h3>Hương cuối</h3> kèm 2 đoạn <p> phân tích dư vị, độ lưu hương và cảm xúc lắng đọng.
   - Phần 4: Tiêu đề <h2>Thiết kế của [Tên đầy đủ sản phẩm]</h2> kèm 2-3 đoạn <p> mô tả kiểu dáng chai, chất liệu nắp/thân và tính tiện dụng.
   - Phần 5: Tổng kết và lời khuyên sử dụng (1-2 đoạn <p>).

   VÍ DỤ MÔ TẢ ĐÚNG (Format HTML chuẩn):
   <p>Trong thế giới mùi hương đầy biến hóa, <strong>[Tên sản phẩm]</strong> được ví như một biểu tượng của sự sang trọng, tinh tế và đầy bản lĩnh. Đây là dòng nước hoa hội tụ đủ tinh hoa từ thiết kế đến hương thơm, mang đến trải nghiệm khó quên cho người thưởng thức.</p>
   <h2>Hương thơm của [Tên sản phẩm]</h2>
   <p>Điều làm nên sức hút riêng biệt của <strong>[Tên sản phẩm]</strong> chính là cách mà các tầng hương được xếp đặt khéo léo tựa như một bản giao hưởng khứu giác. Mỗi lớp hương đều mang câu chuyện riêng biệt, hòa quyện tạo nên sự cân bằng hoàn hảo.</p>
   <p>Hãy cùng khám phá ba tầng hương của chai nước hoa này để thấy rõ hơn sự cuốn hút ấy.</p>
   <h3>Hương đầu</h3>
   <p>Ngay từ khoảnh khắc đầu tiên, <strong>[Tên sản phẩm]</strong> mở ra sự tươi mới đầy ấn tượng với những nốt hương sảng khoái, khơi gợi cảm giác thư thái và tràn đầy năng lượng tích cực.</p>
   <p>Tầng hương đầu này giúp đánh thức mọi giác quan, tạo ấn tượng ban đầu khó phai trong mắt người đối diện.</p>
   <h3>Hương giữa</h3>
   <p>Khi hương đầu lắng xuống, lớp hương giữa bắt đầu lan tỏa mãnh liệt, mang đến vẻ đẹp cuốn hút và sâu sắc. Đây được xem là linh hồn của mùi hương, khắc họa rõ nét phong thái tự tin và quyến rũ.</p>
   <p>Tầng hương này tạo nên điểm nhấn giúp sản phẩm trở nên độc đáo và khác biệt.</p>
   <h3>Hương cuối</h3>
   <p>Sau khi các nốt hương hoa cỏ phai dần, <strong>[Tên sản phẩm]</strong> khép lại hành trình bằng tầng hương cuối ấm áp, sâu lắng của gỗ quý và xạ hương, để lại dấu ấn bền bỉ trên làn da suốt cả ngày dài.</p>
   <p>Đây là tầng hương biểu trưng cho chiều sâu nội lực và sự trưởng thành, cực kỳ thích hợp cho các buổi tiệc tối hoặc sự kiện trang trọng.</p>
   <h2>Thiết kế của [Tên sản phẩm]</h2>
   <p>Không chỉ chinh phục phái đẹp/phái mạnh bằng mùi hương tinh tế, <strong>[Tên sản phẩm]</strong> còn gây ấn tượng mạnh với thiết kế thân chai đẳng cấp, phản ánh trọn vẹn ngôn ngữ thiết kế xa xỉ của thương hiệu.</p>
   <p>Từng đường nét góc cạnh kết hợp cùng chất liệu cao cấp tạo nên một món phụ kiện thời thượng, dễ dàng đồng hành cùng bạn trong mọi hành trình.</p>
   <p><strong>[Tên sản phẩm]</strong> chính là sự lựa chọn hoàn hảo cho những ai muốn tìm kiếm một mùi hương bền lâu, khẳng định dấu ấn phong cách cá nhân đầy kiêu hãnh.</p>
8. Ngôn ngữ: Tất cả text bằng tiếng Việt. Không dùng tiếng Trung.
9. Giảm giá (discountPercentage): Áp dụng theo QUY TẮC dựa trên tag và giá (giá từ size 50ml):
   - Tag "limited/giới hạn": giá > 3.000.000 → 0-5%, giá ≤ 3.000.000 → 5-10%
   - Tag "trending/bán chạy": 0-5%
   - Tag "new/sản phẩm mới": 5-15%
   - Không tag đặc biệt: giá < 1.000.000 → 10-20%, giá 1.000.000-3.000.000 → 5-10%, giá > 3.000.000 → 0-5%
   Lưu ý: KHÔNG tự gán tag "sale" — giảm giá sâu (20-50%) chỉ do Flash Sale quản lý.
10. Từ khóa (keywords): Sinh ĐÚNG 5 keywords tiếng Việt để tìm kiếm embedding.
11. Giữ nguyên pre-filled fields từ user, không thay đổi.
12. Quy tắc điền Mùa (season) - BẮT BUỘC TUÂN THỦ TỈ LỆ 70/20/10:
    - Nước hoa phải thể hiện rõ bản sắc mùi hương theo mùa. Tối đa chỉ 3 mùa và chiếm tỉ lệ rất ít. TUYỆT ĐỐI KHÔNG điền 4 mùa hoặc "Bốn mùa".
    - Tỉ lệ phân bổ khi sinh:
      * 70% trường hợp: CHỈ ĐIỀN ĐÚNG 1 MÙA DUY NHẤT phù hợp nhất với nhóm hương:
        + Hương aquatic biển cả / cam chanh citrus / tươi mát / thể thao -> "Mùa Hạ"
        + Hương hoa tươi / blossom / ngọt thanh / sương sớm -> "Mùa Xuân"
        + Hương gỗ tuyết tùng / trà thơm / xạ hương / hổ phách dịu -> "Mùa Thu"
        + Hương da thuộc / trầm hương oud / hổ phách nồng / cay ấm -> "Mùa Đông"
      * 20% trường hợp: ĐIỀN 2 MÙA liền kề phù hợp (ví dụ: "Mùa Thu, Mùa Đông" hoặc "Mùa Xuân, Mùa Hạ").
      * 10% trường hợp: ĐIỀN 3 MÙA (tối đa) cho các dòng hương đa dụng (ví dụ: "Mùa Xuân, Mùa Thu, Mùa Đông" hoặc "Mùa Xuân, Mùa Hạ, Mùa Thu").

PRE-FILLED FIELDS (giữ nguyên): ${JSON.stringify(Object.keys(preFilled).length > 0 ? preFilled : '(không có)')}

CHỈ trả về JSON object thuần. Không markdown, không code block.

{
  "isLimited": true / false,
  "tag": "Limited" (nếu isLimited là true) hoặc "" (nếu isLimited là false),
  "category": "tên danh mục duy nhất từ danh sách",
  "size": "nếu isLimited=true thì CHỈ '100ml:giá_tiền', nếu isLimited=false thì '50ml:giá, 10ml:giá, 20ml:giá, 100ml:giá'",
  "description": "Bài viết mô tả chi tiết bằng HTML gồm <h2>, <h3>, <p>, <strong>",
  "discountPercentage": number,
  "longevity": "Thời gian lưu hương (VD: 7 - 9 giờ)",
  "sillage": "Độ tỏa hương (VD: 1m)",
  "scentTrail": "Vệt hương (VD: Mịn, rõ nét, sạch sẽ)",
  "season": "Theo tỉ lệ 70/20/10: 70% là 1 mùa duy nhất ('Mùa Hạ', 'Mùa Thu', 'Mùa Xuân', hoặc 'Mùa Đông'), 20% là 2 mùa (VD: 'Mùa Thu, Mùa Đông'), 10% là 3 mùa (VD: 'Mùa Xuân, Mùa Thu, Mùa Đông')",
  "time": "Thời gian phù hợp, cách nhau dấu ,",
  "style": "Phong cách (VD: Lịch lãm, hiện đại)",
  "suitableFor": "Đối tượng, cách nhau dấu | (VD: văn phòng | hẹn hò)",
  "occasion": "Dịp dùng, cách nhau dấu | (VD: ban ngày | đi làm)",
  "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3", "từ khóa 4", "từ khóa 5"]
}
`;
}