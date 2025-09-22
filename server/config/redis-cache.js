// Redis Caching Layer for Multi-User CRM Performance
const Redis = require('ioredis');

class CacheManager {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      errors: 0
    };

    this.setupRedis();
  }

  setupRedis() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: 0,

      // Connection options for reliability
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,

      // Connection pool
      family: 4,
      keepAlive: true,
      connectTimeout: 5000,
      commandTimeout: 5000
    };

    // Use Redis cluster in production
    if (process.env.REDIS_CLUSTER_HOSTS) {
      const hosts = process.env.REDIS_CLUSTER_HOSTS.split(',').map(host => {
        const [hostname, port] = host.split(':');
        return { host: hostname, port: parseInt(port) || 6379 };
      });

      this.redis = new Redis.Cluster(hosts, {
        redisOptions: redisConfig,
        enableReadyCheck: true
      });
    } else {
      this.redis = new Redis(redisConfig);
    }

    // Event handlers
    this.redis.on('connect', () => {
      this.isConnected = true;
      console.log('🔴 Redis: Connected successfully');
    });

    this.redis.on('error', (error) => {
      this.isConnected = false;
      this.metrics.errors++;
      console.error('🔴 Redis: Connection error:', error.message);
    });

    this.redis.on('reconnecting', () => {
      console.log('🔄 Redis: Reconnecting...');
    });
  }

  // Generate cache keys with namespacing
  getKey(type, identifier, userId = null) {
    const baseKey = `crm:${type}:${identifier}`;
    return userId ? `${baseKey}:user:${userId}` : baseKey;
  }

  // Get cached data with fallback
  async get(key, fallbackFn = null) {
    if (!this.isConnected) {
      return fallbackFn ? await fallbackFn() : null;
    }

    try {
      const cached = await this.redis.get(key);

      if (cached) {
        this.metrics.hits++;
        return JSON.parse(cached);
      }

      this.metrics.misses++;

      // Execute fallback and cache result
      if (fallbackFn) {
        const data = await fallbackFn();
        if (data !== null && data !== undefined) {
          await this.set(key, data, 300); // 5 minute default TTL
        }
        return data;
      }

      return null;

    } catch (error) {
      this.metrics.errors++;
      console.error('🔴 Redis GET error:', error.message);
      return fallbackFn ? await fallbackFn() : null;
    }
  }

  // Set cache data with TTL
  async set(key, data, ttlSeconds = 300) {
    if (!this.isConnected) return false;

    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(data));
      this.metrics.sets++;
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('🔴 Redis SET error:', error.message);
      return false;
    }
  }

  // Delete cache entry
  async del(key) {
    if (!this.isConnected) return false;

    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('🔴 Redis DEL error:', error.message);
      return false;
    }
  }

  // Pattern-based cache invalidation
  async invalidatePattern(pattern) {
    if (!this.isConnected) return false;

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`🗑️ Invalidated ${keys.length} cache entries: ${pattern}`);
      }
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('🔴 Redis pattern invalidation error:', error.message);
      return false;
    }
  }

  // Cache with user-specific data
  async getUserData(userId, dataType, identifier, fallbackFn) {
    const key = this.getKey(dataType, identifier, userId);
    return this.get(key, fallbackFn);
  }

  async setUserData(userId, dataType, identifier, data, ttlSeconds = 300) {
    const key = this.getKey(dataType, identifier, userId);
    return this.set(key, data, ttlSeconds);
  }

  // Invalidate user-specific cache
  async invalidateUserCache(userId, dataType = '*') {
    const pattern = this.getKey(dataType, '*', userId);
    return this.invalidatePattern(pattern);
  }

  // Calendar-specific caching
  async getCalendarEvents(userId, dateRange, fallbackFn) {
    const key = this.getKey('calendar', `${dateRange.start}-${dateRange.end}`, userId);
    return this.get(key, fallbackFn);
  }

  async setCalendarEvents(userId, dateRange, events, ttlSeconds = 120) {
    const key = this.getKey('calendar', `${dateRange.start}-${dateRange.end}`, userId);
    return this.set(key, events, ttlSeconds);
  }

  // Lead data caching
  async getLeadData(leadId, userId, fallbackFn) {
    const key = this.getKey('lead', leadId, userId);
    return this.get(key, fallbackFn);
  }

  async invalidateLeadCache(leadId) {
    // Invalidate for all users who might have access
    return this.invalidatePattern(this.getKey('lead', leadId, '*'));
  }

  // Message delivery status caching
  async getCachedMessageStatus(messageId) {
    const key = this.getKey('message_status', messageId);
    return this.get(key);
  }

  async setCachedMessageStatus(messageId, status, ttlSeconds = 600) {
    const key = this.getKey('message_status', messageId);
    return this.set(key, status, ttlSeconds);
  }

  // User session caching
  async getUserSession(sessionId) {
    const key = this.getKey('session', sessionId);
    return this.get(key);
  }

  async setUserSession(sessionId, sessionData, ttlSeconds = 3600) {
    const key = this.getKey('session', sessionId);
    return this.set(key, sessionData, ttlSeconds);
  }

  // Rate limiting
  async checkRateLimit(identifier, limit = 100, windowSeconds = 60) {
    if (!this.isConnected) return { allowed: true, remaining: limit };

    const key = this.getKey('rate_limit', identifier);

    try {
      const current = await this.redis.incr(key);

      if (current === 1) {
        await this.redis.expire(key, windowSeconds);
      }

      const remaining = Math.max(0, limit - current);

      return {
        allowed: current <= limit,
        remaining,
        total: limit,
        resetTime: Date.now() + (windowSeconds * 1000)
      };

    } catch (error) {
      this.metrics.errors++;
      console.error('🔴 Redis rate limit error:', error.message);
      return { allowed: true, remaining: limit };
    }
  }

  // Distributed locking for critical operations
  async acquireLock(resource, ttlSeconds = 30) {
    if (!this.isConnected) return null;

    const key = this.getKey('lock', resource);
    const lockValue = `${Date.now()}-${Math.random()}`;

    try {
      const result = await this.redis.set(key, lockValue, 'EX', ttlSeconds, 'NX');
      return result === 'OK' ? lockValue : null;
    } catch (error) {
      this.metrics.errors++;
      console.error('🔴 Redis lock error:', error.message);
      return null;
    }
  }

  async releaseLock(resource, lockValue) {
    const key = this.getKey('lock', resource);

    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    try {
      return await this.redis.eval(script, 1, key, lockValue);
    } catch (error) {
      this.metrics.errors++;
      console.error('🔴 Redis unlock error:', error.message);
      return false;
    }
  }

  // Batch operations for better performance
  async mget(keys) {
    if (!this.isConnected) return [];

    try {
      const values = await this.redis.mget(...keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      this.metrics.errors++;
      console.error('🔴 Redis MGET error:', error.message);
      return [];
    }
  }

  async mset(keyValuePairs, ttlSeconds = 300) {
    if (!this.isConnected) return false;

    const pipeline = this.redis.pipeline();

    for (const [key, value] of keyValuePairs) {
      pipeline.setex(key, ttlSeconds, JSON.stringify(value));
    }

    try {
      await pipeline.exec();
      this.metrics.sets += keyValuePairs.length;
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('🔴 Redis MSET error:', error.message);
      return false;
    }
  }

  // Health check
  getStats() {
    return {
      connected: this.isConnected,
      metrics: this.metrics,
      hitRate: this.metrics.hits > 0 ?
        (this.metrics.hits / (this.metrics.hits + this.metrics.misses) * 100).toFixed(2) + '%' : '0%'
    };
  }

  async close() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Singleton instance
const cacheManager = new CacheManager();

module.exports = cacheManager;