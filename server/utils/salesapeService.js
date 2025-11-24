/**
 * SalesAPE Service
 * 
 * Service to send leads to SalesAPE's Airtable
 * Supports both webhook and direct Airtable API integration
 */

const axios = require('axios');

class SalesAPEService {
  constructor() {
    this.airtableBaseId = process.env.SALESAPE_AIRTABLE_BASE_ID;
    this.airtableApiKey = process.env.SALESAPE_AIRTABLE_API_KEY;
    this.airtableTableName = process.env.SALESAPE_AIRTABLE_TABLE_NAME || 'Leads';
    this.webhookUrl = process.env.SALESAPE_WEBHOOK_URL;
    this.enabled = process.env.SALESAPE_ENABLED === 'true';
  }

  /**
   * Check if SalesAPE integration is enabled and configured
   */
  isConfigured() {
    return this.enabled && (this.webhookUrl || (this.airtableBaseId && this.airtableApiKey));
  }

  /**
   * Map CRM lead to SalesAPE/Airtable format
   */
  mapLeadToSalesAPE(lead) {
    return {
      // Required fields
      name: lead.name || '',
      phone: lead.phone || '',
      email: lead.email || '',
      
      // Optional fields
      postcode: lead.postcode || '',
      age: lead.age || null,
      notes: lead.notes || '',
      status: lead.status || 'New',
      date_booked: lead.date_booked || null,
      time_booked: lead.time_booked || null,
      
      // CRM metadata
      crm_lead_id: lead.id,
      crm_created_at: lead.created_at,
      crm_updated_at: lead.updated_at || new Date().toISOString(),
      
      // SalesAPE metadata (if exists)
      salesape_id: lead.salesape_id || null,
      salesape_qualified: lead.salesape_qualified || false,
      salesape_conversation_id: lead.salesape_conversation_id || null
    };
  }

  /**
   * Send lead to SalesAPE via webhook
   */
  async sendLeadViaWebhook(lead) {
    if (!this.webhookUrl) {
      throw new Error('SalesAPE webhook URL not configured');
    }

    try {
      const payload = this.mapLeadToSalesAPE(lead);
      
      console.log(`📤 Sending lead to SalesAPE webhook: ${lead.name} (${lead.id})`);
      
      const response = await axios.post(this.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CRM-SalesAPE-Integration/1.0'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log(`✅ Lead sent to SalesAPE webhook successfully: ${lead.name}`);
      
      return {
        success: true,
        method: 'webhook',
        response: response.data
      };
    } catch (error) {
      console.error(`❌ Error sending lead to SalesAPE webhook:`, {
        leadId: lead.id,
        leadName: lead.name,
        error: error.message,
        response: error.response?.data
      });
      
      throw error;
    }
  }

  /**
   * Send lead to SalesAPE via Airtable API
   */
  async sendLeadToAirtable(lead) {
    if (!this.airtableBaseId || !this.airtableApiKey) {
      throw new Error('SalesAPE Airtable credentials not configured');
    }

    try {
      const payload = this.mapLeadToSalesAPE(lead);
      
      // Airtable API endpoint
      const url = `https://api.airtable.com/v0/${this.airtableBaseId}/${encodeURIComponent(this.airtableTableName)}`;
      
      console.log(`📤 Sending lead to SalesAPE Airtable: ${lead.name} (${lead.id})`);
      
      const response = await axios.post(url, {
        fields: payload
      }, {
        headers: {
          'Authorization': `Bearer ${this.airtableApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log(`✅ Lead sent to SalesAPE Airtable successfully: ${lead.name}`);
      
      return {
        success: true,
        method: 'airtable',
        airtableId: response.data.id,
        response: response.data
      };
    } catch (error) {
      console.error(`❌ Error sending lead to SalesAPE Airtable:`, {
        leadId: lead.id,
        leadName: lead.name,
        error: error.message,
        response: error.response?.data
      });
      
      // Handle Airtable-specific errors
      if (error.response?.status === 422) {
        throw new Error(`Airtable validation error: ${JSON.stringify(error.response.data)}`);
      }
      
      throw error;
    }
  }

  /**
   * Send lead to SalesAPE (tries webhook first, falls back to Airtable)
   */
  async sendLead(lead) {
    if (!this.isConfigured()) {
      console.warn('⚠️ SalesAPE integration not configured, skipping lead send');
      return {
        success: false,
        error: 'SalesAPE integration not configured'
      };
    }

    try {
      // Prefer webhook if available
      if (this.webhookUrl) {
        return await this.sendLeadViaWebhook(lead);
      } else if (this.airtableBaseId && this.airtableApiKey) {
        return await this.sendLeadToAirtable(lead);
      } else {
        throw new Error('No SalesAPE integration method configured');
      }
    } catch (error) {
      // Log error but don't throw - we don't want to break lead creation
      console.error('SalesAPE service error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update lead in SalesAPE
   */
  async updateLead(lead) {
    if (!this.isConfigured()) {
      return { success: false, error: 'SalesAPE integration not configured' };
    }

    try {
      const payload = this.mapLeadToSalesAPE(lead);
      
      // If we have SalesAPE ID, we can update via Airtable
      if (lead.salesape_id && this.airtableBaseId && this.airtableApiKey) {
        const url = `https://api.airtable.com/v0/${this.airtableBaseId}/${encodeURIComponent(this.airtableTableName)}/${lead.salesape_id}`;
        
        const response = await axios.patch(url, {
          fields: payload
        }, {
          headers: {
            'Authorization': `Bearer ${this.airtableApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });

        return {
          success: true,
          method: 'airtable',
          response: response.data
        };
      } else {
        // If no SalesAPE ID, send as new lead
        return await this.sendLead(lead);
      }
    } catch (error) {
      console.error('Error updating lead in SalesAPE:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
module.exports = new SalesAPEService();

