const { createClient } = require('@supabase/supabase-js');

// Import centralized configuration
const config = require('./config');

class DatabaseConnectionManager {
  constructor() {
    this.client = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.initializeClient();
  }

  initializeClient() {
    try {
      // Use centralized configuration instead of hardcoded credentials
      this.client = createClient(config.supabase.url, config.supabase.anonKey);

      console.log('✅ Supabase client initialized using centralized config');
    } catch (error) {
      console.error('❌ Failed to initialize Supabase client:', error);
      // Fallback to direct initialization if config fails
      try {
        const fallbackUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
        const fallbackKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
        this.client = createClient(fallbackUrl, fallbackKey);
        console.log('✅ Supabase client initialized with fallback credentials');
      } catch (fallbackError) {
        console.error('❌ Fallback initialization also failed:', fallbackError);
      }
    }
  }

  async query(table, options = {}) {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }

    try {
      let query = this.client.from(table);

      // Apply select
      if (options.select) {
        query = query.select(options.select);
      }

      // Apply filters
      if (options.eq) {
        Object.entries(options.eq).forEach(([column, value]) => {
          query = query.eq(column, value);
        });
      }

      if (options.neq) {
        Object.entries(options.neq).forEach(([column, value]) => {
          query = query.neq(column, value);
        });
      }

      if (options.gt) {
        Object.entries(options.gt).forEach(([column, value]) => {
          query = query.gt(column, value);
        });
      }

      if (options.lt) {
        Object.entries(options.lt).forEach(([column, value]) => {
          query = query.lt(column, value);
        });
      }

      if (options.gte) {
        Object.entries(options.gte).forEach(([column, value]) => {
          query = query.gte(column, value);
        });
      }

      if (options.lte) {
        Object.entries(options.lte).forEach(([column, value]) => {
          query = query.lte(column, value);
        });
      }

      if (options.like) {
        Object.entries(options.like).forEach(([column, value]) => {
          query = query.like(column, value);
        });
      }

      if (options.ilike) {
        Object.entries(options.ilike).forEach(([column, value]) => {
          query = query.ilike(column, value);
        });
      }

      if (options.in) {
        Object.entries(options.in).forEach(([column, value]) => {
          query = query.in(column, value);
        });
      }

      // Apply ordering
      if (options.order) {
        Object.entries(options.order).forEach(([column, direction]) => {
          query = query.order(column, { ascending: direction === 'asc' });
        });
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.range) {
        query = query.range(options.range.from, options.range.to);
      }

      // Execute query
      const result = await query;

      if (result.error) {
        throw result.error;
      }

      return result.data;

    } catch (error) {
      console.error('Supabase query error:', error);

      // Retry mechanism
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`Retrying query (Attempt ${this.retryCount})...`);
        await this.wait(1000 * this.retryCount); // Exponential backoff
        return this.query(table, options);
      }

      // Reset retry count
      this.retryCount = 0;
      throw error;
    }
  }

  async insert(table, data) {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }

    try {
      const result = await this.client
        .from(table)
        .insert(data)
        .select();

      if (result.error) {
        throw result.error;
      }

      return result.data;
    } catch (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }
  }

  async update(table, data, filters) {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }

    try {
      let query = this.client.from(table).update(data);

      // Apply filters
      if (filters) {
        Object.entries(filters).forEach(([column, value]) => {
          query = query.eq(column, value);
        });
      }

      const result = await query.select();

      if (result.error) {
        throw result.error;
      }

      return result.data;
    } catch (error) {
      console.error('Supabase update error:', error);
      throw error;
    }
  }

  async delete(table, filters) {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }

    try {
      let query = this.client.from(table).delete();

      // Apply filters
      if (filters) {
        // Handle different filter types
        if (filters.eq) {
          Object.entries(filters.eq).forEach(([column, value]) => {
            query = query.eq(column, value);
          });
        }
        
        if (filters.neq) {
          Object.entries(filters.neq).forEach(([column, value]) => {
            query = query.neq(column, value);
          });
        }
        
        if (filters.in) {
          Object.entries(filters.in).forEach(([column, value]) => {
            query = query.in(column, value);
          });
        }
        
        if (filters.gt) {
          Object.entries(filters.gt).forEach(([column, value]) => {
            query = query.gt(column, value);
          });
        }
        
        if (filters.lt) {
          Object.entries(filters.lt).forEach(([column, value]) => {
            query = query.lt(column, value);
          });
        }
        
        if (filters.gte) {
          Object.entries(filters.gte).forEach(([column, value]) => {
            query = query.gte(column, value);
          });
        }
        
        if (filters.lte) {
          Object.entries(filters.lte).forEach(([column, value]) => {
            query = query.lte(column, value);
          });
        }
      }

      const result = await query;

      if (result.error) {
        throw result.error;
      }

      return result.data;
    } catch (error) {
      console.error('Supabase delete error:', error);
      throw error;
    }
  }

  async upsert(table, data, options = {}) {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }

    try {
      let query = this.client.from(table).upsert(data, options);

      const result = await query.select();

      if (result.error) {
        throw result.error;
      }

      return result.data;
    } catch (error) {
      console.error('Supabase upsert error:', error);
      throw error;
    }
  }

  async reconnect() {
    try {
      // Reinitialize the client
      this.initializeClient();
    } catch (error) {
      console.error('Reconnection failed:', error);
    }
  }

  // Utility method for adding delay
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Graceful shutdown
  async shutdown() {
    // Supabase client doesn't need explicit shutdown
    console.log('Shutting down Supabase client');
  }
}

// Singleton instance
const dbManager = new DatabaseConnectionManager();

// Graceful shutdown on process exit
process.on('SIGINT', async () => {
  await dbManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await dbManager.shutdown();
  process.exit(0);
});

module.exports = dbManager;
