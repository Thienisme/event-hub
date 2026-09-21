-- Lưới an toàn cuối cùng ở tầng dữ liệu.
--
-- Trước migration này, toàn bộ việc chống bán quá số lượng nằm ở tầng ứng dụng
-- (Redlock). Nếu lock bị mất giữa transaction — key bị eviction do maxmemory,
-- Redis failover làm mất write, TTL bị hạ, hay chỉ đơn giản là một instance BE
-- trỏ nhầm Redis — thì DB không có ý kiến gì và availableQuantity xuống âm.
--
-- Constraint này khiến điều đó trở thành BẤT KHẢ THI ở tầng MySQL: kể cả một
-- câu UPDATE viết sai trong tương lai cũng bị DB từ chối.
--
-- Lưu ý: Prisma schema không diễn đạt được CHECK constraint, nên migration này
-- là SQL viết tay. Prisma không coi đây là drift vì nó không introspect CHECK.
ALTER TABLE `ticket_types`
  ADD CONSTRAINT `ticket_types_availableQuantity_non_negative`
  CHECK (`availableQuantity` >= 0);
