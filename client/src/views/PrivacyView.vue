<script setup lang="ts">


const sections = [
  {
    "id": "pham-vi",
    "title": "1. Phạm vi",
    "lead": "Dữ liệu phục vụ trải nghiệm demo/đồ án.",
    "text": "Chính sách mô tả dữ liệu được xử lý khi dùng EventHub để quản lý tài khoản, sự kiện, đơn hàng và soát vé. Thanh toán là giả lập, chưa thu tiền thật.",
    "items": []
  },
  {
    "id": "du-lieu",
    "title": "2. Dữ liệu được lưu",
    "lead": "Họ tên, email và mật khẩu đã băm bcrypt.",
    "text": "Hệ thống còn lưu vai trò, trạng thái tài khoản, trạng thái xác minh email và thời điểm tạo, cập nhật. Không lưu mật khẩu ở dạng văn bản gốc.",
    "items": [
      "Đơn hàng: người đặt, tổng tiền giả lập, trạng thái, hạn giữ chỗ; vé, loại vé và mã QR.",
      "Soát vé: thời điểm sử dụng và tài khoản thực hiện.",
      "Nhật ký quản trị: người thực hiện, email tại thời điểm thao tác, hành động, đối tượng liên quan, dữ liệu bổ sung và thời điểm.",
      "Nội dung sự kiện và ảnh banner; token đặt lại mật khẩu và xác minh email được lưu dưới dạng băm SHA-256 kèm hạn dùng và trạng thái sử dụng."
    ]
  },
  {
    "id": "muc-dich",
    "title": "3. Mục đích xử lý",
    "lead": "Vận hành tài khoản, đặt vé và bảo vệ hệ thống.",
    "text": "Dữ liệu giúp đăng nhập, phân quyền, giữ chỗ, hiển thị đơn hàng, cấp mã vé, kiểm tra vé đã dùng, gửi email và tra cứu thao tác quản trị. Giới hạn yêu cầu theo IP hoặc tài khoản giúp giảm lạm dụng.",
    "items": []
  },
  {
    "id": "phan-quyen",
    "title": "4. Quyền truy cập",
    "lead": "Quyền truy cập phụ thuộc vai trò.",
    "text": "Khách hàng xem hồ sơ và đơn của mình. Ban tổ chức quản lý sự kiện của mình; khi soát vé có thể thấy họ tên người mua, loại vé và trạng thái sử dụng. Quản trị quản lý người dùng, sự kiện và xem nhật ký quản trị.",
    "items": []
  },
  {
    "id": "email",
    "title": "5. Email giao dịch",
    "lead": "Brevo là nhà cung cấp gửi email.",
    "text": "Email người nhận và nội dung thư cần thiết được chuyển tới Brevo để gửi thư xác minh, đặt lại mật khẩu, vé và nhắc lịch. Hệ thống cũng hỗ trợ chế độ ghi log để thử nghiệm thay vì gửi thư.",
    "items": [
      "Email vé có thông tin sự kiện, mã vé và liên kết tới Đơn hàng của tôi để xem QR; không nhúng hình QR.",
      "Nhắc lịch được xử lý khi sự kiện còn trong 24 giờ tới, không bảo đảm đúng mốc 24 giờ.",
      "Link đặt lại mật khẩu có hiệu lực 30 phút; link xác minh có hiệu lực 24 giờ. Cả hai dùng một lần, không chia sẻ các liên kết này."
    ]
  },
  {
    "id": "trinh-duyet",
    "title": "6. Phiên đăng nhập",
    "lead": "Token đăng nhập được lưu trong localStorage.",
    "text": "Token được dùng để gửi yêu cầu đã xác thực tới hệ thống. Hồ sơ người dùng được giữ trong bộ nhớ ứng dụng. Đăng xuất xoá token khỏi localStorage; nên đăng xuất sau khi dùng thiết bị chung.",
    "items": []
  },
  {
    "id": "anh",
    "title": "7. Ảnh tải lên",
    "lead": "Ảnh được xử lý lại và bỏ metadata, gồm EXIF/GPS.",
    "text": "Hệ thống nhận JPG, PNG hoặc WEBP tối đa 5 MB, kiểm tra nội dung ảnh, giới hạn đầu vào 40 triệu pixel, chuyển thành WEBP và thu nhỏ tối đa 1920 × 1920. Ảnh được lưu với tên ngẫu nhiên để dùng làm banner công khai; tránh tải ảnh chứa thông tin riêng tư.",
    "items": []
  },
  {
    "id": "kiem-soat",
    "title": "8. Kiểm soát thông tin và lưu giữ",
    "lead": "Bạn có thể xem hồ sơ, cập nhật họ tên và đổi mật khẩu.",
    "text": "Có thể dùng quên mật khẩu để khôi phục tài khoản, yêu cầu gửi lại xác minh khi đăng nhập. Cần giải đáp về dữ liệu, hãy gửi yêu cầu qua trang hỗ trợ.",
    "items": [
      "Hệ thống hiện chưa công bố thời hạn tự động xoá dữ liệu; hạn của liên kết không đồng nghĩa bản ghi được xoá ngay.",
      "Nhật ký quản trị được thiết kế để còn tồn tại khi tài khoản người thực hiện bị xoá.",
      "Tham khảo ngày cập nhật đầu trang để nhận biết phiên bản chính sách."
    ]
  }
]
</script>

<template>
  <main class="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 text-foreground">
    <header class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Dữ liệu và quyền riêng tư</p>
      <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight">Chính sách bảo mật</h1>
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
