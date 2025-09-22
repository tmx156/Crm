// Enterprise Database Connection Pooling for Multi-User CRM
const { Pool } = require('pg');

class DatabasePool {
  constructor() {
    this.pool = null;
    this.supabasePool = null;
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      waitingConnections: 0,
      queries: 0,
      errors: 0
    };

    this.setupPool();
    this.setupMonitoring();
  }

  setupPool() {
    // Primary connection pool
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,

      // Pool configuration for multi-user load
      min: 5,                    // Minimum connections
      max: 50,                   // Maximum connections (adjust based on server capacity)
      idleTimeoutMillis: 30000,  // Close idle connections after 30s
      connectionTimeoutMillis: 5000, // Connection timeout
      acquireTimeoutMillis: 60000,   // How long to wait for connection

      // Connection validation
      allowExitOnIdle: true,
      statement_timeout: 30000,  // 30s query timeout
      query_timeout: 30000,

      // SSL configuration for production
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
      } : false
    });

    // Read-only replica pool for heavy queries (if available)
    if (process.env.DATABASE_READ_URL) {
      this.readPool = new Pool({
        connectionString: process.env.DATABASE_READ_URL,
        min: 2,
        max: 20,
        idleTimeoutMillis: 30000,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
    }

    // Event handlers
    this.pool.on('connect', (client) => {
      this.metrics.totalConnections++;
      console.log(`📊 DB: New connection established (Total: ${this.metrics.totalConnections})`);
    });

    this.pool.on('acquire', (client) => {
      this.metrics.activeConnections++;
    });

    this.pool.on('release', (client) => {
      this.metrics.activeConnections--;
    });

    this.pool.on('error', (err, client) => {
      this.metrics.errors++;
      console.error('📊 DB: Pool error:', err);
    });
  }

  // Optimized query method with automatic read/write splitting
  async query(text, params = [], options = {}) {
    const startTime = Date.now();
    const { readOnly = false, timeout = 30000, retries = 2 } = options;

    // Use read replica for SELECT queries if available
    const pool = (readOnly && this.readPool) ? this.readPool : this.pool;

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.metrics.queries++;

        // Add query timeout
        const client = await pool.connect();
        client.query('SET statement_timeout = $1', [timeout]);

        const result = await client.query(text, params);
        client.release();

        const duration = Date.now() - startTime;
        if (duration > 1000) {
          console.warn(`🐌 Slow query (${duration}ms): ${text.substring(0, 100)}...`);
        }

        return result;

      } catch (error) {
        lastError = error;

        if (attempt < retries && (
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.message.includes('connection')
        )) {
          console.warn(`🔄 DB: Retry attempt ${attempt + 1} for query`);
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
          continue;
        }

        this.metrics.errors++;
        throw error;
      }
    }

    throw lastError;
  }

  // Optimized transaction handling
  async transaction(callback, options = {}) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Set transaction isolation level for consistency
      if (options.isolationLevel) {
        await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
      }

      const result = await callback(client);
      await client.query('COMMIT');

      return result;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Bulk operations for better performance
  async bulkInsert(table, columns, rows, options = {}) {
    if (!rows || rows.length === 0) return { rowCount: 0 };

    const { onConflict = '', returning = '' } = options;

    // Generate parameterized query
    const columnNames = columns.join(', ');
    const valueRows = rows.map((_, index) => {
      const rowParams = columns.map((_, colIndex) => `$${index * columns.length + colIndex + 1}`);
      return `(${rowParams.join(', ')})`;
    });

    const values = rows.flat();
    const query = `
      INSERT INTO ${table} (${columnNames})
      VALUES ${valueRows.join(', ')}
      ${onConflict}
      ${returning ? `RETURNING ${returning}` : ''}
    `;

    return this.query(query, values, { timeout: 60000 });
  }

  // User-specific connection optimization
  async getUserConnection(userId) {
    const client = await this.pool.connect();

    // Set user context for row-level security
    await client.query('SET app.current_user_id = $1', [userId]);

    return {
      query: (text, params) => client.query(text, params),
      release: () => client.release()
    };
  }

  // Health check for monitoring
  async healthCheck() {
    try {
      const start = Date.now();
      await this.query('SELECT 1', [], { timeout: 5000 });
      const responseTime = Date.now() - start;

      return {
        status: 'healthy',
        responseTime,
        pool: {
          totalCount: this.pool.totalCount,
          idleCount: this.pool.idleCount,
          waitingCount: this.pool.waitingCount
        },
        metrics: this.metrics
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        pool: {
          totalCount: this.pool.totalCount,
          idleCount: this.pool.idleCount,
          waitingCount: this.pool.waitingCount
        }
      };
    }
  }

  setupMonitoring() {
    // Log pool stats every minute
    setInterval(() => {
      const stats = {
        total: this.pool.totalCount,
        idle: this.pool.idleCount,
        waiting: this.pool.waitingCount,
        queries: this.metrics.queries,
        errors: this.metrics.errors
      };

      console.log('📊 DB Pool Stats:', stats);

      // Alert on high connection usage
      if (this.pool.totalCount > 40) {
        console.warn('⚠️ High database connection usage:', stats);
      }
    }, 60000);
  }

  async close() {
    await this.pool.end();
    if (this.readPool) {
      await this.readPool.end();
    }
  }
}

// Singleton instance
const dbPool = new DatabasePool();

module.exports = {
  pool: dbPool,
  query: (text, params, options) => dbPool.query(text, params, options),
  transaction: (callback, options) => dbPool.transaction(callback, options),
  bulkInsert: (table, columns, rows, options) => dbPool.bulkInsert(table, columns, rows, options),
  getUserConnection: (userId) => dbPool.getUserConnection(userId),
  healthCheck: () => dbPool.healthCheck()
};