const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Middleware to check authentication
const { auth } = require('../middleware/auth');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =======================================================================================
// GET LEGACY LEADS
// =======================================================================================

router.get('/leads', auth, async (req, res) => {
  try {
    console.log('📋 Fetching legacy leads...');

    // Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('legacy_leads')
      .select('*', { count: 'exact' })
      .order('import_timestamp', { ascending: false });

    // Apply filters if provided
    if (req.query.status) {
      query = query.eq('import_status', req.query.status);
    }

    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      if (searchTerm.length > 0) {
        // Search in name, email, phone, postcode
        const searchPattern = `%${searchTerm}%`;
        query = query.or(`name.ilike.${searchPattern},email.ilike.${searchPattern},phone.ilike.${searchPattern},postcode.ilike.${searchPattern}`);
        console.log(`🔍 Legacy search applied: "${searchTerm}"`);
      }
    }

    if (req.query.has_image === 'true') {
      query = query.eq('has_image', true);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: leads, error, count } = await query;

    if (error) {
      console.error('❌ Legacy leads fetch error:', error);
      console.error('❌ Query details:', { page, limit, search: req.query.search });
      return res.status(500).json({ 
        message: 'Failed to fetch legacy leads',
        error: error.message,
        details: 'Check server logs for more information'
      });
    }

    // Calculate pagination info
    const totalPages = Math.ceil(count / limit);
    const pagination = {
      current_page: page,
      total_pages: totalPages,
      total_records: count,
      records_per_page: limit,
      has_next: page < totalPages,
      has_prev: page > 1
    };

    console.log(`✅ Fetched ${leads.length} legacy leads (page ${page}/${totalPages})`);
    res.json({
      leads,
      pagination,
      stats: {
        total_leads: count,
        current_page: page,
        records_shown: leads.length
      }
    });

  } catch (error) {
    console.error('❌ Legacy leads error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =======================================================================================
// GET LEGACY LEADS STATISTICS
// =======================================================================================

router.get('/stats', auth, async (req, res) => {
  try {
    console.log('📊 Fetching legacy statistics...');

    // Get import statistics
    const { data: importStats, error: importError } = await supabase
      .from('legacy_import_sessions')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(5);

    if (importError) {
      console.error('❌ Import stats error:', importError);
    }

    // Get total count first
    const { count: totalCount, error: countError } = await supabase
      .from('legacy_leads')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Count error:', countError);
      return res.status(500).json({ message: 'Failed to fetch count' });
    }

    // Get data quality stats (sample for calculations)
    const { data: qualityStats, error: qualityError } = await supabase
      .from('legacy_leads')
      .select('import_status, data_quality_score, has_image, email, phone, name, age')
      .limit(10000); // Sample for stats

    if (qualityError) {
      console.error('❌ Quality stats error:', qualityError);
      return res.status(500).json({ message: 'Failed to fetch statistics' });
    }

    // Calculate statistics
    const stats = {
      total_leads: totalCount, // Use actual total count
      import_status_breakdown: {},
      quality_score_distribution: {
        excellent: 0, // 90-100
        good: 0,      // 70-89
        fair: 0,      // 50-69
        poor: 0       // 0-49
      },
      data_completeness: {
        has_email: 0,
        has_phone: 0,
        has_name: 0,
        has_age: 0,
        has_image: 0
      },
      recent_imports: importStats || []
    };

    // Calculate breakdowns
    qualityStats.forEach(lead => {
      // Status breakdown
      const status = lead.import_status || 'unknown';
      stats.import_status_breakdown[status] = (stats.import_status_breakdown[status] || 0) + 1;

      // Quality score distribution
      const score = lead.data_quality_score || 0;
      if (score >= 90) stats.quality_score_distribution.excellent++;
      else if (score >= 70) stats.quality_score_distribution.good++;
      else if (score >= 50) stats.quality_score_distribution.fair++;
      else stats.quality_score_distribution.poor++;

      // Data completeness
      if (lead.email && lead.email.trim()) stats.data_completeness.has_email++;
      if (lead.phone && lead.phone.trim()) stats.data_completeness.has_phone++;
      if (lead.name && lead.name.trim()) stats.data_completeness.has_name++;
      if (lead.age && lead.age > 0) stats.data_completeness.has_age++;
      if (lead.has_image) stats.data_completeness.has_image++;
    });

    // Convert counts to percentages (based on sample size)
    const sampleSize = qualityStats.length;
    Object.keys(stats.data_completeness).forEach(key => {
      stats.data_completeness[key] = Math.round((stats.data_completeness[key] / sampleSize) * 100);
    });

    console.log('✅ Legacy statistics calculated:', {
      total_leads: stats.total_leads,
      sample_size: sampleSize,
      completeness: stats.data_completeness
    });
    res.json(stats);

  } catch (error) {
    console.error('❌ Legacy stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =======================================================================================
// GET LEGACY LEAD BY ID
// =======================================================================================

router.get('/leads/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📋 Fetching legacy lead: ${id}`);

    const { data: lead, error } = await supabase
      .from('legacy_leads')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('❌ Legacy lead fetch error:', error);
      return res.status(404).json({ message: 'Legacy lead not found' });
    }

    console.log(`✅ Found legacy lead: ${lead.name || 'Unnamed'}`);
    res.json({ lead });

  } catch (error) {
    console.error('❌ Legacy lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =======================================================================================
// SEARCH LEGACY LEADS
// =======================================================================================

router.get('/search', auth, async (req, res) => {
  try {
    const { q, type = 'all', limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ message: 'Search query must be at least 2 characters' });
    }

    console.log(`🔍 Searching legacy leads: "${q}" (type: ${type})`);

    let query = supabase
      .from('legacy_leads')
      .select('id, name, email, phone, postcode, age, image_url, import_timestamp, data_quality_score')
      .order('import_timestamp', { ascending: false })
      .limit(limit);

    // Build search query based on type
    const searchTerm = `%${q.trim()}%`;
    switch (type) {
      case 'email':
        query = query.ilike('email', searchTerm);
        break;
      case 'phone':
        query = query.ilike('phone', searchTerm);
        break;
      case 'name':
        query = query.ilike('name', searchTerm);
        break;
      case 'postcode':
        query = query.ilike('postcode', searchTerm);
        break;
      default: // 'all'
        query = query.or(`name.ilike.${searchTerm},email.ilike.${searchTerm},phone.ilike.${searchTerm},postcode.ilike.${searchTerm}`);
    }

    const { data: results, error } = await query;

    if (error) {
      console.error('❌ Legacy search error:', error);
      return res.status(500).json({ message: 'Search failed' });
    }

    console.log(`✅ Found ${results.length} legacy leads matching "${q}"`);
    res.json({
      query: q,
      type,
      results,
      count: results.length
    });

  } catch (error) {
    console.error('❌ Legacy search error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =======================================================================================
// EXPORT LEGACY LEADS
// =======================================================================================

router.get('/export', auth, async (req, res) => {
  try {
    console.log('📤 Exporting legacy leads...');

    const { data: leads, error } = await supabase
      .from('legacy_leads')
      .select('name, email, phone, postcode, age, image_url, import_timestamp, data_quality_score')
      .eq('import_status', 'imported')
      .order('import_timestamp', { ascending: false });

    if (error) {
      console.error('❌ Legacy export error:', error);
      return res.status(500).json({ message: 'Export failed' });
    }

    // Convert to CSV format
    const csvHeader = 'Name,Email,Phone,Postcode,Age,Image URL,Import Date,Quality Score\n';
    const csvRows = leads.map(lead => {
      const name = `"${(lead.name || '').replace(/"/g, '""')}"`;
      const email = `"${(lead.email || '').replace(/"/g, '""')}"`;
      const phone = `"${(lead.phone || '').replace(/"/g, '""')}"`;
      const postcode = `"${(lead.postcode || '').replace(/"/g, '""')}"`;
      const age = lead.age || '';
      const imageUrl = `"${(lead.image_url || '').replace(/"/g, '""')}"`;
      const importDate = lead.import_timestamp ? new Date(lead.import_timestamp).toISOString().split('T')[0] : '';
      const qualityScore = lead.data_quality_score || 0;

      return `${name},${email},${phone},${postcode},${age},${imageUrl},${importDate},${qualityScore}`;
    }).join('\n');

    const csvContent = csvHeader + csvRows;

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="legacy-leads-export.csv"');

    console.log(`✅ Exported ${leads.length} legacy leads as CSV`);
    res.send(csvContent);

  } catch (error) {
    console.error('❌ Legacy export error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
