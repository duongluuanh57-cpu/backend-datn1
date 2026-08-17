/**
 * productPromptBuilder — Xây dựng prompt cho AI generate sản phẩm
 */
export interface PromptInput {
  name: string;
  availableBrands: string[];
  availableCategories: string[];
  availableTags: string[];
  sizesJson: string;
  preFilled: Record<string, any>;
}

export function buildProductPrompt(input: PromptInput): string {
  const { name, availableBrands, availableCategories, availableTags, sizesJson, preFilled } = input;

  const finalTagsForPrompt = availableTags.filter((t: string) => t.toLowerCase() !== 'standard');

  return `
Bạn là AI chuyên gia thẩm định và quản lý danh mục nước hoa cao cấp.
Nhiệm vụ của bạn là phân tích và thẩm định tên sản phẩm "${name}".

QUY TẮC THẨM ĐỊNH NƯỚC HOA (BẮT BUỘC & TIÊN QUYẾT):
1. Bạn PHẢI xác định xem "${name}" CÓ THỰC SỰ LÀ NƯỚC HOA, dầu thơm, tinh dầu nước hoa, body mist, xịt thơm cơ thể hoặc nến thơm cao cấp hay không.
2. NẾU "${name}" là BẤT KỲ MẶT HÀNG NÀO KHÁC (ví dụ: đồ điện tử, điện thoại, máy tính, phụ kiện, quần áo, giày dép, túi xách không phải nước hoa, thực phẩm, đồ uống, thuốc, đồ gia dụng, xe cộ, cây cối, động vật, địa danh, tên người thông thường, chuỗi ký tự ngẫu nhiên hoặc bất kỳ thứ gì không phải sản phẩm mùi hương nước hoa), bạn TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ BỊA ĐẶT THÔNG SỐ NƯỚC HOA. Thay vào đó, bạn PHẢI trả về ĐÚNG cấu trúc JSON sau:
{
  "isPerfume": false,
  "errorMessage": "Tên sản phẩm không phải là nước hoa!"
}
3. CHỈ KHI VÀ CHỈ KHI "${name}" là nước hoa hoặc sản phẩm hương thơm hợp lệ, bạn mới tiến hành tạo hồ sơ JSON chi tiết bên dưới.

DANH SÁCH GIÁ TRỊ TRONG DATABASE (CHỈ được chọn từ đây nếu là nước hoa hợp lệ — không ngoại lệ):
- Hãng: ${JSON.stringify(availableBrands)}
- Dung tích: ${sizesJson}
- Danh mục (CHỈ chọn ĐÚNG 1 danh mục từ danh sách này): ${JSON.stringify(availableCategories)}
- Tags (CHỈ chọn ĐÚNG 1 tag phụ từ danh sách này, KHÔNG chọn "Standard" — tag Standard tự động thêm ở backend): ${JSON.stringify(finalTagsForPrompt)}

QUY TẮC DÀNH CHO NƯỚC HOA HỢP LỆ:
1. Hãng (brand): PHẢI chọn CHÍNH XÁC 1 hãng từ danh sách Hãng. Nếu không chắc, chọn hãng gần nhất.
2. Tag: PHẢI chọn ĐÚNG 1 tag phụ từ danh sách Tags trên (không chọn "Standard"). Tag "Standard" sẽ tự động được thêm để tạo thành đúng 2 tags cho sản phẩm. Tag "Sale" CHỈ chọn khi discountPercentage > 10 VÀ có discountEndDate. Nếu không đủ điều kiện, KHÔNG chọn "Sale".
3. Danh mục (category): PHẢI chọn ĐÚNG 1 danh mục duy nhất từ danh sách Danh mục.
4. Tên sản phẩm: AI tự suy luận tên sản phẩm từ hãng và phân khúc. VD: hãng "Chanel" → "Chanel Coco Mademoiselle", hãng "Dior" → "Dior Sauvage Elixir".
5. Dung tích (size): CHỈ được chọn từ danh sách 7 loại dung tích: ["5ml", "10ml", "20ml", "50ml", "100ml", "150ml", "200ml"]. BẮT BUỘC tạo TỐI THIỂU 4 loại dung tích khác nhau (trong đó BẮT BUỘC phải có "50ml", 3 hoặc nhiều loại còn lại chọn trong 6 loại: 5ml, 10ml, 20ml, 100ml, 150ml, 200ml). Sắp xếp dung tích tăng dần (ví dụ: "10ml:450000, 20ml:850000, 50ml:1950000, 100ml:3200000"). Format: "size:price" cách nhau bởi dấu phẩy. Giá tham khảo thị trường Việt Nam (VND), dung tích càng lớn giá càng cao tương xứng.
6. Price: LUÔN để 0 — sẽ tự lấy từ giá 50ml.
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
   - Tag "sale": 20-50% + PHẢI có discountStartDate & discountEndDate
   - Không tag đặc biệt: giá < 1.000.000 → 10-20%, giá 1.000.000-3.000.000 → 5-10%, giá > 3.000.000 → 0-5%
   Nếu > 10 → PHẢI điền discountStartDate & discountEndDate. Ưu tiên ngày đẹp: 7/7, 8/8, 9/9 hoặc tuần cuối tháng trong năm 2026.
10. Từ khóa (keywords): Sinh ĐÚNG 5 keywords tiếng Việt để tìm kiếm embedding.
11. Giữ nguyên pre-filled fields từ user, không thay đổi.

PRE-FILLED FIELDS (giữ nguyên): ${JSON.stringify(Object.keys(preFilled).length > 0 ? preFilled : '(không có)')}

CHỈ trả về JSON object thuần. Không markdown, không code block.

{
  "brand": "tên hãng từ danh sách",
  "tag": "tên tag từ danh sách",
  "category": "tên danh mục duy nhất từ danh sách",
  "size": "50ml:giá_tiền, size2:giá_tiền, size3:giá_tiền, size4:giá_tiền (TỐI THIỂU 4 dung tích từ 7 loại: 5ml, 10ml, 20ml, 50ml, 100ml, 150ml, 200ml, BẮT BUỘC có 50ml)",
  "description": "Bài viết mô tả chi tiết bằng HTML gồm <h2>, <h3>, <p>, <strong>",
  "discountPercentage": number,
  "discountStartDate": "ISO date string hoặc null (VD: 2026-07-07T00:00:00.000Z)",
  "discountEndDate": "ISO date string hoặc null (VD: 2026-07-31T00:00:00.000Z)",
  "longevity": "Thời gian lưu hương (VD: 7 - 9 giờ)",
  "sillage": "Độ tỏa hương (VD: 1m)",
  "scentTrail": "Vệt hương (VD: Mịn, rõ nét, sạch sẽ)",
  "season": "Mùa phù hợp, cách nhau dấu ,",
  "time": "Thời gian phù hợp, cách nhau dấu ,",
  "style": "Phong cách (VD: Lịch lãm, hiện đại)",
  "suitableFor": "Đối tượng, cách nhau dấu | (VD: văn phòng | hẹn hò)",
  "occasion": "Dịp dùng, cách nhau dấu | (VD: ban ngày | đi làm)",
  "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3", "từ khóa 4", "từ khóa 5"]
}
`;
}