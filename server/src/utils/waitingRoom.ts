import { redisClient } from '../config/redis';
import { QUEUE_PASS_TTL_SECONDS, QUEUE_STALE_SECONDS } from '../config/queue';
import { AppError } from './errors';

const keys = (eventId: string) => ['seq', 'waiting', 'active', 'seen'].map(s => `queue:{${eventId}}:${s}`);
export type QueueStatus = { state: 'NONE'; queueEnabled: boolean }
  | { state: 'ACTIVE'; expiresAt: string }
  | { state: 'WAITING'; position: number; ahead: number; total: number; estimatedWaitSeconds: number };

// Cấp lượt và đọc trạng thái trong cùng Lua: tách đọc/ghi ở JS sẽ khiến các
// request đồng thời cùng thấy chỗ trống và cấp quá giới hạn. TIME dùng đồng hồ Redis.
const script = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local user = ARGV[1]
local mode = ARGV[2]
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local stale = tonumber(ARGV[5])
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, id in ipairs(expired) do redis.call('HDEL', KEYS[4], id) end
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
-- Dọn người chờ mất liên lạc trước khi ghi seen, tránh hồi sinh vị trí cũ.
local seen = redis.call('HGET', KEYS[4], user)
if redis.call('ZSCORE', KEYS[2], user) and (not seen or tonumber(seen) < now - stale) then
  redis.call('ZREM', KEYS[2], user)
  redis.call('HDEL', KEYS[4], user)
end
if mode == 'join' and not redis.call('ZSCORE', KEYS[2], user) and not redis.call('ZSCORE', KEYS[3], user) then
  redis.call('ZADD', KEYS[2], redis.call('INCR', KEYS[1]), user)
end
if redis.call('ZSCORE', KEYS[2], user) or redis.call('ZSCORE', KEYS[3], user) then
  redis.call('HSET', KEYS[4], user, now)
end
local free = limit - redis.call('ZCARD', KEYS[3])
while free > 0 do
  local first = redis.call('ZPOPMIN', KEYS[2], 1)
  if #first == 0 then break end
  local last = redis.call('HGET', KEYS[4], first[1])
  if not last or tonumber(last) < now - stale then
    redis.call('HDEL', KEYS[4], first[1])
  else
    redis.call('ZADD', KEYS[3], now + ttl, first[1])
    free = free - 1
  end
end
for _, key in ipairs(KEYS) do redis.call('EXPIRE', key, 86400) end
local expires = redis.call('ZSCORE', KEYS[3], user)
if expires then return {'ACTIVE', expires} end
local rank = redis.call('ZRANK', KEYS[2], user)
if rank then return {'WAITING', rank + 1, redis.call('ZCARD', KEYS[2])} end
return {'NONE'}
`;

/** Chuyển mọi lỗi hạ tầng phòng chờ thành 503, tuyệt đối không cho qua cửa. */
async function evaluate(eventId: string, lua: string, ...args: (string | number)[]): Promise<unknown> {
  try {
    if (redisClient.status !== 'ready') throw new Error('Redis chưa sẵn sàng');
    return await redisClient.eval(lua, 4, ...keys(eventId), ...args);
  } catch (error) {
    console.error('[waitingRoom] Redis lỗi:', error);
    throw new AppError('Phòng chờ tạm thời không khả dụng, vui lòng thử lại!', 503);
  }
}
async function status(eventId: string, userId: string, limit: number, mode: string): Promise<QueueStatus> {
  const result = await evaluate(eventId, script, userId, mode, limit,
    QUEUE_PASS_TTL_SECONDS * 1000, QUEUE_STALE_SECONDS * 1000) as (string | number)[];
  if (result[0] === 'ACTIVE') return { state: 'ACTIVE', expiresAt: new Date(Number(result[1])).toISOString() };
  if (result[0] === 'WAITING') {
    const position = Number(result[1]);
    // Chỉ là ước lượng thô; người mua có thể trả lượt sớm hơn thời hạn.
    return { state: 'WAITING', position, ahead: position - 1, total: Number(result[2]),
      estimatedWaitSeconds: Math.ceil((position - 1) / limit) * QUEUE_PASS_TTL_SECONDS };
  }
  return { state: 'NONE', queueEnabled: true };
}
export const joinQueue = (eventId: string, userId: string, limit: number) => status(eventId, userId, limit, 'join');
export const getQueueStatus = (eventId: string, userId: string, limit: number) => status(eventId, userId, limit, 'me');
export async function leaveQueue(eventId: string, userId: string): Promise<void> {
  await evaluate(eventId, `redis.call('ZREM', KEYS[2], ARGV[1]); redis.call('ZREM', KEYS[3], ARGV[1]); redis.call('HDEL', KEYS[4], ARGV[1]); for _, key in ipairs(KEYS) do redis.call('EXPIRE', key, 86400) end; return 1`, userId);
}
export const releasePass = leaveQueue;
export async function hasActivePass(eventId: string, userId: string): Promise<boolean> {
  return Number(await evaluate(eventId, `local t = redis.call('TIME'); local score = redis.call('ZSCORE', KEYS[3], ARGV[1]); if score and tonumber(score) > tonumber(t[1])*1000 + math.floor(tonumber(t[2])/1000) then return 1 end; return 0`, userId)) === 1;
}
