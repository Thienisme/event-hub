<script setup lang="ts">


const sections = [
  {
    "id": "pham-vi",
    "title": "1. Phạm vi sử dụng",
    "lead": "Bản demo/đồ án, chưa thu tiền thật.",
    "text": "EventHub mô phỏng tạo sự kiện, đặt vé, thanh toán và soát vé. Mức giá và trạng thái thanh toán phục vụ thử nghiệm, không phải chứng từ thu tiền.",
    "items": []
  },
  {
    "id": "tai-khoan",
    "title": "2. Tài khoản và vai trò",
    "lead": "Giữ kín thông tin đăng nhập.",
    "text": "Cung cấp họ tên, email chính xác và sử dụng đúng quyền được cấp.",
    "items": [
      "Khách hàng quản lý hồ sơ, đặt vé và xem đơn của mình.",
      "Ban tổ chức quản lý sự kiện của mình, loại vé và soát vé.",
      "Quản trị quản lý người dùng, vai trò, trạng thái tài khoản, sự kiện và nhật ký quản trị. Tự đăng ký luôn có vai trò khách hàng."
    ]
  },
  {
    "id": "dat-ve",
    "title": "3. Đặt vé và giữ chỗ",
    "lead": "Mặc định giữ chỗ 10 phút từ lúc tạo đơn.",
    "text": "Thời hạn có thể thay đổi theo cấu hình; hãy theo dõi hạn trên đơn. Quá hạn không thể thanh toán, lượt quét nền sẽ chuyển đơn sang hết hạn và trả vé về kho.",
    "items": [
      "Mặc định tối đa 100 vé/tài khoản/sự kiện, cộng mọi loại vé trong đơn chờ và đã xác nhận. Đơn huỷ hoặc hết hạn không tính; mức này có thể cấu hình lại.",
      "Từng loại vé có thể có giờ mở bán và ngừng bán riêng. Chỉ đặt được trong khoảng bán, khi còn đủ vé và sự kiện chưa kết thúc."
    ]
  },
  {
    "id": "thanh-toan",
    "title": "4. Thanh toán và huỷ đơn",
    "lead": "Thanh toán hoàn toàn giả lập.",
    "text": "Khi chức năng giả lập được bật, xác nhận đơn còn hạn sẽ tạo mã QR cho mỗi vé. Chưa thu tiền thật và chưa có chức năng hoàn tiền.",
    "items": [
      "Chỉ huỷ được đơn đang chờ thanh toán; vé được trả về kho.",
      "Đơn đã xác nhận thanh toán hoặc đã hết hạn không thể huỷ."
    ]
  },
  {
    "id": "vao-cong",
    "title": "5. Vé và soát vé",
    "lead": "Mỗi mã QR chỉ dùng một lần.",
    "text": "Vé phải thuộc đơn đã xác nhận và đúng sự kiện. Lần quét sau báo vé đã dùng. Giữ kín mã vé; ban tổ chức có thể nhập mã bằng tay khi camera không quét được.",
    "items": []
  },
  {
    "id": "email",
    "title": "6. Email và khôi phục tài khoản",
    "lead": "Xem vé trong Đơn hàng của tôi.",
    "text": "Email vé được gửi sau lần xác nhận thành công đầu tiên. Nhắc lịch áp dụng khi sự kiện còn trong 24 giờ tới; lượt quét mặc định mỗi 15 phút, không bảo đảm đúng mốc 24 giờ. Email có mã vé và liên kết xem QR; việc gửi có thể gặp lỗi.",
    "items": [
      "Link đặt lại mật khẩu có hiệu lực 30 phút, dùng một lần. Sau khi đặt lại thành công, cần đăng nhập lại.",
      "Link xác minh email có hiệu lực 24 giờ, dùng một lần. Hiện chưa xác minh không chặn tính năng."
    ]
  },
  {
    "id": "su-dung",
    "title": "7. Sử dụng có trách nhiệm",
    "lead": "Không lạm dụng tài khoản, mã vé hoặc API.",
    "text": "Ban tổ chức cần cung cấp thông tin sự kiện chính xác và chỉ tải ảnh có quyền sử dụng. Ảnh được xử lý lại và bỏ metadata trước khi lưu.",
    "items": [
      "API chung: 100 yêu cầu/phút theo IP; đăng nhập: 5 lần thất bại/phút theo IP.",
      "Tạo đơn: 15 yêu cầu/5 phút theo tài khoản; API quản trị: 30 yêu cầu/phút theo IP.",
      "Quên mật khẩu: 5 yêu cầu/15 phút riêng theo IP và email; gửi lại xác minh: 3 yêu cầu/15 phút theo tài khoản. Khi bị giới hạn, hãy chờ rồi thử lại."
    ]
  },
  {
    "id": "ho-tro",
    "title": "8. Hỗ trợ và cập nhật",
    "lead": "Gửi thắc mắc qua trang hỗ trợ.",
    "text": "Tham khảo ngày cập nhật ở đầu trang. Cách xử lý dữ liệu tài khoản, phiên đăng nhập và email được trình bày trong Chính sách bảo mật.",
    "items": []
  }
]
</script>

<template>
  <main class="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 text-foreground">
    <header class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Thông tin sử dụng</p>
      <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight">Điều khoản sử dụng</h1>
      <p class="text-sm text-muted-foreground">Cập nhật lần cuối: 12/11/2026</p>
      <p class="text-sm sm:text-base leading-7 text-muted-foreground">Thông tin dành cho người sử dụng EventHub.</p>
    </header>

    <nav aria-label="Mục lục" class="mt-8 border-y border-border py-5">
      <p class="text-sm font-semibold mb-3">Mục lục</p>
      <ul class="grid gap-2 sm:grid-cols-2 text-sm">
        <li v-for="section in sections" :key="section.id">
          <a :href="`#${section.id}`" class="inline-block py-1 text-foreground underline-offset-4 hover:underline">{{ section.title }}</a>
        </li>
      </ul>
    </nav>
    <section v-for="section in sections" :key="section.id" :aria-labelledby="section.id">
      <h2 :id="section.id" class="text-xl font-bold tracking-tight mt-10 scroll-mt-24">{{ section.title }}</h2>
      <p class="mt-3 text-sm sm:text-base leading-7 text-muted-foreground">
        <strong class="text-foreground font-medium">{{ section.lead }}</strong>
        {{ section.text }}
      </p>
      <ul v-if="section.items.length" class="mt-3 list-disc pl-5 space-y-2 text-sm sm:text-base leading-7 text-muted-foreground">
        <li v-for="item in section.items" :key="item">{{ item }}</li>
      </ul>
    </section>
  </main>
</template>
