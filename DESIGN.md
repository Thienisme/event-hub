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

Chỉ ba chỗ:
- Nút hành động mua hàng: "Đặt vé", "Thanh toán" (`bg-brand text-brand-foreground hover:bg-brand/90`).
- Giá vé trên thẻ và trang chi tiết (`text-brand`).
- Badge khan hiếm: "Sắp hết vé", "Còn N vé" (`bg-brand-soft text-brand`).

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
- Bo góc nhỏ (`--radius: 0.375rem`): nút và ô nhập `rounded-md`, card và ảnh `rounded-lg`. **Không dùng `rounded-2xl`, `rounded-3xl`**; `rounded-full` chỉ cho avatar và chấm trạng thái.
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

## Không làm (dấu hiệu "AI làm")

- Màu indigo, tím, xanh dương mặc định; gradient tím-hồng; nền kem + nhấn đất nung (terracotta).
- Glassmorphism (`backdrop-blur` + nền trong suốt), viền phát sáng, bóng đổ lớn có màu.
- Hero căn giữa với dòng chữ gradient và hai nút; khối "tính năng" ba cột có icon trong hình tròn màu.
- Bo góc lớn khắp nơi, card lồng card.
- Emoji trong tiêu đề, nút và thông báo.

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
