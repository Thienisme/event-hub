<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { ChevronDown } from '@lucide/vue'


const groups = [
  {
    "id": "mua-ve",
    "title": "Mua vé",
    "questions": [
      {
        "question": "Đặt vé như thế nào?",
        "answer": "Đăng nhập, chọn sự kiện, loại vé đang mở bán và số lượng, rồi tạo đơn. Kiểm tra thông tin trước khi xác nhận thanh toán giả lập."
      },
      {
        "question": "Đơn giữ chỗ bao lâu?",
        "answer": "Mặc định 10 phút từ khi tạo đơn, có thể thay đổi theo cấu hình. Theo dõi hạn trên đơn; quá hạn không thể thanh toán. Lượt quét nền tự chuyển đơn sang hết hạn và trả vé về kho."
      },
      {
        "question": "Mỗi tài khoản được mua bao nhiêu vé?",
        "answer": "Mặc định tối đa 100 vé/sự kiện, cộng mọi loại vé trong đơn chờ và đã xác nhận. Đơn huỷ hoặc hết hạn không tính. Hạn mức có thể thay đổi theo cấu hình."
      },
      {
        "question": "Vì sao còn vé nhưng chưa đặt được?",
        "answer": "Từng loại vé có thể có giờ mở bán và ngừng bán riêng. Chỉ đặt được trong khoảng bán, khi còn đủ vé và sự kiện chưa kết thúc."
      }
    ]
  },
  {
    "id": "thanh-toan",
    "title": "Thanh toán và huỷ",
    "questions": [
      {
        "question": "Thanh toán có trừ tiền thật không?",
        "answer": "Không. EventHub là bản demo/đồ án, thanh toán hiện là giả lập, chưa thu tiền thật. Khi chức năng này được bật, xác nhận đơn còn hạn sẽ tạo mã QR cho mỗi vé."
      },
      {
        "question": "Khi nào được huỷ đơn?",
        "answer": "Chỉ huỷ được đơn còn ở trạng thái chờ thanh toán. Vé được trả về kho. Đơn đã xác nhận hoặc đã hết hạn không thể huỷ; hệ thống chưa có chức năng hoàn tiền."
      },
      {
        "question": "Khi nào nhận email vé và nhắc lịch?",
        "answer": "Email vé được gửi sau lần xác nhận thanh toán thành công đầu tiên. Đơn đã xác nhận được nhắc lịch khi sự kiện còn trong 24 giờ tới, với lượt quét mặc định mỗi 15 phút; không bảo đảm đúng mốc 24 giờ. Nếu thư đến chậm, vẫn xem được vé trong Đơn hàng của tôi."
      }
    ]
  },
  {
    "id": "vao-cong",
    "title": "Vào cổng",
    "questions": [
      {
        "question": "Lấy QR ở đâu?",
        "answer": "Mở Đơn hàng của tôi để xem QR của từng vé trong đơn đã xác nhận. Email chứa mã vé và liên kết tới trang này, không nhúng hình QR."
      },
      {
        "question": "QR dùng được mấy lần?",
        "answer": "Mỗi mã QR chỉ soát vé thành công một lần tại đúng sự kiện. Lần sau báo đã sử dụng. Hãy giữ kín mã để tránh người khác dùng trước."
      },
      {
        "question": "Camera không quét được thì sao?",
        "answer": "Ban tổ chức có thể nhập mã vé bằng tay. Camera cần HTTPS hoặc localhost. Vé sai sự kiện, đã dùng hoặc chưa xác nhận thanh toán sẽ bị từ chối."
      }
    ]
  },
  {
    "id": "tai-khoan",
    "title": "Tài khoản",
    "questions": [
      {
        "question": "Quên mật khẩu thì làm gì?",
        "answer": "Dùng chức năng quên mật khẩu với email đăng ký. Nếu tài khoản đang hoạt động, hệ thống gửi liên kết có hiệu lực 30 phút, dùng một lần. Sau khi đặt lại thành công, hãy đăng nhập lại."
      },
      {
        "question": "Có cần xác minh email không?",
        "answer": "Email xác minh được gửi sau đăng ký. Liên kết có hiệu lực 24 giờ, dùng một lần. Khi đăng nhập, bạn có thể yêu cầu gửi lại tối đa 3 lần/15 phút. Hiện chưa xác minh không chặn tính năng."
      },
      {
        "question": "Vì sao bị báo quá nhiều yêu cầu?",
        "answer": "API chung giới hạn 100 yêu cầu/phút theo IP; đăng nhập 5 lần thất bại/phút theo IP; tạo đơn 15 yêu cầu/5 phút theo tài khoản. Quên mật khẩu giới hạn 5 yêu cầu/15 phút riêng theo IP và email. Hãy chờ hết khoảng giới hạn rồi thử lại."
      },
      {
        "question": "Phiên đăng nhập lưu ở đâu?",
        "answer": "Token đăng nhập được lưu trong localStorage của trình duyệt. Hãy đăng xuất khi dùng máy chung, giữ kín mật khẩu, token và liên kết đặt lại mật khẩu."
      }
    ]
  },
  {
    "id": "ban-to-chuc",
    "title": "Dành cho ban tổ chức",
    "questions": [
      {
        "question": "Ai được tạo sự kiện và soát vé?",
        "answer": "Tự đăng ký luôn có vai trò khách hàng. Ban tổ chức quản lý và soát vé cho sự kiện của mình; quản trị quản lý hệ thống. Vai trò do quản trị quản lý, không tự chọn khi đăng ký."
      },
      {
        "question": "Đặt giờ bán và tải ảnh thế nào?",
        "answer": "Có thể đặt giờ mở bán, ngừng bán riêng cho mỗi loại vé. Ảnh JPG, PNG hoặc WEBP tối đa 5 MB được kiểm tra, chuyển thành WEBP, bỏ metadata và thu nhỏ trong khung 1920 × 1920. Giới hạn tải lên 20 ảnh/10 phút theo tài khoản."
      }
    ]
  }
]
</script>

<template>
  <main class="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 text-foreground">
    <header class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Hỗ trợ sử dụng</p>
      <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight">Câu hỏi thường gặp</h1>
      <p class="text-sm text-muted-foreground">Cập nhật lần cuối: 12/11/2026</p>
      <p class="text-sm sm:text-base leading-7 text-muted-foreground">Những điều cần biết khi trải nghiệm EventHub, bản demo/đồ án với thanh toán giả lập, chưa thu tiền thật.</p>
    </header>

    <section v-for="group in groups" :id="group.id" :key="group.id" class="mt-10 scroll-mt-24">
      <h2 class="text-xl font-bold tracking-tight mb-4">{{ group.title }}</h2>
      <div class="divide-y divide-border border-y border-border">
        <details v-for="item in group.questions" :key="item.question" class="group">
          <summary class="flex justify-between items-center gap-4 py-4 font-medium cursor-pointer list-none [&::-webkit-details-marker]:hidden focus-visible:outline-primary focus-visible:outline-offset-4">
            <span>{{ item.question }}</span>
            <ChevronDown class="size-4 shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <p class="pb-4 text-sm leading-6 text-muted-foreground">{{ item.answer }}</p>
        </details>
      </div>
    </section>
    <aside class="mt-10 border border-border rounded-lg p-5 sm:p-6">
      <h2 class="font-semibold">Chưa tìm thấy câu trả lời?</h2>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">Xem thêm
        <RouterLink to="/terms" class="text-foreground underline underline-offset-4">Điều khoản sử dụng</RouterLink> và
        <RouterLink to="/privacy" class="text-foreground underline underline-offset-4">Chính sách bảo mật</RouterLink>.
      </p>
    </aside>
  </main>
</template>
