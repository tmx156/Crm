// In-Memory Cache Fallback (No Redis Required)
// Simple cache implementation for development/testing

class MemoryCacheManager {
  constructor() {
    this.cache = new Map();
    this.isConnected = true; // Always "connected" for memory cache
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      errors: 0
    };

    console.log('💾 Using in-memory cache (Redis fallback)');
  }

  // Generate cache keys with namespacing
  getKey(type, identifier, userId = null) {
    const baseKey = `crm:${type}:${identifier}`;
    return userId ? `${baseKey}:user:${userId}` : baseKey;
  }

  // Get cached data with fallback
  async get(key, fallbackFn = null) {
    try {
      const entry = this.cache.get(key);

      if (entry && (!entry.expires || entry.expires > Date.now())) {
        this.metrics.hits++;
        return entry.data;
      }

      // Remove expired entry
      if (entry) {
        this.cache.delete(key);
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
      console.error('💾 Memory cache GET error:', error.message);
      return fallbackFn ? await fallbackFn() : null;
    }
  }

  // Set cache data with TTL
  async set(key, data, ttlSeconds = 300) {
    try {
      const expires = ttlSeconds > 0 ? Date.now() + (ttlSeconds * 1000) : null;
      this.cache.set(key, { data, expires });
      this.metrics.sets++;
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('💾 Memory cache SET error:', error.message);
      return false;
    }
  }

  // Delete cache entry
  async del(key) {
    try {
      this.cache.delete(key);
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('💾 Memory cache DEL error:', error.message);
      return false;
    }
  }

  // Pattern-based cache invalidation (simple implementation)
  async invalidatePattern(pattern) {
    try {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      let count = 0;

      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.cache.delete(key);
          count++;
        }
      }

      if (count > 0) {
        console.log(`🗑️ Invalidated ${count} cache entries: ${pattern}`);
      }
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('💾 Memory cache pattern invalidation error:', error.message);
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
    const key = this.getKey('rate_limit', identifier);

    try {
      const entry = this.cache.get(key);
      const now = Date.now();

      if (!entry || entry.expires < now) {
        // Reset window
        this.cache.set(key, {
          count: 1,
          expires: now + (windowSeconds * 1000)
        });
        return {
          allowed: true,
          remaining: limit - 1,
          total: limit,
          resetTime: now + (windowSeconds * 1000)
        };
      }

      entry.count++;
      const remaining = Math.max(0, limit - entry.count);

      return {
        allowed: entry.count <= limit,
        remaining,
        total: limit,
        resetTime: entry.expires
      };

    } catch (error) {
      this.metrics.errors++;
      console.error('💾 Memory cache rate limit error:', error.message);
      return { allowed: true, remaining: limit };
    }
  }

  // Distributed locking (simplified for single instance)
  async acquireLock(resource, ttlSeconds = 30) {
    const key = this.getKey('lock', resource);
    const lockValue = `${Date.now()}-${Math.random()}`;

    try {
      const entry = this.cache.get(key);

      if (!entry || entry.expires < Date.now()) {
        this.cache.set(key, {
          value: lockValue,
          expires: Date.now() + (ttlSeconds * 1000)
        });
        return lockValue;
      }

      return null; // Lock already held
    } catch (error) {
      this.metrics.errors++;
      console.error('💾 Memory cache lock error:', error.message);
      return null;
    }
  }

  async releaseLock(resource, lockValue) {
    const key = this.getKey('lock', resource);

    try {
      const entry = this.cache.get(key);

      if (entry && entry.value === lockValue) {
        this.cache.delete(key);
        return true;
      }

      return false;
    } catch (error) {
      this.metrics.errors++;
      console.error('💾 Memory cache unlock error:', error.message);
      return false;
    }
  }

  // Batch operations
  async mget(keys) {
    try {
      return keys.map(key => {
        const entry = this.cache.get(key);
        if (entry && (!entry.expires || entry.expires > Date.now())) {
          return entry.data;
        }
        return null;
      });
    } catch (error) {
      this.metrics.errors++;
      console.error('💾 Memory cache MGET error:', error.message);
      return [];
    }
  }

  async mset(keyValuePairs, ttlSeconds = 300) {
    try {
      const expires = ttlSeconds > 0 ? Date.now() + (ttlSeconds * 1000) : null;

      for (const [key, value] of keyValuePairs) {
        this.cache.set(key, { data: value, expires });
      }

      this.metrics.sets += keyValuePairs.length;
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('💾 Memory cache MSET error:', error.message);
      return false;
    }
  }

  // Clean up expired entries periodically
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires && entry.expires < now) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`💾 Cleaned up ${cleaned} expired cache entries`);
    }
  }

  // Health check
  getStats() {
    return {
      connected: this.isConnected,
      metrics: this.metrics,
      hitRate: this.metrics.hits > 0 ?
        (this.metrics.hits / (this.metrics.hits + this.metrics.misses) * 100).toFixed(2) + '%' : '0%',
      size: this.cache.size
    };
  }

  async close() {
    this.cache.clear();
    console.log('💾 Memory cache cleared');
  }
}

// Singleton instance
const cacheManager = new MemoryCacheManager();

// Set up periodic cleanup
setInterval(() => {
  cacheManager.cleanup();
}, 60000); // Clean up every minute

module.exports = cacheManager;