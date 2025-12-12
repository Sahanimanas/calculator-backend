const Redis = require('ioredis');

let redis = null;

module.exports = {
  init: async (url) => {
    redis = new Redis(url);
    redis.on('error', (err) => console.error('Redis error', err));
    return redis;
  },
  get: async (key) => {
    if (!redis) return null;
    const v = await redis.get(key);
    return v ? JSON.parse(v) : null;
  },
  set: async (key, val, ttlSec = 300) => {
    if (!redis) return null;
    await redis.set(key, JSON.stringify(val), 'EX', ttlSec);
    return true;
  },
  del: async (key) => {
    if (!redis) return null;
    return redis.del(key);
  },
  raw: () => redis
};
