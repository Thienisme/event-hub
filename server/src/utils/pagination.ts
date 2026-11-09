const MAX_PAGE = 1_000_000;
const MAX_LIMIT = 100;

/** Đổi giá trị query thành số nguyên; trả null nếu không phải số hợp lệ. */
const toInt = (value: unknown): number | null => {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Chuẩn hoá tham số phân trang.
 *
 * Giới hạn page/limit để `skip` không vượt giới hạn của database (page quá lớn
 * từng làm Prisma trả 500). Giá trị không phải số dùng mặc định.
 */
export const parsePagination = (query: { page?: unknown; limit?: unknown }, defaultLimit = 20) => {
  const rawPage = toInt(query.page);
  const rawLimit = toInt(query.limit);

  const page = rawPage === null ? 1 : Math.min(MAX_PAGE, Math.max(1, rawPage));
  const limit =
    rawLimit === null
      ? Math.min(MAX_LIMIT, Math.max(1, defaultLimit))
      : Math.min(MAX_LIMIT, Math.max(1, rawLimit));

  return { page, limit, skip: (page - 1) * limit };
};
