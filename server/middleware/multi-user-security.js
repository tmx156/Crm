// Multi-User Security & Data Isolation Middleware
const cacheManager = require('../config/redis-cache');
const { query, getUserConnection } = require('../config/database-pool');

class MultiUserSecurity {
  constructor() {
    this.userPermissions = new Map();
    this.roleHierarchy = {
      'super_admin': ['admin', 'manager', 'team_lead', 'user'],
      'admin': ['manager', 'team_lead', 'user'],
      'manager': ['team_lead', 'user'],
      'team_lead': ['user'],
      'user': ['user']
    };
  }

  // Row-level security middleware
  async enforceDataIsolation(req, res, next) {
    try {
      const { user } = req;
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Set user context for database queries
      req.userContext = {
        id: user.id,
        role: user.role,
        permissions: await this.getUserPermissions(user.id),
        teamIds: user.team_ids || [],
        canAccessAllData: ['super_admin', 'admin'].includes(user.role)
      };

      // Add user-specific query filters
      req.secureQuery = async (baseQuery, params = []) => {
        return this.addUserFilters(baseQuery, params, req.userContext);
      };

      next();
    } catch (error) {
      console.error('Data isolation error:', error);
      res.status(500).json({ error: 'Security enforcement failed' });
    }
  }

  // Get user permissions with caching
  async getUserPermissions(userId) {
    const cacheKey = `user_permissions:${userId}`;

    return cacheManager.get(cacheKey, async () => {
      const result = await query(`
        SELECT p.permission_name, p.resource, p.actions
        FROM user_permissions up
        JOIN permissions p ON up.permission_id = p.id
        WHERE up.user_id = $1 AND up.is_active = true
      `, [userId]);

      const permissions = {};
      result.rows.forEach(row => {
        if (!permissions[row.resource]) {
          permissions[row.resource] = [];
        }
        permissions[row.resource].push(...row.actions);
      });

      return permissions;
    });
  }

  // Add user-specific filters to queries
  async addUserFilters(baseQuery, params, userContext) {
    const { id: userId, role, canAccessAllData, teamIds } = userContext;

    // Super admins and admins can access all data
    if (canAccessAllData) {
      return { query: baseQuery, params };
    }

    // Add user/team-specific filters based on query type
    let filteredQuery = baseQuery;
    let newParams = [...params];

    // Lead access filters
    if (baseQuery.includes('FROM leads') || baseQuery.includes('JOIN leads')) {
      const leadFilter = this.getLeadAccessFilter(role, userId, teamIds);
      filteredQuery = this.injectWhereClause(filteredQuery, leadFilter.condition);
      newParams.push(...leadFilter.params);
    }

    // Message access filters
    if (baseQuery.includes('FROM messages') || baseQuery.includes('JOIN messages')) {
      const messageFilter = this.getMessageAccessFilter(role, userId, teamIds);
      filteredQuery = this.injectWhereClause(filteredQuery, messageFilter.condition);
      newParams.push(...messageFilter.params);
    }

    // Calendar access filters
    if (baseQuery.includes('date_booked') && baseQuery.includes('leads')) {
      const calendarFilter = this.getCalendarAccessFilter(role, userId, teamIds);
      filteredQuery = this.injectWhereClause(filteredQuery, calendarFilter.condition);
      newParams.push(...calendarFilter.params);
    }

    return { query: filteredQuery, params: newParams };
  }

  // Generate lead access filters based on role
  getLeadAccessFilter(role, userId, teamIds) {
    switch (role) {
      case 'manager':
        // Managers can see their team's leads + unassigned
        return {
          condition: `(booker_id = $${this.paramIndex++} OR booker_id IN (${teamIds.map(() => `$${this.paramIndex++}`).join(',')}) OR booker_id IS NULL)`,
          params: [userId, ...teamIds]
        };

      case 'team_lead':
        // Team leads see their leads + team members' leads
        return {
          condition: `(booker_id = $${this.paramIndex++} OR booker_id IN (${teamIds.map(() => `$${this.paramIndex++}`).join(',')}) OR created_by = $${this.paramIndex++})`,
          params: [userId, ...teamIds, userId]
        };

      case 'user':
      default:
        // Regular users only see their own leads
        return {
          condition: `booker_id = $${this.paramIndex++}`,
          params: [userId]
        };
    }
  }

  // Generate message access filters
  getMessageAccessFilter(role, userId, teamIds) {
    switch (role) {
      case 'manager':
        return {
          condition: `(sender_id = $${this.paramIndex++} OR sender_id IN (${teamIds.map(() => `$${this.paramIndex++}`).join(',')}))`,
          params: [userId, ...teamIds]
        };

      case 'team_lead':
        return {
          condition: `(sender_id = $${this.paramIndex++} OR sender_id IN (${teamIds.map(() => `$${this.paramIndex++}`).join(',')}))`,
          params: [userId, ...teamIds]
        };

      default:
        return {
          condition: `sender_id = $${this.paramIndex++}`,
          params: [userId]
        };
    }
  }

  // Generate calendar access filters
  getCalendarAccessFilter(role, userId, teamIds) {
    // Same logic as lead access since calendar shows leads
    return this.getLeadAccessFilter(role, userId, teamIds);
  }

  // Inject WHERE clause into existing query
  injectWhereClause(query, condition) {
    const hasWhere = /\bWHERE\b/i.test(query);

    if (hasWhere) {
      return query.replace(/\bWHERE\b/i, `WHERE ${condition} AND`);
    } else {
      // Find the position to inject WHERE clause
      const orderByMatch = query.match(/\b(ORDER BY|GROUP BY|HAVING|LIMIT|OFFSET)\b/i);
      if (orderByMatch) {
        const position = query.indexOf(orderByMatch[0]);
        return query.slice(0, position) + `WHERE ${condition} ` + query.slice(position);
      } else {
        return query + ` WHERE ${condition}`;
      }
    }
  }

  // Permission checking middleware
  checkPermission(resource, action) {
    return async (req, res, next) => {
      try {
        const { userContext } = req;

        if (!userContext) {
          return res.status(401).json({ error: 'User context not found' });
        }

        // Super admins bypass permission checks
        if (userContext.role === 'super_admin') {
          return next();
        }

        const userPermissions = userContext.permissions;

        if (!userPermissions[resource] || !userPermissions[resource].includes(action)) {
          console.warn(`Permission denied: User ${userContext.id} tried to ${action} ${resource}`);
          return res.status(403).json({
            error: 'Insufficient permissions',
            required: { resource, action }
          });
        }

        next();
      } catch (error) {
        console.error('Permission check error:', error);
        res.status(500).json({ error: 'Permission check failed' });
      }
    };
  }

  // Rate limiting per user
  async checkUserRateLimit(req, res, next) {
    try {
      const { user } = req;
      const identifier = `user:${user.id}:${req.route.path}`;

      // Different limits based on role
      const rateLimits = {
        super_admin: 1000,
        admin: 500,
        manager: 200,
        team_lead: 150,
        user: 100
      };

      const limit = rateLimits[user.role] || 50;
      const rateCheck = await cacheManager.checkRateLimit(identifier, limit, 60);

      if (!rateCheck.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          limit,
          remaining: rateCheck.remaining,
          resetTime: rateCheck.resetTime
        });
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': limit,
        'X-RateLimit-Remaining': rateCheck.remaining,
        'X-RateLimit-Reset': rateCheck.resetTime
      });

      next();
    } catch (error) {
      console.error('Rate limit check error:', error);
      next(); // Continue on error
    }
  }

  // Audit logging for sensitive operations
  async auditLog(req, res, next) {
    const originalSend = res.send;

    res.send = function(data) {
      // Log sensitive operations
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const auditData = {
          userId: req.user?.id,
          userRole: req.user?.role,
          action: `${req.method} ${req.path}`,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString(),
          statusCode: res.statusCode,
          resourceId: req.params.id || null
        };

        // Log to audit table (async, non-blocking)
        query(`
          INSERT INTO audit_logs (user_id, action, details, ip_address, created_at)
          VALUES ($1, $2, $3, $4, NOW())
        `, [
          auditData.userId,
          auditData.action,
          JSON.stringify(auditData),
          auditData.ip
        ]).catch(err => console.error('Audit log error:', err));
      }

      originalSend.call(this, data);
    };

    next();
  }

  // Team access validation
  async validateTeamAccess(req, res, next) {
    try {
      const { userContext } = req;
      const requestedResource = req.params.id;

      // Skip for super admins
      if (userContext.canAccessAllData) {
        return next();
      }

      // Check if user has access to the requested resource
      if (requestedResource) {
        const hasAccess = await this.checkResourceAccess(
          requestedResource,
          userContext.id,
          userContext.role,
          userContext.teamIds
        );

        if (!hasAccess) {
          return res.status(403).json({ error: 'Access denied to this resource' });
        }
      }

      next();
    } catch (error) {
      console.error('Team access validation error:', error);
      res.status(500).json({ error: 'Access validation failed' });
    }
  }

  async checkResourceAccess(resourceId, userId, userRole, teamIds) {
    // Implementation depends on your specific access control requirements
    // This is a placeholder that should be customized

    const resourceQuery = await query(`
      SELECT booker_id, created_by, team_id
      FROM leads
      WHERE id = $1
    `, [resourceId]);

    if (resourceQuery.rows.length === 0) {
      return false;
    }

    const resource = resourceQuery.rows[0];

    // Check access based on role and ownership
    switch (userRole) {
      case 'manager':
        return resource.booker_id === userId ||
               teamIds.includes(resource.team_id) ||
               resource.created_by === userId;

      case 'team_lead':
        return resource.booker_id === userId ||
               teamIds.includes(resource.booker_id) ||
               resource.created_by === userId;

      case 'user':
      default:
        return resource.booker_id === userId;
    }
  }
}

const multiUserSecurity = new MultiUserSecurity();

module.exports = {
  enforceDataIsolation: multiUserSecurity.enforceDataIsolation.bind(multiUserSecurity),
  checkPermission: multiUserSecurity.checkPermission.bind(multiUserSecurity),
  checkUserRateLimit: multiUserSecurity.checkUserRateLimit.bind(multiUserSecurity),
  auditLog: multiUserSecurity.auditLog.bind(multiUserSecurity),
  validateTeamAccess: multiUserSecurity.validateTeamAccess.bind(multiUserSecurity)
};