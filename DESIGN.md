# DESIGN.md

Hệ thiết kế của Event Hub. Mọi AI và người làm giao diện đọc file này trước khi sửa `client/`. Token thật nằm ở `client/src/style.css`; file này giải thích cách dùng. Hai nơi lệch nhau thì sửa cho khớp, đừng chọn một bên.

## Hướng thiết kế: "Cuống vé"

Bán vé thì giao diện chính là **tấm vé**. Nền trang tối như mặt bàn than; trên đó mỗi sự kiện là một **tấm vé giấy trắng** có đường xé, khía răng cưa hai bên, cuống vé màu theo danh mục, mã vạch và số seri. Chữ tiêu đề bản hẹp, đậm như in trên vé; số, nhãn, giá in bằng font mono như máy in vé.

- **Hai lớp bề mặt:** trang tối (`surface`, card `background`) cho khung, form, quản trị; **vé giấy** (`.paper`) chỉ cho thứ người dùng "cầm": thẻ sự kiện, khung chọn vé, vé trong "Vé của tôi", tóm tắt đơn khi thanh toán.
- **Màu đến từ danh mục** (cuống vé, ô ngày, chấm nhãn) và ảnh sự kiện.
- **Cam `brand` chỉ dành cho hành động mua** (nút Đặt vé/Thanh toán), giá và khan hiếm. Trên giấy trắng, chữ `text-brand` tự đổi sang đỏ mộc (`stamp`) vì cam trên trắng không đủ tương phản.

Ba câu để tự kiểm tra một màn hình:
1. Che chữ đi, còn nhận ra đây là trang bán vé không (vé giấy, cuống màu, đường xé)?
2. Nút mua có còn là thứ nổi nhất màn hình không?
3. Mỗi màu có gắn với một danh mục, trạng thái hay hành động cụ thể không?

## Màu

Chỉ dùng class theo token. **Không viết class màu thô** của Tailwind (`indigo-*`, `gray-*`, `slate-*`...) và không viết mã hex trong component. Giao diện chỉ có chế độ tối: `index.html` gắn sẵn class `dark` (để các biến thể `dark:` của shadcn chạy đúng) và `color-scheme: dark`.

| Token (class) | Giá trị | Dùng cho |
|---|---|---|
| `surface` | `#161616` | nền trang (body đã gắn sẵn), khấc vé |
| `background` / `card` | `#202020` | card, ô nhập, khung form trên nền tối |
| `foreground` | `#EDEDED` | chữ chính |
| `muted-foreground` | `#A3A3A3` | chữ phụ, nhãn, ngày giờ |
| `muted` / `secondary` / `accent` | `#2A2A2A` | nền phụ, hover nút ghost/outline |
| `border` / `input` | `#333333` / `#3A3A3A` | đường kẻ, viền |
| `primary` | `#EDEDED`, chữ `#111` | nút chính sáng đặc, vòng focus |
| `brand` | `#FF5A1F`, chữ `#111` | **điểm nhấn mua hàng**, xem luật bên dưới |
| `brand-soft` | `#3A1F14` | nền badge khan hiếm trên nền tối |
| `paper` / `paper-foreground` | `#FAFAFA` / `#111111` | vé giấy |
| `stamp` | `#C2290B` | mộc đỏ, giá và khan hiếm **trên giấy** |
| `success` / `warning` / `danger` / `info` | giữ nguyên | chỉ cho trạng thái |
| `destructive` | đỏ tươi | xoá, huỷ. Khác hẳn `brand` để không nhầm "mua" với "xoá" |

Tương phản đã đo (WCAG): chữ chính trên nền 15,5:1; chữ phụ trên card 6,5:1; cam trên nền 5,8:1; chữ đen trên nút cam 6,1:1; chữ phụ trên giấy 6,6:1; mộc đỏ trên giấy 5,6:1.

### Vé giấy (`.paper`)

Thêm class `paper` vào phần tử bao. Bên trong, mọi token (`background`, `foreground`, `muted-foreground`, `border`, `primary`, `brand-soft`, trạng thái...) tự đổi sang bản mực đen trên giấy, nên `Button`, `Badge`, `text-muted-foreground` dùng như bình thường. Không lồng `.paper` trong `.paper`.

- **Đường xé + khía:** `ticket-notch` với `--cut` là vị trí đường xé tính từ trên (ví dụ `style="--cut: calc(100% - 4.5rem)"`), kèm phần cuống có `border-t-2 border-dashed`. Đường xé dọc dùng `ticket-notch-x` với `--cut-x`. Thẻ đơn trong "Vé của tôi" dùng hai khấc `size-5 rounded-full bg-surface` đặt đè mép.
- **Mã vạch trang trí:** `<span class="barcode h-4" aria-hidden="true">` (lấy màu chữ hiện tại).
- **Mộc trạng thái** trên ảnh: `-rotate-6 border-2 font-mono uppercase`, màu `stamp` (khan hiếm, hết vé), `success` (đang diễn ra), `muted-foreground` (đã kết thúc), nền `bg-paper/95`.

### Màu theo danh mục (`tone`)

Token ở cuối `client/src/style.css`. Gắn `data-tone="<EventCategory>"` lên phần tử bao của một sự kiện, rồi dùng:

| Class | Dùng cho |
|---|---|
| `bg-tone text-tone-foreground` | cuống vé, ô ngày, chấm danh mục (chữ luôn đen `#111`, tương phản từ 7:1) |
| `bg-tone-soft text-tone-ink` | nhãn danh mục, nền cuống trong "Vé của tôi" |
| `text-tone-ink` | chữ nhãn danh mục |

- Tông sáng (hồng, cam, vàng, xanh lá, ngọc, xanh trời, xanh dương, tím). Trên nền tối `tone-ink` là chính tông đó; trong `.paper` tự đổi sang bản sẫm để đọc được trên trắng.
- Mỗi tấm vé chỉ một tông, theo danh mục của **chính sự kiện đó**. Tông không dùng cho nút mua.
- Thêm danh mục mới: thêm một dòng `[data-tone="..."]` (tông sáng, chữ đen trên đó đạt từ 7:1) và nhãn trong `client/src/utils/categories.ts`.

### Logo cổng thanh toán

Phương thức thanh toán hiện **logo thật** của cổng (`client/src/assets/payments/vnpay.svg`, `momo.svg`, lấy từ trang chính thức), cao `h-6`, không đổi màu, không bo méo. Thanh toán thử dùng icon lucide.

### Luật dùng màu cam `brand`

Chỉ những chỗ sau (hành động mua):
- Nút mua hàng: "Đặt vé", "Thanh toán" (`bg-brand text-brand-foreground hover:bg-brand/90`), cả trên nền tối lẫn trên giấy.
- Giá vé (`text-brand`; trên giấy tự thành đỏ mộc).
- Khan hiếm: "Sắp hết vé", "Còn N vé" (`bg-brand-soft text-brand` hoặc mộc `stamp` trên ảnh).
- Dòng ưu đãi ở trang sự kiện (`bg-brand-soft text-brand`).

Mọi nút khác dùng `primary` (sáng đặc) hoặc `outline`. Logo, menu, icon **không** dùng `brand`, trừ một chữ nhấn trong câu tiêu đề trang chủ.

## Chữ

- **Bricolage Grotesque** (chữ chính và tiêu đề) + **JetBrains Mono** (số, nhãn, giá, mã). Cả hai có dấu tiếng Việt. Không thêm font thứ ba.
- `h1`–`h3` tự dùng bản hẹp (`font-stretch: 80%`). Tiêu đề lớn kiểu poster (trang chủ, tên sự kiện) thêm `[font-stretch:75%] leading-[0.95]`.
- Tiêu đề trang: `text-3xl sm:text-4xl font-extrabold`; tên sự kiện trang chi tiết `text-4xl sm:text-6xl`; tên trên thẻ vé `text-xl font-extrabold`.
- Nhãn nhỏ (eyebrow), ngày trên cuống, mã đơn, số seri: `font-mono text-[11px] font-semibold uppercase tracking-widest`.
- Giá, tổng tiền, số liệu: `font-mono tabular-nums`.
- Không dùng chữ gradient, không dùng chữ nghiêng để trang trí.

## Khoảng cách, bo góc, viền

- Lưới 4px của Tailwind. Khoảng giữa khối lớn `space-y-8` đến `space-y-12`; trong card `p-5 sm:p-6`. Bề rộng nội dung `max-w-6xl mx-auto px-4 sm:px-6`.
- Bo góc gần như vuông (`--radius: 0.25rem`): vé giấy `rounded-sm` hoặc vuông hẳn. **Không dùng `rounded-2xl`, `rounded-3xl`.** `rounded-full` chỉ cho avatar, chấm trạng thái, chip lọc và khấc vé.
- Tách khối bằng viền mảnh, không bằng bóng. Vé giấy nổi trên nền tối nhờ màu giấy, không cần bóng.

## Thành phần

- **Nút:** `default` (sáng đặc) cho hành động chính, `outline` cho phụ, `ghost` trong thanh công cụ, `destructive` cho xoá/huỷ, `brand` chỉ theo luật ở trên.
- **Thẻ sự kiện (`EventCard`):** vé giấy dọc. Ảnh 16:9 có mộc trạng thái, rồi nhãn mono (chấm tông · danh mục · thành phố), tên, địa điểm; đường xé có khía; cuống gồm ô ngày nền tông (số ngày to bản hẹp, "Th11 · T6" mono) và giá + mã vạch + số seri. Hover: nhấc nhẹ thẻ (`-translate-y-1`), ảnh phóng nhẹ.
- **Khung chọn vé (trang sự kiện):** vé giấy có cuống tông ở trên ("Vé vào cửa", ngày, mã vạch), đường xé có khía.
- **Đơn trong "Vé của tôi", tóm tắt đơn khi thanh toán:** vé giấy; phần giá/trạng thái/nút là cuống tách bằng đường đứt và hai khấc.
- **Badge:** mặc định `outline`. Màu chỉ cho trạng thái thật.
- **Icon:** lucide `size-4`, cùng màu chữ bên cạnh. Không dùng emoji thay icon.

## Chuyển động

- `transition-colors` hoặc `transition-transform`, `duration-200`. Không animation khi tải trang, không parallax.
- Tôn trọng `motion-reduce:`/`motion-safe:` cho mọi chuyển động lớn hơn đổi màu.

## Nội dung

- **Có ảnh thì dùng ảnh** (`bannerUrl` qua `resolveMediaUrl`, tỉ lệ cố định, `object-cover`); không có ảnh thì khối `bg-muted` cùng kích thước.
- **Trạng thái hiện bằng nội dung, không bằng viền màu**: mộc/badge trạng thái; đơn huỷ/hết hạn thì ảnh `grayscale opacity-60` và giá `text-muted-foreground`.
- **Dòng mô tả dưới tiêu đề trang mang dữ liệu thật** ("2 sự kiện sắp tới · 1 đơn chờ thanh toán"), không viết câu giới thiệu chung chung.

## Không làm (dấu hiệu "AI làm")

Người dùng nhận ra giao diện do AI làm qua những mẫu dưới đây. Gặp trong code cũ thì sửa luôn khi đang đụng tới file đó.

- Màu indigo, tím, xanh dương mặc định của Tailwind; gradient tím-hồng; nền kem + nhấn đất nung (terracotta); nền đêm ánh tím phát sáng. Màu danh mục dùng token `tone`, không viết class màu thô.
- Màu rải ngẫu nhiên "cho vui" (mỗi thẻ một màu không theo danh mục, icon nhiều màu, nền gradient cầu vồng).
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
2. Che chữ đi: còn nhận ra đây là trang bán vé sự kiện (vé giấy, cuống màu, đường xé) hay chỉ là danh sách card?
3. Chạy lệnh tìm mẫu AI:

```bash
grep -rnE 'border-l-(2|4|8)|bg-(primary|brand|muted|accent)(/[0-9]+)? p-[3-5]"><[A-Z]|backdrop-blur|bg-gradient-to-[a-z]+ from-(indigo|purple|pink|violet)' client/src --include=*.vue | grep -v components/ui | grep -v border-dashed
```

(Đường xé `border-dashed` của vé được phép dày 2px, không tính là viền trái tô màu.)

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
| `bg-white` | `bg-background` trên nền tối, hoặc bọc trong `.paper` nếu là vé giấy |
| `bg-gray-50`, `bg-gray-100` | `bg-surface` (nền trang) hoặc `bg-muted` (nền phụ) |
| `border-gray-100`, `border-gray-200`, `border-gray-300` | `border-border` (hoặc chỉ `border`) |
| `text-red-600`, `text-red-500` (lỗi) | `text-danger` |
| `bg-green-*`, `text-green-*` (thành công) | `bg-success/10 text-success` |
| `rounded-2xl`, `rounded-3xl` | `rounded-sm` / `rounded-lg` |
| `shadow-sm`, `shadow-md`, `shadow-lg` trên card | bỏ |

Kiểm tra nhanh còn sót class màu thô:

```bash
grep -rnE '\b(bg|text|border|ring|from|to|via)-(indigo|gray|slate|zinc|neutral|stone|blue|sky|purple|violet|red|rose|green|emerald|orange|amber|yellow)-[0-9]+' client/src --include=*.vue
```
