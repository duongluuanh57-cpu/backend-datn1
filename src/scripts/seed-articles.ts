import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';
import { Article } from '../models/Article.ts';

const SAMPLE_ARTICLES = [
  {
    title: 'Nghệ Thuật Lớp Hương (Fragrance Layering): Bí Quyết Tạo Dấu Ấn Riêng Biệt',
    slug: 'nghe-thuat-fragrance-layering-tao-dau-an-rieng',
    summary: 'Fragrance Layering không đơn thuần là xịt nhiều chai nước hoa cùng lúc, mà là cả một nghệ thuật phối ngẫu các nốt hương bổ trợ nhằm tạo nên chữ ký mùi hương độc bản.',
    category: 'KIENTHUC',
    thumbnail: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=1200&q=80',
    tags: ['Fragrance Layering', 'Kiến thức nước hoa', 'Phong cách cá nhân', 'Niche Perfume'],
    author: {
      name: "L'essence Editorial",
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    },
    views: 1240,
    isPublished: true,
    featured: true,
    readingTimeMinutes: 5,
    publishedAt: new Date('2026-03-10T09:00:00Z'),
    content: `
      <h2>1. Fragrance Layering Là Gì?</h2>
      <p>Fragrance Layering (phối lớp hương) là kỹ thuật kết hợp hai hay nhiều mùi hương nước hoa, sữa dưỡng thể hoặc tinh dầu thơm lên cơ thể. Mục đích là để cá nhân hóa mùi hương, giúp bạn sở hữu một mùi hương độc nhất vô nhị mà không ai có thể sao chép được.</p>
      
      <h2>2. Nguyên Tắc Cơ Bản Khi Phối Lớp Hương</h2>
      <p>Để tránh việc các mùi hương xung đột và tạo cảm giác nồng gắt khó chịu, hãy ghi nhớ các nguyên tắc vàng sau:</p>
      <ul>
        <li><strong>Nặng trước, nhẹ sau:</strong> Xịt những chai có nốt hương gỗ, da thuộc, hổ phách trước làm lớp nền (base), sau đó phủ lên bằng các nốt hương thanh mát như hoa cỏ (floral) hoặc cam chanh (citrus).</li>
        <li><strong>Cùng nhóm họ hương:</strong> Bắt đầu an toàn bằng cách kết hợp các mùi hương có cùng một nhóm (chẳng hạn như Vanilla với Caramel, hoặc Rose kết hợp với Peony).</li>
        <li><strong>Tương phản hài hòa:</strong> Khi đã thuần thục, bạn có thể thử kết hợp nhóm đối lập như Hương Khói bí ẩn với Hương Cam Begarmot sảng khoái.</li>
      </ul>

      <h2>3. Gợi Ý Các Combo Độc Đáo</h2>
      <p>Một số gợi ý phối lớp kinh điển được các nhà thẩm hương chuyên nghiệp đánh giá cao:</p>
      <p><em>Gỗ Tuyết Tùng + Hoa Nhài Trắng:</em> Tạo cảm giác vừa thanh tao vừa trầm ấm, cực kỳ thích hợp cho các buổi dạ tiệc mùa thu đông.</p>
      <p><em>Hổ Phách Vani + Vỏ Quýt Hồng:</em> Sự ngọt ngào béo ngậy được cân bằng hoàn hảo bởi vị chua thanh, tạo nét quyến rũ khó cưỡng.</p>
    `,
  },
  {
    title: 'Khám Phá Xu Hướng Nước Hoa Gourmand: Khi Ẩm Thực Biến Hóa Thành Nốt Hương',
    slug: 'kham-pha-xu-huong-nuoc-hoa-gourmand',
    summary: 'Nhóm hương Gourmand ngọt ngào với cảm hứng từ sô-cô-la, vani, cà phê và hạnh nhân đang trở thành tâm điểm thu hút giới mộ điệu trong năm nay.',
    category: 'XUHUONG',
    thumbnail: 'https://images.unsplash.com/photo-1547887537-6158d64c35b3?auto=format&fit=crop&w=1200&q=80',
    tags: ['Gourmand', 'Xu hướng', 'Nước hoa ngọt', 'Vanilla', 'Coffee Perfume'],
    author: {
      name: 'Trần Minh Huy (Scent Critic)',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
    },
    views: 980,
    isPublished: true,
    featured: true,
    readingTimeMinutes: 4,
    publishedAt: new Date('2026-03-08T14:30:00Z'),
    content: `
      <h2>Sự Trỗi Dậy Của Nước Hoa Mùi Đồ Ăn</h2>
      <p>Bắt đầu từ huyền thoại Thierry Mugler Angel ra mắt vào những năm 1990, nhóm hương <strong>Gourmand</strong> (hương mang âm hưởng món ăn ngọt ngào) đã mở ra một kỷ nguyên mới. Bước sang năm nay, các nhà điều chế nước hoa đã nâng tầm Gourmand lên một nấc thang phức tạp và sang trọng hơn.</p>

      <h2>Những Nốt Hương Gourmand Được Yêu Thích Nhất</h2>
      <ol>
        <li><strong>Cà Phê Rang & Rượu Rum:</strong> Mang lại sự chững chạc, ấm cúng và đầy lôi cuốn trong những ngày se lạnh.</li>
        <li><strong>Praline & Sô-cô-la đen:</strong> Sự ngọt ngào sâu lắng của hạt dẻ ngào đường quyện cùng vị đắng nhẹ của cacao nguyên chất.</li>
        <li><strong>Madagascar Vanilla:</strong> Không còn là vị ngọt kẹo ngây thơ, vanilla hiện đại được hun khói và hòa quyện cùng nhựa cây hổ phách.</li>
      </ol>

      <p>Hương Gourmand không chỉ kích thích khứu giác mà còn mang lại cảm giác xoa dịu tâm trí, an ủi cảm xúc trong nhịp sống hối hả hiện đại.</p>
    `,
  },
  {
    title: 'Top 5 Chai Nước Hoa Nam Sang Trọng Cho Doanh Nhân Thành Đạt',
    slug: 'top-5-nuoc-hoa-nam-sang-trong-doanh-nhan',
    summary: 'Điểm danh 5 tuyệt tác mùi hương dành riêng cho phái mạnh: khẳng định vị thế, toát lên thần thái lịch lãm và bản lĩnh đỉnh cao trong từng cuộc gặp gỡ.',
    category: 'SANPHAM',
    thumbnail: 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?auto=format&fit=crop&w=1200&q=80',
    tags: ['Nước hoa nam', 'Doanh nhân', 'Sang trọng', 'Gỗ đàn hương', 'Bleu de Chanel'],
    author: {
      name: "L'essence Editorial",
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    },
    views: 2150,
    isPublished: true,
    featured: true,
    readingTimeMinutes: 6,
    publishedAt: new Date('2026-03-05T08:15:00Z'),
    content: `
      <h2>1. Creed Aventus — Biểu Tượng Của Kẻ Dẫn Đầu</h2>
      <p>Không cần phải giới thiệu quá nhiều, Creed Aventus luôn là lựa chọn hàng đầu của giới tài phiệt và quý ông thành đạt. Mở đầu bằng hương dứa khói sảng khoái và kết thúc bằng long diên hương quý phái, chai nước hoa này là tuyên ngôn sức mạnh không lời.</p>

      <h2>2. Tom Ford Oud Wood — Đẳng Cấp Trầm Hương Quý Hiếm</h2>
      <p>Sự kết hợp kỳ diệu giữa Trầm hương, Gỗ cẩm lai và Bạch đậu khấu tạo nên một bản giao hưởng vừa huyền bí vừa quyền lực. Thích hợp cho những cuộc họp cấp cao hay dạ tiệc trang trọng.</p>

      <h2>3. Bleu de Chanel Parfum — Sự Lịch Lãm Vượt Thời Gian</h2>
      <p>Đậm đặc, tinh tế và nam tính tuyệt đối. Nốt gỗ đàn hương New Caledonia hòa quyện cùng vỏ bưởi thanh mát mang lại cảm giác chỉn chu và đáng tin cậy.</p>

      <h2>4. Roja Elysium Pour Homme — Vẻ Đẹp Thượng Lưu Tinh Tế</h2>
      <p>Một kiệt tác Niche với sự bùng nổ của cam quýt, quả bách xù và xạ hương trắng cao cấp, giúp người đàn ông luôn tự tin và tỏa sáng trong mọi không gian.</p>
    `,
  },
  {
    title: 'Sự Khác Biệt Giữa Nước Hoa Niche Và Designer: Lựa Chọn Nào Dành Cho Bạn?',
    slug: 'su-khac-biet-giua-nuoc-hoa-niche-va-designer',
    summary: 'Nước hoa Niche đại diện cho nghệ thuật sáng tạo không giới hạn, trong khi Designer là biểu tượng của sự phổ quát và thời thượng. Hãy cùng giải mã hai thế giới này.',
    category: 'KIENTHUC',
    thumbnail: 'https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?auto=format&fit=crop&w=1200&q=80',
    tags: ['Niche', 'Designer', 'Kiến thức nước hoa', 'Phân loại nước hoa'],
    author: {
      name: 'Lê Hoàng Nam',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
    },
    views: 1840,
    isPublished: true,
    featured: false,
    readingTimeMinutes: 4,
    publishedAt: new Date('2026-03-01T11:00:00Z'),
    content: `
      <h2>1. Nước Hoa Designer Là Gì?</h2>
      <p>Nước hoa Designer là những sáng tạo mùi hương đến từ các thương hiệu thời trang danh tiếng như Chanel, Dior, Gucci, YSL,... Chúng được thiết kế để phục vụ số đông, dễ dùng, nịnh mũi và bắt kịp thị hiếu toàn cầu.</p>

      <h2>2. Nước Hoa Niche Là Gì?</h2>
      <p>Ngược lại, các nhà làm hương Niche như Diptyque, Kilian, Maison Francis Kurkdjian, Byredo tập trung 100% vào nghệ thuật điều hương thủ công. Họ không chạy theo doanh số đại trà mà hướng tới những nguyên liệu đắt giá, độc lạ và câu chuyện cảm xúc riêng.</p>

      <h2>Bảng So Sánh Nhanh</h2>
      <ul>
        <li><strong>Độ phổ biến:</strong> Designer rất dễ bắt gặp; Niche khó đụng hàng và mang tính cá nhân cao.</li>
        <li><strong>Nguyên liệu:</strong> Niche thường chuộng tinh dầu tự nhiên hiếm; Designer ứng dụng hương nhân tạo bền bỉ và hiện đại.</li>
        <li><strong>Giá thành:</strong> Niche thường có mức giá cao hơn đáng kể.</li>
      </ul>
    `,
  },
  {
    title: 'Ưu Đãi Đặc Biệt Tháng 3: Đón Mùa Hoa Nở Cùng Bộ Sưu Tập Spring Floral',
    slug: 'uu-dai-dac-biet-thang-3-spring-floral',
    summary: 'Chào đón tiết trời mùa xuân với chương trình quà tặng độc quyền: Giảm đến 20% cho tất cả dòng hương hoa cỏ mùa xuân và tặng kèm minisize cao cấp.',
    category: 'SUKIEN',
    thumbnail: 'https://images.unsplash.com/photo-1615397349754-cfa2066a298e?auto=format&fit=crop&w=1200&q=80',
    tags: ['Ưu đãi', 'Khuyến mãi', 'Sự kiện', 'Mùa xuân', 'Gift with purchase'],
    author: {
      name: "L'essence Editorial",
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    },
    views: 750,
    isPublished: true,
    featured: false,
    readingTimeMinutes: 3,
    publishedAt: new Date('2026-02-28T10:00:00Z'),
    content: `
      <h2>Mùa Xuân Ngập Tràn Hương Hoa Cùng L'essence</h2>
      <p>Mùa xuân là thời điểm vạn vật bừng nở, và cũng là lúc bạn nên thay áo mới cho tủ nước hoa của mình bằng những nốt hương hoa tươi mát, tràn đầy năng lượng tích cực.</p>

      <h2>Chi Tiết Chương Trình Khuyến Mãi</h2>
      <ul>
        <li><strong>Giảm 15% - 20%:</strong> Áp dụng cho các bộ sưu tập Floral & Fresh từ ngày 01/03 đến 15/03/2026.</li>
        <li><strong>Tặng Mini Discovery Set 3x5ml:</strong> Cho hóa đơn từ 3.000.000 VNĐ.</li>
        <li><strong>Miễn phí gói quà nghệ thuật:</strong> Kèm thiệp viết tay theo yêu cầu.</li>
      </ul>

      <p>Số lượng quà tặng có hạn, hãy nhanh chân ghé thăm cửa hàng hoặc đặt hàng trực tuyến ngay hôm nay!</p>
    `,
  },
  {
    title: 'Bí Quyết Bảo Quản Nước Hoa Đúng Cách Giữ Trọn Vẹn Hương Thơm Suốt Nhiều Năm',
    slug: 'bi-quyet-bao-quan-nuoc-hoa-dung-cach',
    summary: 'Nước hoa có thể bị biến chất, đổi màu hoặc bay mùi nếu bạn bảo quản sai cách. Hãy nắm vững 4 nguyên tắc bảo quản nước hoa chuẩn phòng lab.',
    category: 'KIENTHUC',
    thumbnail: 'https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=1200&q=80',
    tags: ['Bảo quản nước hoa', 'Mẹo hay', 'Kiến thức mùi hương', 'Thời hạn sử dụng'],
    author: {
      name: 'Nguyễn Diệu Linh',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80',
    },
    views: 1420,
    isPublished: true,
    featured: false,
    readingTimeMinutes: 4,
    publishedAt: new Date('2026-02-25T16:00:00Z'),
    content: `
      <h2>1. Kẻ Thù Số Một: Ánh Nắng Mặt Trời</h2>
      <p>Bức xạ tử ngoại (UV) trong ánh nắng sẽ phá vỡ các liên kết hóa học của tinh dầu nước hoa, khiến mùi hương bị biến tính và có mùi khét lạ. Hãy luôn cất giữ chai nước hoa trong hộp giấy hoặc trong tủ kín.</p>

      <h2>2. Tránh Xa Nơi Có Độ Ẩm Cao (Phòng Tắm)</h2>
      <p>Nhiều người có thói quen để nước hoa trong nhà tắm để tiện sử dụng sau khi tắm. Tuy nhiên, sự dao động nhiệt độ và độ ẩm liên tục trong phòng tắm sẽ làm giảm tuổi thọ của nước hoa nhanh chóng.</p>

      <h2>3. Giữ Nhiệt Độ Ổn Định</h2>
      <p>Nhiệt độ lý tưởng nhất để bảo quản nước hoa là từ 15°C đến 22°C. Tránh để trong cốp xe máy hoặc cạnh cửa sổ.</p>
    `,
  },
  {
    title: 'Review Chi Tiết Siêu Phẩm Maison Francis Kurkdjian Baccarat Rouge 540',
    slug: 'review-chi-tiet-mfk-baccarat-rouge-540',
    summary: 'Được mệnh danh là mùi hương của giới thượng lưu, Baccarat Rouge 540 sở hữu sức hút ma mị từ nghệ tây safranal, hổ phách xám và gỗ tuyết tùng.',
    category: 'SANPHAM',
    thumbnail: 'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=1200&q=80',
    tags: ['MFK 540', 'Baccarat Rouge', 'Review nước hoa', 'Nước hoa Niche'],
    author: {
      name: 'Trần Minh Huy (Scent Critic)',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
    },
    views: 3100,
    isPublished: true,
    featured: true,
    readingTimeMinutes: 5,
    publishedAt: new Date('2026-02-20T09:30:00Z'),
    content: `
      <h2>Hiện Tượng Toàn Cầu Mang Tên BR540</h2>
      <p>Ra mắt ban đầu như một phiên bản giới hạn kỷ niệm 250 năm của nhà pha lê Baccarat, Baccarat Rouge 540 nhanh chóng trở thành một cơn sốt trên toàn thế giới nhờ mùi hương ngọt ngào sang trọng tựa đường cháy và hổ phách khoáng đạt.</p>

      <h2>Kim Tự Tháp Mùi Hương</h2>
      <ul>
        <li><strong>Hương đầu:</strong> Nhụy hoa nghệ tây (Saffron), Hoa nhài Grandiflorum.</li>
        <li><strong>Hương giữa:</strong> Amberwood, Long diên hương khoáng chất.</li>
        <li><strong>Hương cuối:</strong> Nhựa thông linh sam, Gỗ tuyết tùng Virginia.</li>
      </ul>

      <h2>Độ Lưu Hương & Tỏa Hương</h2>
      <p>Khả năng bám tỏa của BR540 thuộc hàng "quái vật", có thể lưu lại trên quần áo suốt 24 giờ và để lại vệt hương khó phai mỗi khi bạn bước qua.</p>
    `,
  },
  {
    title: 'Xu Hướng Nước Hoa Unisex: Phá Bỏ Mọi Ranh Giới Định Kiến Giới Tính',
    slug: 'xu-huong-nuoc-hoa-unisex-pha-bo-ranh-gioi',
    summary: 'Mùi hương không có giới tính. Xu hướng nước hoa phi giới tính (Unisex/Genderless) đang ngày càng thống trị thị trường nhờ sự tự do và phóng khoáng.',
    category: 'XUHUONG',
    thumbnail: 'https://images.unsplash.com/photo-1528740561666-dc2479dc08ab?auto=format&fit=crop&w=1200&q=80',
    tags: ['Unisex', 'Genderless', 'Xu hướng mùi hương', 'Tự do biểu đạt'],
    author: {
      name: 'Lê Hoàng Nam',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
    },
    views: 890,
    isPublished: true,
    featured: false,
    readingTimeMinutes: 4,
    publishedAt: new Date('2026-02-15T13:45:00Z'),
    content: `
      <h2>Mùi Hương Là Cảm Xúc, Không Phải Nhãn Mác</h2>
      <p>Trước thế kỷ 20, nước hoa vốn dĩ không hề phân biệt nam hay nữ. Vua Louis XIV từng ưa chuộng mùi hương hoa cam và hoa hồng. Việc phân chia nước hoa nam/nữ thực chất chỉ là chiến dịch marketing của thời kỳ cận đại.</p>

      <h2>Vì Sao Nước Hoa Unisex Trở Nên Hút Khách?</h2>
      <p>Người dùng ngày nay tìm kiếm sự tự do thể hiện cái tôi hơn là tuân theo khuôn mẫu. Những nốt hương như Trà Xanh, Gỗ Đàn Hương, Cỏ Hương Bài Vetiver hay Vỏ Cam Bergamot mang lại sự thư thái và thanh lịch cho bất kỳ ai khoác chúng lên mình.</p>
    `,
  },
  {
    title: 'Workshop Nghệ Thuật Điều Chế Nước Hoa Thủ Công Cùng Chuyên Gia Pháp',
    slug: 'workshop-dieu-che-nuoc-hoa-thu-cong-cung-chuyen-gia-phap',
    summary: 'Cơ hội tự tay tạo nên chai nước hoa mang dấu ấn của riêng bạn dưới sự hướng dẫn trực tiếp từ chuyên gia Master Perfumer đến từ Grasse (Pháp).',
    category: 'SUKIEN',
    thumbnail: 'https://images.unsplash.com/photo-1608528577891-9855b85ee4bf?auto=format&fit=crop&w=1200&q=80',
    tags: ['Workshop', 'Grasse', 'Pha chế nước hoa', 'Trải nghiệm'],
    author: {
      name: "L'essence Editorial",
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    },
    views: 620,
    isPublished: true,
    featured: false,
    readingTimeMinutes: 3,
    publishedAt: new Date('2026-02-10T15:00:00Z'),
    content: `
      <h2>Trải Nghiệm Trở Thành Nhà Điều Chế Hương (Le Nez)</h2>
      <p>L'essence hân hạnh tổ chức buổi workshop đặc biệt dành riêng cho các tín đồ mê hương. Bạn sẽ được tiếp cận hơn 50 loại tinh dầu cao cấp nhập khẩu trực tiếp từ thủ phủ hương thơm Grasse, Pháp.</p>

      <h2>Nội Dung Workshop</h2>
      <ul>
        <li>Tìm hiểu lịch sử và nguyên lý phân tầng kim tự tháp nốt hương.</li>
        <li>Thực hành ngửi và nhận diện các họ hương cơ bản.</li>
        <li>Tự tay công thức hóa và đóng chai sản phẩm cá nhân 50ml mang về.</li>
      </ul>
    `,
  },
  {
    title: 'Top 7 Nốt Hương Hoa Nhài (Jasmine) Quyến Rũ Nhất Trong Thế Giới Hương Thơm',
    slug: 'top-7-not-huong-hoa-nhai-quyen-ru-nhat',
    summary: 'Hoa nhài – "Nữ hoàng của các loài hoa trong ngành nước hoa" mang vẻ đẹp vừa trong trẻo, vừa nồng nàn mê đắm.',
    category: 'KIENTHUC',
    thumbnail: 'https://images.unsplash.com/photo-1563178406-4cdc2923acbc?auto=format&fit=crop&w=1200&q=80',
    tags: ['Hoa nhài', 'Jasmine', 'Nốt hương quyến rũ', 'Floral'],
    author: {
      name: 'Nguyễn Diệu Linh',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80',
    },
    views: 1120,
    isPublished: true,
    featured: false,
    readingTimeMinutes: 4,
    publishedAt: new Date('2026-02-05T07:30:00Z'),
    content: `
      <h2>1. Sức Hút Vĩnh Cửu Của Hoa Nhài</h2>
      <p>Cùng với Hoa Hồng, Hoa Nhài (Jasmine) là một trong hai trụ cột cốt lõi của ngành công nghiệp nước hoa Pháp. Hoa nhài thường phải được thu hoạch vào sáng sớm trước khi mặt trời mọc để giữ trọn vẹn tinh chất quý giá nhất.</p>

      <h2>2. Các Dạng Hương Nhài Phổ Biến</h2>
      <p><strong>Jasmine Sambac:</strong> Ngọt ngào, nồng ấm và hơi mang sắc thái trà thảo mộc.</p>
      <p><strong>Jasmine Grandiflorum:</strong> Thanh lịch, quý phái và là linh hồn trong các tuyệt phẩm nước hoa cổ điển Pháp.</p>
    `,
  },
];

async function main() {
  console.log('🌸 Bắt đầu seed 10 bài viết tin tức chất lượng cao...');

  await connectDB();

  for (const item of SAMPLE_ARTICLES) {
    const existing = await Article.findOne({ slug: item.slug });
    if (existing) {
      console.log(`ℹ️  Bài viết "${item.title}" đã tồn tại -> Cập nhật thông tin.`);
      await Article.updateOne({ slug: item.slug }, { $set: item });
    } else {
      await Article.create(item);
      console.log(`✨ Đã tạo bài viết mới: "${item.title}"`);
    }
  }

  const count = await Article.countDocuments();
  console.log(`\n🎉 Seed thành công! Tổng số bài viết trong database hiện tại: ${count}`);

  await mongoose.disconnect();
  console.log('🍃 Đã ngắt kết nối database.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Lỗi khi seed bài viết:', err);
  await mongoose.disconnect();
  process.exit(1);
});
