import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit, FiTrash2, FiEye, FiSend, FiMail, FiPhone, FiSettings, FiSave, FiX, FiExternalLink } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';

const Templates = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState('');
  const [variables, setVariables] = useState([]);

  const [formData, setFormData] = useState({
    name: '',
    type: 'booking_confirmation',
    subject: '',
    emailBody: '',
    smsBody: '',
    reminderDays: 5,
    sendEmail: true,
    sendSMS: true,
    isActive: true,
    attachments: []
  });

  // Utility to group templates by category
  const categorizeTemplates = (templates) => {
    if (!templates || !Array.isArray(templates)) {
      return { 'Diary Templates': [], 'Retargeting Templates': [], 'Sale Templates': [], 'Lead Details Templates': [] };
    }

    const categories = {
      'Diary Templates': ['booking_confirmation', 'appointment_reminder', 'no_show', 'reschedule', 'cancellation'],
      'Retargeting Templates': ['retargeting_gentle', 'retargeting_urgent', 'retargeting_final', 'retargeting'],
      'Sale Templates': ['sale_confirmation', 'sale_followup', 'sale', 'sale_notification', 'sale_paid_in_full', 'sale_followup_paid', 'sale_finance_agreement', 'sale_followup_finance'],
      'Lead Details Templates': ['custom', 'booker']
    };
    const grouped = { 'Diary Templates': [], 'Retargeting Templates': [], 'Sale Templates': [], 'Lead Details Templates': [] };
    templates.forEach(t => {
      let found = false;
      for (const [cat, types] of Object.entries(categories)) {
        if (types.includes(t.type)) {
          grouped[cat].push(t);
          found = true;
          break;
        }
      }
      if (!found) grouped['Diary Templates'].push(t); // fallback to Diary Templates
    });
    return grouped;
  };

  // Category filter state, set from navigation
  const [categoryFilter, setCategoryFilter] = useState(location.state?.category || 'All');
  useEffect(() => {
    if (location.state?.category) {
      setCategoryFilter(location.state.category);
    }
  }, [location.state?.category]);

  useEffect(() => {
    fetchTemplates();
    fetchVariables();
    if (user?.role === 'admin') {
      fetchLeads();
    }
  }, [user]);

  const fetchTemplates = async () => {
    try {
      const response = await fetch('/api/templates', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setTemplates(data);
      } else {
        console.error('❌ Failed to fetch templates:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchVariables = async () => {
    try {
      const response = await fetch('/api/templates/variables/list', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setVariables(data);
      }
    } catch (error) {
      console.error('Error fetching variables:', error);
    }
  };

  const fetchLeads = async () => {
    try {
      const response = await fetch('/api/leads?limit=100', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setLeads(data.leads);
      }
    } catch (error) {
      console.error('Error fetching leads:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const url = editingTemplate 
        ? `/api/templates/${editingTemplate._id}`
        : '/api/templates';
      
      const method = editingTemplate ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        console.log('✅ Template saved successfully');
        setShowModal(false);
        setEditingTemplate(null);
        resetForm();
        fetchTemplates();
        
        // Show success message
        alert('Template saved successfully! Changes will be applied to future messages.');
      } else {
        const error = await response.json();
        alert(error.message || 'Error saving template');
      }
    } catch (error) {
      console.error('Error saving template:', error);
      alert('Error saving template');
    }
  };

  const handleEdit = async (template) => {
    setEditingTemplate(template);
    
    // Load existing attachments data from the database
    let existingAttachments = [];
    if (template._id) {
      try {
        const response = await fetch(`/api/templates/${template._id}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        if (response.ok) {
          const templateData = await response.json();
          if (templateData.attachments) {
            try {
              existingAttachments = JSON.parse(templateData.attachments);
            } catch (e) {
              console.warn('Failed to parse attachments:', e);
            }
          }
        }
      } catch (error) {
        console.error('Error loading template attachments:', error);
      }
    }
    
    setFormData({
      name: template.name,
      type: template.type,
      subject: template.subject,
      emailBody: template.emailBody,
      smsBody: template.smsBody,
      reminderDays: template.reminderDays || 5,
      sendEmail: template.sendEmail,
      sendSMS: template.sendSMS,
      isActive: template.isActive,
      attachments: Array.isArray(existingAttachments) ? existingAttachments : []
    });
    setShowModal(true);
  };

  const handleDelete = async (templateId) => {
    // eslint-disable-next-line no-restricted-globals
    if (!confirm('Are you sure you want to delete this template?')) return;

    try {
      const response = await fetch(`/api/templates/${templateId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        fetchTemplates();
      } else {
        const error = await response.json();
        alert(error.message || 'Error deleting template');
      }
    } catch (error) {
      console.error('Error deleting template:', error);
      alert('Error deleting template');
    }
  };

  const handlePreview = async (template) => {
    try {
      const response = await fetch(`/api/templates/${template._id}/preview`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setPreviewData(data);
        setShowPreview(true);
      }
    } catch (error) {
      console.error('Error previewing template:', error);
    }
  };

  const handleTest = async (template) => {
    if (!selectedLead) {
      alert('Please select a lead to test with');
      return;
    }

    try {
      const response = await fetch(`/api/templates/${template._id}/test/${selectedLead}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        alert('Test message sent successfully!');
      } else {
        const error = await response.json();
        alert(error.message || 'Error sending test message');
      }
    } catch (error) {
      console.error('Error testing template:', error);
      alert('Error sending test message');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'booking_confirmation',
      subject: '',
      emailBody: '',
      smsBody: '',
      reminderDays: 5,
      sendEmail: true,
      sendSMS: true,
      isActive: true,
      attachments: []
    });
  };

  const insertVariable = (variable) => {
    const textarea = document.activeElement;
    if (textarea && textarea.tagName === 'TEXTAREA') {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const newText = text.substring(0, start) + variable + text.substring(end);

      // Update form data first
      const fieldName = textarea.name;
      setFormData(prev => ({
        ...prev,
        [fieldName]: newText
      }));

      // Update the textarea value and cursor position after state update
      setTimeout(() => {
        textarea.value = newText;
        textarea.setSelectionRange(start + variable.length, start + variable.length);
        textarea.focus();

        // Trigger input event to ensure React knows about the change
        const event = new Event('input', { bubbles: true });
        textarea.dispatchEvent(event);
      }, 0);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Templates</h1>
            <p className="text-gray-600">Access denied. Admin only.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Message Templates</h1>
              <p className="text-gray-600 mt-2">Manage email and SMS templates for automatic messaging</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/bookers-templates')}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700"
                title="Manage templates for Lead Details"
              >
                <FiExternalLink /> Bookers Templates
              </button>
              <button
                onClick={() => {
                  setEditingTemplate(null);
                  resetForm();
                  setShowModal(true);
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
              >
                <FiPlus /> New Template
              </button>
            </div>
          </div>
        </div>
        {/* Templates Grid */}
        {loading ? (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        ) : (
          !loading && (() => {
            const filteredTemplates = categoryFilter === 'All' ? (templates || []) : (templates || []).filter(t => {
              const cat = Object.entries({
                'Diary Templates': ['booking_confirmation', 'appointment_reminder', 'no_show', 'reschedule', 'cancellation'],
                'Retargeting Templates': ['retargeting_gentle', 'retargeting_urgent', 'retargeting_final', 'retargeting'],
                'Sale Templates': ['sale_confirmation', 'sale_followup', 'sale', 'sale_notification', 'sale_paid_in_full', 'sale_followup_paid', 'sale_finance_agreement', 'sale_followup_finance'],
                'Lead Details Templates': ['custom', 'booker']
              }).find(([cat, types]) => types.includes(t.type));
              return cat ? cat[0] === categoryFilter : categoryFilter === 'Diary Templates';
            });

            const categorized = categorizeTemplates(filteredTemplates);

            return Object.entries(categorized).map(([cat, group]) =>
              group && group.length > 0 && (
                <div key={cat} className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold">{cat}</h2>
                    {cat === 'Lead Details Templates' && (
                      <button
                        onClick={() => navigate('/bookers-templates')}
                        className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium"
                      >
                        <FiExternalLink className="h-4 w-4" />
                        Manage in Bookers Templates
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {group.map(template => (
                      <div key={`template-${template._id}`} className="bg-white rounded-lg shadow p-6">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">{template.name}</h3>
                            <p className="text-sm text-gray-500 capitalize">{template.type.replace('_', ' ')}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {template.sendEmail && <FiMail className="text-blue-500" />}
                            {template.sendSMS && <FiPhone className="text-green-500" />}
                            {template.attachments && (() => {
                              try {
                                const attachments = JSON.parse(template.attachments);
                                return Array.isArray(attachments) && attachments.length > 0 && (
                                  <div className="flex items-center gap-1 text-purple-600" title={`${attachments.length} attachment(s)`}>
                                    <span className="text-xs">📎</span>
                                    <span className="text-xs font-medium">{attachments.length}</span>
                                  </div>
                                );
                              } catch (e) {
                                return null;
                              }
                            })()}
                          </div>
                        </div>

                        <div className="mb-4">
                          <p className="text-sm text-gray-600 line-clamp-2">{template.subject}</p>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 rounded-full text-xs ${
                              template.isActive
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              {template.isActive ? 'Active' : 'Inactive'}
                            </span>
                            {template.type === 'appointment_reminder' && (
                              <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                                {template.reminderDays} days
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePreview(template)}
                              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
                              title="Preview"
                            >
                              <FiEye />
                            </button>
                            <button
                              onClick={() => handleEdit(template)}
                              className="p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded"
                              title="Edit"
                            >
                              <FiEdit />
                            </button>
                            <button
                              onClick={() => handleDelete(template._id)}
                              className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete"
                            >
                              <FiTrash2 />
                            </button>
                          </div>
                        </div>

                        {user?.role === 'admin' && (
                          <div className="mt-4 pt-4 border-t">
                            <div className="flex items-center gap-2 mt-2">
                              <select
                                value={selectedLead}
                                onChange={(e) => setSelectedLead(e.target.value)}
                                className="px-2 py-1 border border-gray-300 rounded text-xs max-w-xs w-48 focus:ring-1 focus:ring-purple-400"
                                style={{ minWidth: 0 }}
                              >
                                <option key="select-lead-placeholder" value="">Select lead to test...</option>
                                {(leads || []).map((lead) => (
                                  <option key={`lead-${lead._id}`} value={lead._id}>
                                    {lead.name} ({lead.email})
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleTest(template)}
                                disabled={!selectedLead}
                                className="px-2 py-1 bg-purple-600 text-white rounded text-xs flex items-center gap-1 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Send test message"
                                style={{ minWidth: 0 }}
                              >
                                <FiSend size={14} /> Test
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            );
          })()
        )}

        {/* Beautiful Template Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm overflow-y-auto h-full w-full z-50">
            <div className="relative top-5 mx-auto p-0 border-0 w-full max-w-6xl shadow-2xl rounded-2xl bg-white overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-2xl font-bold">
                      {editingTemplate ? 'Edit Template' : 'Create New Template'}
                    </h3>
                    <p className="text-blue-100 mt-1">
                      {editingTemplate ? 'Update your message template' : 'Design beautiful messages for your CRM'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-white hover:text-blue-200 p-2 rounded-full hover:bg-white hover:bg-opacity-20 transition-all"
                  >
                    <FiX className="h-6 w-6" />
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                  {/* Left Panel - Template Settings */}
                  <div className="xl:col-span-1">
                    <div className="bg-gray-50 rounded-xl p-6 h-fit">
                      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <FiSettings className="text-blue-600" />
                        Template Settings
                      </h4>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Template Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                            placeholder="Enter template name"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Template Type <span className="text-red-500">*</span>
                          </label>
                          <select
                            name="type"
                            value={formData.type}
                            onChange={(e) => setFormData({...formData, type: e.target.value})}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                            required
                          >
                            <option key="booking_confirmation" value="booking_confirmation">📅 Booking Confirmation</option>
                            <option key="appointment_reminder" value="appointment_reminder">⏰ Appointment Reminder</option>
                            <option key="no_show" value="no_show">❌ No Show Follow-up</option>
                            <option key="reschedule" value="reschedule">🔄 Reschedule</option>
                            <option key="cancellation" value="cancellation">🚫 Cancellation</option>
                            <option key="retargeting_gentle" value="retargeting_gentle">💌 Retargeting (Gentle)</option>
                            <option key="retargeting_urgent" value="retargeting_urgent">⚡ Retargeting (Urgent)</option>
                            <option key="retargeting_final" value="retargeting_final">🎯 Retargeting (Final)</option>
                            <option key="sale_confirmation" value="sale_confirmation">💰 Sale Confirmation</option>
                            <option key="sale_followup" value="sale_followup">📞 Sale Follow-up</option>
                            <option key="sale_paid_in_full" value="sale_paid_in_full">🎉 Paid in Full - Welcome</option>
                            <option key="sale_followup_paid" value="sale_followup_paid">✅ Paid in Full - Follow-up</option>
                            <option key="sale_finance_agreement" value="sale_finance_agreement">📋 Finance Agreement - Welcome</option>
                            <option key="sale_followup_finance" value="sale_followup_finance">💳 Finance Agreement - Follow-up</option>
                          </select>
                        </div>

                        {formData.type === 'appointment_reminder' && (
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                              Reminder Days
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="30"
                              value={formData.reminderDays}
                              onChange={(e) => setFormData({...formData, reminderDays: parseInt(e.target.value)})}
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                            />
                          </div>
                        )}

                        {/* Toggle Switches */}
                        <div className="space-y-3">
                          <label className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300 transition-all">
                            <div className="flex items-center">
                              <FiMail className="text-blue-600 mr-3" />
                              <span className="font-medium">Send Email</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={formData.sendEmail}
                              onChange={(e) => setFormData({...formData, sendEmail: e.target.checked})}
                              className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                            />
                          </label>
                          
                          <label className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300 transition-all">
                            <div className="flex items-center">
                              <FiPhone className="text-green-600 mr-3" />
                              <span className="font-medium">Send SMS</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={formData.sendSMS}
                              onChange={(e) => setFormData({...formData, sendSMS: e.target.checked})}
                              className="w-5 h-5 text-green-600 rounded focus:ring-green-500"
                            />
                          </label>
                          
                          <label className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300 transition-all">
                            <div className="flex items-center">
                              <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                              <span className="font-medium">Active</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={formData.isActive}
                              onChange={(e) => setFormData({...formData, isActive: e.target.checked})}
                              className="w-5 h-5 text-green-600 rounded focus:ring-green-500"
                            />
                          </label>
                          
                          {/* Attachments */}
                          <div className="p-4 bg-white rounded-lg border border-gray-200">
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-4 h-4 bg-purple-500 rounded"></div>
                              <span className="font-medium">Email Attachments</span>
                              <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">
                                {(Array.isArray(formData.attachments) ? formData.attachments : []).length} files
                              </span>
                            </div>
                            
                            {/* File Upload */}
                            <div className="mb-3">
                              <input
                                type="file"
                                multiple
                                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.csv,.xlsx,.xls,.txt"
                                onChange={async (e) => {
                                  const files = Array.from(e.target.files || []);
                                  if (files.length === 0) return;
                                  
                                  // Show loading indicator
                                  const uploadButton = e.target.nextElementSibling;
                                  if (uploadButton) uploadButton.textContent = 'Uploading...';
                                  
                                  const uploaded = [];
                                  for (const file of files) {
                                    try {
                                      const fd = new FormData();
                                      fd.append('file', file);
                                      const resp = await fetch(`/api/templates/${editingTemplate?._id || 'new'}/attachments`, {
                                        method: 'POST',
                                        headers: {
                                          'Authorization': `Bearer ${localStorage.getItem('token')}`
                                        },
                                        body: fd
                                      });
                                      if (resp.ok) {
                                        const data = await resp.json();
                                        uploaded.push(data);
                                      } else {
                                        console.error('Upload failed for:', file.name);
                                      }
                                    } catch (error) {
                                      console.error('Upload error for:', file.name, error);
                                    }
                                  }
                                  
                                  setFormData(prev => ({
                                    ...prev,
                                    attachments: Array.isArray(prev.attachments) ? [...prev.attachments, ...uploaded] : uploaded
                                  }));
                                  
                                  // Reset upload button
                                  if (uploadButton) uploadButton.textContent = 'Choose Files';
                                  e.target.value = ''; // Reset input
                                }}
                                className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                                id="attachment-upload"
                              />
                              <div className="text-xs text-gray-500 mt-1">
                                Supported: PDF, Word, Images, CSV, Excel files (max 25MB per file)
                              </div>
                            </div>
                            
                            {/* Attachment List */}
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                              {(Array.isArray(formData.attachments) ? formData.attachments : []).map((a, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                      {a.mimetype?.includes('pdf') ? '📄' : 
                                       a.mimetype?.includes('word') || a.mimetype?.includes('document') ? '📝' : 
                                       a.mimetype?.includes('image') ? '🖼️' : 
                                       a.mimetype?.includes('spreadsheet') || a.mimetype?.includes('excel') ? '📊' :
                                       '📎'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm truncate" title={a.originalName || a.filename}>
                                        {a.originalName || a.filename}
                                      </div>
                                      <div className="text-xs text-gray-500 flex items-center gap-2">
                                        <span>{a.size ? `${(a.size / 1024 / 1024).toFixed(1)} MB` : 'Unknown size'}</span>
                                        {a.mimetype && (
                                          <span className="bg-gray-200 px-1 rounded text-xs">
                                            {a.mimetype.split('/')[1]?.toUpperCase()}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <a 
                                      href={a.url} 
                                      target="_blank" 
                                      rel="noreferrer" 
                                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                      title="Download/View"
                                    >
                                      View
                                    </a>
                                    <button 
                                      type="button" 
                                      className="text-red-600 hover:text-red-800 text-xs font-medium" 
                                      onClick={() => {
                                        if (window.confirm('Remove this attachment?')) {
                                          setFormData(prev => ({
                                            ...prev,
                                            attachments: (Array.isArray(prev.attachments) ? prev.attachments : [])
                                              .filter((_, i) => i !== idx)
                                          }));
                                        }
                                      }}
                                      title="Remove attachment"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))}
                              
                              {(!formData.attachments || formData.attachments.length === 0) && (
                                <div className="text-center py-6 text-gray-500">
                                  <div className="text-2xl mb-2">📎</div>
                                  <div className="text-sm">No attachments yet</div>
                                  <div className="text-xs">Files will be sent with every email</div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Variables */}
                      <div className="mt-6">
                        <h5 className="text-sm font-semibold text-gray-700 mb-3">Available Variables</h5>
                        <div className="bg-white rounded-lg border border-gray-200 max-h-48 overflow-y-auto">
                          <div className="p-3">
                            {variables.map((variable) => (
                              <button
                                key={`variable-${variable.name}`}
                                type="button"
                                onClick={() => insertVariable(variable.name)}
                                className="w-full text-left p-2 hover:bg-blue-50 rounded text-sm transition-all group"
                                title={variable.description}
                              >
                                <div className="font-mono text-blue-600 group-hover:text-blue-700">{variable.name}</div>
                                <div className="text-gray-500 text-xs">{variable.description}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Panel - Content Editor */}
                  <div className="xl:col-span-2 space-y-6">
                    {/* Email Content */}
                    {formData.sendEmail && (
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <FiMail className="text-blue-600" />
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">Email Content</h3>
                            <p className="text-sm text-gray-500">Design your email message</p>
                          </div>
                        </div>
                        
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                              Subject Line
                            </label>
                            <input
                              type="text"
                              value={formData.subject}
                              onChange={(e) => setFormData({...formData, subject: e.target.value})}
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                              placeholder="Enter email subject"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                              Email Body
                            </label>
                            <textarea
                              name="emailBody"
                              value={formData.emailBody}
                              onChange={(e) => setFormData({...formData, emailBody: e.target.value})}
                              rows={12}
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm transition-all resize-none"
                              placeholder="Write your email content here..."
                              required
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SMS Content */}
                    {formData.sendSMS && (
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                            <FiPhone className="text-green-600" />
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">SMS Content</h3>
                            <p className="text-sm text-gray-500">Design your SMS message</p>
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            SMS Message
                          </label>
                          <textarea
                            name="smsBody"
                            value={formData.smsBody}
                            onChange={(e) => setFormData({...formData, smsBody: e.target.value})}
                            rows={6}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 font-mono text-sm transition-all resize-none"
                            placeholder="Write your SMS content here..."
                            required
                          />
                          <div className="flex justify-between items-center mt-2">
                            <p className="text-xs text-gray-500">
                              Character count: <span className={`font-semibold ${(formData.smsBody || '').length > 160 ? 'text-red-500' : 'text-green-600'}`}>
                                {(formData.smsBody || '').length}/160
                              </span>
                            </p>
                            <div className="text-xs text-gray-400">
                              {Math.ceil((formData.smsBody || '').length / 160)} message(s)
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Preview Section */}
                    {(formData.emailBody || formData.smsBody) && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                        <h4 className="text-lg font-semibold text-gray-900 mb-4">Live Preview</h4>
                        <div className="space-y-4">
                          {formData.emailBody && (
                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                              <div className="text-sm font-semibold text-gray-600 mb-2">Email Preview:</div>
                              <div className="text-sm text-gray-800 whitespace-pre-wrap">{formData.emailBody}</div>
                            </div>
                          )}
                          {formData.smsBody && (
                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                              <div className="text-sm font-semibold text-gray-600 mb-2">SMS Preview:</div>
                              <div className="text-sm text-gray-800 font-mono">{formData.smsBody}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-8 flex justify-end gap-4 pt-6 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-all font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all font-medium flex items-center gap-2 shadow-lg"
                  >
                    <FiSave className="w-4 h-4" />
                    {editingTemplate ? 'Update Template' : 'Create Template'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Preview Modal */}
        {showPreview && previewData && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold">Template Preview</h2>
                  <button
                    onClick={() => setShowPreview(false)}
                    className="p-2 hover:bg-gray-100 rounded"
                  >
                    <FiX />
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="space-y-6">
                  {/* Email Preview */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <FiMail /> Email Preview
                    </h3>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <div className="mb-2">
                        <strong>Subject:</strong> {previewData.template.subject}
                      </div>
                      <div className="whitespace-pre-wrap text-sm">
                        {previewData.template.emailBody}
                      </div>
                    </div>
                  </div>

                  {/* SMS Preview */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <FiPhone /> SMS Preview
                    </h3>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <div className="whitespace-pre-wrap text-sm">
                        {previewData.template.smsBody}
                      </div>
                    </div>
                  </div>

                  {/* Sample Data */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Sample Data Used</h3>
                    <div className="bg-gray-50 p-4 rounded-lg text-sm">
                      <div><strong>Lead:</strong> {previewData.sampleData.lead.name}</div>
                      <div><strong>Email:</strong> {previewData.sampleData.lead.email}</div>
                      <div><strong>Phone:</strong> {previewData.sampleData.lead.phone}</div>
                      <div><strong>Booking Date:</strong> {previewData.sampleData.bookingDate ? new Date(previewData.sampleData.bookingDate).toDateString() : 'Not available'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Templates; 