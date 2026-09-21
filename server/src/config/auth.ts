// Nạp .env NGAY TẠI ĐÂY là cố ý, không phải thừa.
//
// app.ts gọi `dotenv.config()` ở thân module, nhưng trong CommonJS thì mọi
// `import` biến thành `require()` và chạy TRƯỚC thân module. Nghĩa là khi module
// này (hoặc bất kỳ module nào đọc `process.env` ở cấp module) được nạp, `.env`
// vẫn chưa được đọc -> mọi biến đều `undefined`.
//
// `import 'dotenv/config'` là side-effect import: nó tự gọi dotenv.config() ngay
// khi bị require, nên dòng này nạp .env trước khi phần còn lại của file chạy.
import 'dotenv/config';

/** Độ dài tối thiểu. HMAC-SHA256 dùng khoá 256 bit -> 32 byte. */
const MIN_SECRET_LENGTH = 32;

/**
 * Các giá trị đã từng bị hardcode trong source hoặc lộ ra ngoài.
 *
 * Nếu ai đó "sửa" lỗ hổng bằng cách set JWT_SECRET đúng bằng chuỗi cũ thì thực
 * chất lỗ hổng vẫn còn nguyên: chuỗi đó nằm trong lịch sử git nên ai cũng biết.
 */
const FORBIDDEN_SECRETS = new Set(['supersecret_eventhub_key']);

/**
 * Đọc JWT_SECRET từ biến môi trường.
 *
 * CỐ TÌNH KHÔNG CÓ GIÁ TRỊ MẶC ĐỊNH. Một secret mặc định nằm trong source nghĩa
 * là bất kỳ ai đọc được code đều tự ký được token hợp lệ cho BẤT KỲ user nào,
 * kể cả ADMIN. Thà server không khởi động được còn hơn khởi động với secret mà
 * cả thế giới biết.
 *
 * Đọc tại thời điểm gọi (không cache ở cấp module) để không phụ thuộc thứ tự nạp
 * module — đây chính là lỗi đã khiến secret trong .env bị bỏ qua trước đó.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error(
      'Thiếu biến môi trường JWT_SECRET. Sinh một secret mới bằng:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
        'rồi thêm vào .env một dòng:  JWT_SECRET="<giá trị vừa sinh>"'
    );
  }

  if (FORBIDDEN_SECRETS.has(secret)) {
    throw new Error(
      'JWT_SECRET đang dùng giá trị mặc định cũ đã bị lộ trong source. ' +
        'Giá trị đó ai cũng biết nên token có thể bị giả mạo. Hãy sinh secret mới.'
    );
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET quá ngắn (${secret.length} ký tự, cần tối thiểu ${MIN_SECRET_LENGTH}). ` +
        'Secret ngắn có thể bị brute-force.'
    );
  }

  return secret;
}

/**
 * Kiểm tra cấu hình auth lúc khởi động — fail fast.
 *
 * Gọi trong app.ts TRƯỚC `app.listen` để server chết ngay nếu cấu hình sai,
 * thay vì khởi động bình thường rồi mới vỡ ở request đầu tiên (lúc đó lỗi
 * "thiếu JWT_SECRET" sẽ bị đội lốt thành "token không hợp lệ" — rất khó chẩn đoán).
 */
export function assertAuthConfig(): void {
  getJwtSecret();
  console.log('✅ JWT_SECRET đã được cấu hình.');
}
