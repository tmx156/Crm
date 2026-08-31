import React, { useState, useEffect } from 'react';
import { FiTarget, FiMail, FiUsers, FiActivity, FiTrendingUp, FiPlay, FiUpload, FiDownload, FiEye, FiBarChart, FiArrowRight, FiCheck, FiX, FiChevronRight } from 'react-icons/fi';
import axios from 'axios';

const Retargeting = () => {
  const [eligibleLeads, setEligibleLeads] = useState([]);
  const [stats, setStats] = useState({});
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [currentStep, setCurrentStep] = useState(1); // 1: Select Leads, 2: Choose Template, 3: Preview & Send
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchRetargetingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  const fetchRetargetingData = async () => {
    try {
      setLoading(true);
      const [leadsRes, statsRes, templatesRes] = await Promise.all([
        axios.get(`/api/retargeting/eligible?page=${currentPage}&limit=50`),
        axios.get('/api/retargeting/stats'),
        axios.get('/api/retargeting/templates')
      ]);

      setEligibleLeads(leadsRes.data.leads);
      setTotalPages(leadsRes.data.totalPages);
      setStats(statsRes.data);
      setTemplates(templatesRes.data);
    } catch (error) {
      console.error('Error fetching retargeting data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLead = (leadId) => {
    setSelectedLeads(prev => 
      prev.includes(leadId) 
        ? prev.filter(id => id !== leadId)
        : [...prev, leadId]
    );
  };

  const handleSelectAll = () => {
    if (selectedLeads.length === eligibleLeads.length) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(eligibleLeads.map(lead => lead.id));
    }
  };

  const handleNextStep = () => {
    if (currentStep === 1 && selectedLeads.length > 0) {
      setCurrentStep(2);
    } else if (currentStep === 2 && selectedTemplate) {
      setCurrentStep(3);
    }
  };

  const handlePreviousStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleStartCampaign = async () => {
    if (!selectedTemplate || selectedLeads.length === 0) {
      alert('Please select a template and at least one lead');
      return;
    }

    try {
      setCampaignLoading(true);
      const response = await axios.post('/api/retargeting/campaign/start', {
        templateType: selectedTemplate,
        leadIds: selectedLeads
      });

      alert(`Campaign completed! ${response.data.successCount} emails sent successfully.`);
      
      // Reset everything and go back to step 1
      setSelectedLeads([]);
      setSelectedTemplate('');
      setCurrentStep(1);
      fetchRetargetingData();
    } catch (error) {
      console.error('Error starting campaign:', error);
      alert('Error starting campaign. Please try again.');
    } finally {
      setCampaignLoading(false);
    }
  };

  const getTemplateDisplayName = (type) => {
    switch (type) {
      case 'retargeting_gentle': return 'Gentle Follow-up';
      case 'retargeting_urgent': return 'Urgent Follow-up';
      case 'retargeting_final': return 'Final Attempt';
      default: return type;
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'new':
        return 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800';
      case 'contacted':
        return 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800';
      case 'cancelled':
        return 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800';
      default:
        return 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800';
    }
  };

  const getSelectedTemplate = () => {
    return templates.find(t => t.type === selectedTemplate);
  };

  const getPersonalizedEmail = (template, lead) => {
    if (!template || !lead) return { subject: '', body: '' };
    
    const subject = template.subject
      .replace(/{leadName}/g, lead.name)
      .replace(/{companyName}/g, 'Modelling Studio CRM');

    const body = template.emailBody
      .replace(/{leadName}/g, lead.name)
      .replace(/{leadEmail}/g, lead.email)
      .replace(/{leadPhone}/g, lead.phone)
      .replace(/{companyName}/g, 'Modelling Studio CRM')
      .replace(/{originalContactDate}/g, new Date(lead.createdAt).toLocaleDateString());

    return { subject, body };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Retargeting Campaign</h1>
          <p className="text-gray-600 mt-1">Execute retargeting campaigns for unresponsive leads</p>
        </div>
        <div className="flex items-center space-x-4">
          <button className="btn-secondary flex items-center space-x-2">
            <FiUpload className="h-4 w-4" />
            <span>Upload Leads</span>
          </button>
          <button className="btn-secondary flex items-center space-x-2">
            <FiDownload className="h-4 w-4" />
            <span>Export Data</span>
          </button>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div className={`flex items-center ${currentStep >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
              {currentStep > 1 ? <FiCheck className="h-5 w-5" /> : '1'}
            </div>
            <span className="ml-2 font-medium">Select Leads</span>
          </div>
          
          <FiChevronRight className="h-5 w-5 text-gray-400" />
          
          <div className={`flex items-center ${currentStep >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
              {currentStep > 2 ? <FiCheck className="h-5 w-5" /> : '2'}
            </div>
            <span className="ml-2 font-medium">Choose Template</span>
          </div>
          
          <FiChevronRight className="h-5 w-5 text-gray-400" />
          
          <div className={`flex items-center ${currentStep >= 3 ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
              3
            </div>
            <span className="ml-2 font-medium">Preview & Send</span>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiTarget className="h-8 w-8 text-orange-500" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Eligible for Retargeting</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.eligibleForRetargeting || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiUsers className="h-8 w-8 text-red-500" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Selected Leads</p>
              <p className="text-2xl font-semibold text-gray-900">{selectedLeads.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiMail className="h-8 w-8 text-blue-500" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Campaigns Sent</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.campaignsSent?.total || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiTrendingUp className="h-8 w-8 text-green-500" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Response Rate</p>
              <p className="text-2xl font-semibold text-gray-900">
                {stats.campaignsSent?.total > 0 
                  ? `${Math.round((stats.responded / stats.campaignsSent.total) * 100)}%`
                  : '0%'
                }
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Step 1: Select Leads */}
      {currentStep === 1 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">
              Step 1: Select Leads to Retarget ({eligibleLeads.length} available)
            </h2>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleSelectAll}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {selectedLeads.length === eligibleLeads.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>

          {eligibleLeads.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={selectedLeads.length === eligibleLeads.length && eligibleLeads.length > 0}
                        onChange={handleSelectAll}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Lead
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      No Answer Count
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Days Since Created
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {eligibleLeads.map((lead) => {
                    const daysSinceCreated = Math.floor((new Date() - new Date(lead.createdAt)) / (1000 * 60 * 60 * 24));
                    
                    return (
                      <tr key={lead.id} className={selectedLeads.includes(lead.id) ? 'bg-blue-50' : ''}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={selectedLeads.includes(lead.id)}
                            onChange={() => handleSelectLead(lead.id)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{lead.name}</div>
                          <div className="text-sm text-gray-500">ID: {lead.id.slice(-6)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{lead.email}</div>
                          <div className="text-sm text-gray-500">{lead.phone}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={getStatusBadgeClass(lead.status)}>
                            {lead.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            (lead.retargeting?.noAnswerCount || 0) >= 5 
                              ? 'bg-red-100 text-red-800' 
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {lead.retargeting?.noAnswerCount || 0}/10
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {daysSinceCreated} days
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <FiTarget className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No eligible leads</h3>
              <p className="mt-1 text-sm text-gray-500">
                Leads will appear here when they have 3+ no answers and are 3+ weeks old.
              </p>
            </div>
          )}

          {/* Step 1 Actions */}
          <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
            <div className="text-sm text-gray-600">
              {selectedLeads.length} lead{selectedLeads.length !== 1 ? 's' : ''} selected
            </div>
            <button
              onClick={handleNextStep}
              disabled={selectedLeads.length === 0}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Continue to Template Selection</span>
              <FiArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Choose Template */}
      {currentStep === 2 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            Step 2: Choose Email Template
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {templates.map((template) => (
              <div
                key={template._id}
                className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                  selectedTemplate === template.type
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setSelectedTemplate(template.type)}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-gray-900">
                    {getTemplateDisplayName(template.type)}
                  </h3>
                  {selectedTemplate === template.type && (
                    <FiCheck className="h-5 w-5 text-blue-500" />
                  )}
                </div>
                <p className="text-sm text-gray-600 mb-3">
                  {template.type === 'retargeting_gentle' && 'Friendly follow-up for initial re-engagement'}
                  {template.type === 'retargeting_urgent' && 'More direct approach with time-sensitive messaging'}
                  {template.type === 'retargeting_final' && 'Final attempt before removing from list'}
                </p>
                <div className="text-xs text-gray-500">
                  <strong>Subject:</strong> {template.subject}
                </div>
              </div>
            ))}
          </div>

          {/* Step 2 Actions */}
          <div className="flex justify-between items-center mt-6">
            <button
              onClick={handlePreviousStep}
              className="btn-secondary flex items-center space-x-2"
            >
              <span>Back to Lead Selection</span>
            </button>
            <button
              onClick={handleNextStep}
              disabled={!selectedTemplate}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Preview Email</span>
              <FiArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview & Send */}
      {currentStep === 3 && (
        <div className="space-y-6">
          {/* Campaign Summary */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              Step 3: Preview & Send Campaign
            </h2>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <FiMail className="h-8 w-8 text-blue-500 mr-4" />
                <div>
                  <h3 className="font-medium text-blue-900">Campaign Summary</h3>
                  <p className="text-blue-700">
                    You're about to send <strong>{selectedLeads.length} emails</strong> using the{' '}
                    <strong>{getTemplateDisplayName(selectedTemplate)}</strong> template
                  </p>
                </div>
              </div>
            </div>

            {/* Email Preview */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-3">Email Preview</h4>
              {(() => {
                const template = getSelectedTemplate();
                const sampleLead = eligibleLeads.find(lead => selectedLeads.includes(lead.id));
                const personalizedEmail = getPersonalizedEmail(template, sampleLead);
                
                return (
                  <div className="bg-gray-50 rounded p-4">
                    <div className="mb-2">
                      <strong className="text-sm text-gray-600">Subject:</strong>
                      <div className="text-sm text-gray-900 mt-1">{personalizedEmail.subject}</div>
                    </div>
                    <div className="mb-2">
                      <strong className="text-sm text-gray-600">Preview for:</strong>
                      <div className="text-sm text-gray-900 mt-1">{sampleLead?.name} ({sampleLead?.email})</div>
                    </div>
                    <div>
                      <strong className="text-sm text-gray-600">Email Content:</strong>
                      <div className="text-sm text-gray-900 mt-1 whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {personalizedEmail.body}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Recipients List */}
            <div className="mt-6">
              <h4 className="font-medium text-gray-900 mb-3">
                Recipients ({selectedLeads.length})
              </h4>
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded">
                {eligibleLeads
                  .filter(lead => selectedLeads.includes(lead.id))
                  .map(lead => (
                    <div key={lead.id} className="flex items-center justify-between p-2 border-b border-gray-100 last:border-b-0">
                      <span className="text-sm text-gray-900">{lead.name}</span>
                      <span className="text-sm text-gray-500">{lead.email}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Step 3 Actions */}
            <div className="flex justify-between items-center mt-6">
              <button
                onClick={handlePreviousStep}
                className="btn-secondary flex items-center space-x-2"
              >
                <span>Back to Template Selection</span>
              </button>
              <button
                onClick={handleStartCampaign}
                disabled={campaignLoading}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {campaignLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Sending Campaign...</span>
                  </>
                ) : (
                  <>
                    <FiPlay className="h-4 w-4" />
                    <span>Send Campaign to {selectedLeads.length} Lead{selectedLeads.length !== 1 ? 's' : ''}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Retargeting; 