# DESIGN.md

Hệ thiết kế của Event Hub. Mọi AI và người làm giao diện đọc file này trước khi sửa `client/`. Token thật nằm ở `client/src/style.css`; file này giải thích cách dùng. Hai nơi lệch nhau thì sửa cho khớp, đừng chọn một bên.

## Hướng thiết kế: Đen trắng + một điểm nhấn

Hiện đại, sang trọng, tiết chế. Giống tờ chương trình của một nhà hát: nền trắng, chữ đen, nhiều khoảng trống, và **một** màu đỏ rượu như cuống vé. Sang trọng đến từ khoảng trắng, chữ đậm và căn lề chuẩn, không đến từ màu, bóng đổ hay hiệu ứng.

Tham chiếu cảm giác (không sao chép): trang sự kiện của Apple, Vercel, Nothing, Bang & Olufsen.

Ba câu để tự kiểm tra một màn hình:
1. Bỏ màu đỏ đi, trang có còn đọc được thứ bậc không? Phải còn: thứ bậc đến từ cỡ chữ và độ đậm.
2. Trên màn hình có quá **một** chỗ dùng màu đỏ nổi bật không? Nếu có, bớt đi.
3. Có chỗ nào dùng bóng đổ, gradient hay viền dày để "cho đẹp" không? Bỏ.

## Màu

Chỉ dùng class theo token. **Không viết class màu thô** của Tailwind (`indigo-*`, `gray-*`, `slate-*`, `blue-*`, `purple-*`, `zinc-*`...) và không viết mã hex trong component.

| Token (class) | Sáng | Dùng cho |
|---|---|---|
| `background` | `#FFFFFF` | nền card, ô nhập, popover |
| `surface` | `#FAFAFA` | nền trang (body đã gắn sẵn) |
| `foreground` | `#0A0A0A` | chữ chính, tiêu đề |
| `muted-foreground` | `#6B6B6B` | chữ phụ, nhãn, mô tả, ngày giờ |
| `muted` / `secondary` / `accent` | `#F5F5F5` | nền phụ, hover của nút ghost/outline, skeleton |
| `border` / `input` | `#E5E5E5` | mọi đường kẻ và viền |
| `primary` | `#0A0A0A` | nút chính (đen đặc), link, vòng focus |
| `brand` | `#8C1C2B` | **điểm nhấn duy nhất**, xem luật bên dưới |
| `brand-soft` | `#F7ECEE` | nền rất nhạt đi kèm chữ `brand` (badge "Sắp hết vé") |
| `success` / `warning` / `danger` / `info` | giữ nguyên | chỉ cho trạng thái (đơn, check-in, lỗi), không trang trí |
| `destructive` | đỏ tươi | nút xoá, huỷ. Khác hẳn `brand` để không nhầm "mua" với "xoá" |

### Luật dùng màu đỏ rượu `brand`

Chỉ những chỗ sau:
- Nút hành động mua hàng: "Đặt vé", "Thanh toán" (`bg-brand text-brand-foreground hover:bg-brand/90`).
- Giá vé trên thẻ và trang chi tiết (`text-brand`).
- Badge khan hiếm: "Sắp hết vé", "Còn N vé" (`bg-brand-soft text-brand`).
- Ưu đãi ở trang sự kiện: dòng "Có ưu đãi · Giảm đến 20%" (`bg-brand-soft text-brand`). Thẻ ưu đãi trong trang thanh toán thì không dùng `brand`.

Mọi nút khác dùng `primary` (đen) hoặc `outline`. Logo, tiêu đề, menu, icon **không** dùng `brand`.

## Chữ

- Font duy nhất: **Be Vietnam Pro** (400, 500, 600, 700, 800), đủ dấu tiếng Việt. Không thêm font thứ hai.
- Tiêu đề trang: `text-3xl sm:text-4xl font-extrabold tracking-tight`.
- Tiêu đề khối, tên sự kiện trên trang chi tiết: `text-xl sm:text-2xl font-bold tracking-tight`.
- Tên sự kiện trên thẻ: `text-base font-semibold`.
- Chữ thường: `text-sm` hoặc `text-base`, `leading-6`. Chữ phụ: `text-sm text-muted-foreground`.
- Nhãn nhỏ trên tiêu đề (eyebrow): `text-xs font-semibold uppercase tracking-widest text-muted-foreground`. Không tô màu.
- Số (giá, thống kê, đồng hồ đếm ngược): thêm `tabular-nums`.
- Không dùng chữ gradient, không dùng chữ nghiêng để trang trí.

## Khoảng cách, bo góc, viền

- Lưới 4px của Tailwind. Khoảng giữa các khối lớn: `space-y-8` đến `space-y-12`; trong card: `p-5 sm:p-6`.
- Bề rộng nội dung: `max-w-6xl mx-auto px-4 sm:px-6`. Form và trang hồ sơ: `max-w-3xl`.
- Bo góc nhỏ (`--radius: 0.375rem`): nút và ô nhập `rounded-md`, card và ảnh `rounded-lg`. **Không dùng `rounded-2xl`, `rounded-3xl`**; `rounded-full` chỉ cho avatar, chấm trạng thái và khấc cuống vé.
- Tách khối bằng viền mảnh `border` (1px, màu `border`), không bằng bóng đổ. Bóng đổ tối đa `shadow-xs`, chỉ cho popover, dropdown và dialog.

## Thành phần

- **Nút:** `default` (đen) cho hành động chính của màn hình, `outline` cho hành động phụ, `ghost` trong thanh công cụ, `destructive` cho xoá/huỷ, `brand` chỉ theo luật ở trên. Mỗi màn hình tối đa một nút đen hoặc đỏ nổi bật.
- **Card:** nền `background`, viền `border`, không bóng, bo `rounded-lg`.
- **Thẻ sự kiện:** ảnh tỉ lệ cố định ở trên, rồi danh mục (eyebrow), tên, ngày, địa điểm, giá (`text-brand font-semibold`). Hover: ảnh phóng nhẹ (`scale-[1.02]`), không nhấc cả thẻ lên, không đổi màu viền.
- **Badge:** mặc định `outline` xám. Màu chỉ cho trạng thái thật (đã thanh toán, đã check-in, hết hạn).
- **Ô nhập:** viền `input`, focus vòng đen mảnh (đã có trong component shadcn). Không tô nền xám.
- **Icon:** lucide, nét `size-4`, cùng màu với chữ bên cạnh. Không dùng emoji thay icon.

## Chuyển động

- `transition-colors` hoặc `transition-transform`, `duration-200`, easing mặc định. Không animation khi tải trang, không parallax.
- Tôn trọng `motion-reduce:` cho mọi chuyển động lớn hơn đổi màu.

## Dấu ấn riêng: tấm vé

Thứ làm Event Hub khác một trang quản trị chung chung là **hình ảnh sự kiện và hình tấm vé**, không phải màu sắc.

- **Có ảnh thì dùng ảnh.** Mọi chỗ nói về một sự kiện (thẻ sự kiện, đơn vé, tóm tắt thanh toán) hiện ảnh bìa (`bannerUrl` qua `resolveMediaUrl`), tỉ lệ cố định, `object-cover`. Ảnh lỗi hoặc không có: khối `bg-muted` cùng kích thước, không để trống trắng.
- **Ô ngày** kiểu tờ lịch đặt góc ảnh: số ngày to `text-xl font-extrabold tabular-nums`, dòng tháng nhỏ `text-[10px] font-semibold uppercase tracking-widest`, nền `bg-background`, bo `rounded-md`. Người dùng nhìn ngày trước khi đọc chữ.
- **Cuống vé**: phần giá, trạng thái và nút được tách khỏi phần thông tin bằng đường kẻ đứt (`border-dashed`) và hai khấc tròn ở hai đầu đường kẻ (`size-4 rounded-full bg-surface` có viền `border`, đặt tuyệt đối đè lên mép card). Dọc trên desktop, ngang trên mobile. Đây là ngoại lệ duy nhất của `rounded-full` ngoài avatar và chấm trạng thái.
- **Trạng thái hiện bằng nội dung, không bằng viền màu**: badge trạng thái; đơn huỷ/hết hạn thì ảnh `grayscale opacity-60` và giá `text-muted-foreground`; đơn chờ thanh toán có đồng hồ đếm ngược.
- **Dòng mô tả dưới tiêu đề trang phải mang dữ liệu thật** ("2 sự kiện sắp tới · 1 đơn chờ thanh toán"), không viết câu giới thiệu chung chung kiểu "Quản lý ... cho những trải nghiệm sắp tới". Không có gì thật để nói thì bỏ dòng đó.

## Không làm (dấu hiệu "AI làm")

Người dùng nhận ra giao diện do AI làm qua những mẫu dưới đây. Gặp trong code cũ thì sửa luôn khi đang đụng tới file đó.

- Màu indigo, tím, xanh dương mặc định; gradient tím-hồng; nền kem + nhấn đất nung (terracotta).
- Glassmorphism (`backdrop-blur` + nền trong suốt), viền phát sáng, bóng đổ lớn có màu.
- Hero căn giữa với dòng chữ gradient và hai nút; khối "tính năng" ba cột có icon trong hình tròn màu.
- Bo góc lớn khắp nơi, card lồng card.
- Emoji trong tiêu đề, nút và thông báo.
- **Viền trái dày tô màu** (`border-l-2`, `border-l-4` kèm màu trạng thái) để đánh dấu card hay khối thông báo. Dùng badge, ảnh, hoặc cuống vé ở trên.
- **Icon nằm trong ô vuông/tròn nền nhạt** (`rounded-lg bg-primary/5 p-4` bọc icon) ở trạng thái rỗng, tiêu đề khối. Trạng thái rỗng chỉ cần câu chữ rõ ràng và một nút; nếu cần hình thì icon trần `size-8 text-muted-foreground`.
- **Trang toàn chữ khi dữ liệu có ảnh**: danh sách đơn, vé, sự kiện chỉ có tiêu đề + ngày + địa điểm xếp dọc, mọi card giống hệt nhau.
- Mọi khối cùng một trọng lượng: không có gì to hơn để mắt bắt vào trước. Mỗi trang cần **một** điểm nhìn chính (ảnh lớn, ô ngày, tổng tiền), phần còn lại lùi lại.
- Badge đếm số trong mọi tab, icon trước mọi dòng chữ, nhãn "Đơn giá" lặp lại dưới mỗi dòng: chi tiết thừa làm trang rối. Giữ thông tin người dùng thực sự cần ở màn hình đó.
- Câu chữ kiểu tiếp thị chung chung ("trải nghiệm tuyệt vời", "hành trình", "khám phá ngay những ...") ở nơi người dùng đang làm việc.

### Tự kiểm tra trước khi giao

1. Chụp màn hình desktop (1280px) và mobile (360px), nhìn như người dùng lần đầu: có biết ngay sự kiện nào, ngày nào, cần làm gì không?
2. Che chữ đi: còn nhận ra đây là trang bán vé sự kiện (ảnh, ô ngày, cuống vé) hay chỉ là danh sách card?
3. Chạy lệnh tìm mẫu AI:

```bash
grep -rnE 'border-l-(2|4|8)|bg-(primary|brand|muted|accent)(/[0-9]+)? p-[3-5]"><[A-Z]|backdrop-blur|bg-gradient-to-[a-z]+ from-(indigo|purple|pink|violet)' client/src --include=*.vue | grep -v components/ui
```

## Bảng đổi class cũ sang token

Dùng khi sửa các view còn viết màu thô.

| Cũ | Mới |
|---|---|
| `bg-indigo-600 hover:bg-indigo-700 text-white` (nút) | bỏ, dùng `<Button>` mặc định; nút mua hàng dùng `bg-brand text-brand-foreground hover:bg-brand/90` |
| `text-indigo-600`, `text-indigo-700` (link, nhấn) | `text-foreground underline-offset-4 hover:underline`; giá vé dùng `text-brand` |
| `bg-indigo-50` | `bg-muted` (hoặc `bg-brand-soft` nếu là badge khan hiếm) |
| `border-indigo-500`, `ring-indigo-*` | `border-ring` / bỏ, dùng focus mặc định của component |
| `text-gray-900`, `text-gray-800` | `text-foreground` |
| `text-gray-700`, `text-gray-600`, `text-gray-500`, `text-gray-400` | `text-muted-foreground` |
| `bg-white` | `bg-background` (thường bỏ được vì Card đã có nền) |
| `bg-gray-50`, `bg-gray-100` | `bg-surface` (nền trang) hoặc `bg-muted` (nền phụ) |
| `border-gray-100`, `border-gray-200`, `border-gray-300` | `border-border` (hoặc chỉ `border`) |
| `text-red-600`, `text-red-500` (lỗi) | `text-danger` |
| `bg-green-*`, `text-green-*` (thành công) | `bg-success/10 text-success` |
| `rounded-2xl`, `rounded-3xl` | `rounded-lg` |
| `shadow-sm`, `shadow-md`, `shadow-lg` trên card | bỏ |

Kiểm tra nhanh còn sót class màu thô:

```bash
grep -rnE '\b(bg|text|border|ring|from|to|via)-(indigo|gray|slate|zinc|neutral|stone|blue|sky|purple|violet|red|rose|green|emerald|orange|amber|yellow)-[0-9]+' client/src --include=*.vue
```
