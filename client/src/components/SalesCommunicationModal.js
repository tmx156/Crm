import React, { useState, useEffect } from 'react';
import { FiMail, FiPhone, FiEye, FiSend, FiX, FiUsers, FiFileText } from 'react-icons/fi';
import axios from 'axios';

const SalesCommunicationModal = ({ isOpen, onClose, selectedSales, onSuccess }) => {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [communicationType, setCommunicationType] = useState('both'); // 'email', 'sms', 'both'
  const [customSubject, setCustomSubject] = useState('');
  const [customEmailBody, setCustomEmailBody] = useState('');
  const [customSmsBody, setCustomSmsBody] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedTemplate) {
      loadTemplate();
    }
  }, [selectedTemplate]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/templates', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      // Filter templates based on payment types of selected sales
      const paymentTypes = [...new Set(selectedSales.map(sale => sale.payment_type))];
      const filteredTemplates = response.data.filter(template => {
        if (paymentTypes.includes('full_payment') && paymentTypes.includes('finance')) {
          // If mixed payment types, show all sales templates
          return ['sale_paid_in_full', 'sale_followup_paid', 'sale_finance_agreement', 'sale_followup_finance', 'sale_confirmation', 'sale_followup', 'sale_notification'].includes(template.type);
        } else if (paymentTypes.includes('full_payment')) {
          // Only full payment sales
          return ['sale_paid_in_full', 'sale_followup_paid', 'sale_confirmation', 'sale_followup', 'sale_notification'].includes(template.type);
        } else if (paymentTypes.includes('finance')) {
          // Only finance sales
          return ['sale_finance_agreement', 'sale_followup_finance', 'sale_confirmation', 'sale_followup', 'sale_notification'].includes(template.type);
        }
        return false;
      });
      
      setTemplates(filteredTemplates);
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplate = async () => {
    if (!selectedTemplate) return;
    
    try {
      const template = templates.find(t => t._id === selectedTemplate);
      if (template) {
        setCustomSubject(template.subject || '');
        setCustomEmailBody(template.emailBody || '');
        setCustomSmsBody(template.smsBody || '');
        setCommunicationType(template.sendEmail && template.sendSMS ? 'both' : template.sendEmail ? 'email' : 'sms');
      }
    } catch (error) {
      console.error('Error loading template:', error);
    }
  };

  const generatePreview = async () => {
    if (!selectedTemplate || selectedSales.length === 0) return;
    
    try {
      setLoading(true);
      const response = await axios.post(`/api/templates/${selectedTemplate}/preview`, {
        sales: selectedSales.slice(0, 3) // Preview first 3 sales
      }, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      setPreviewData(response.data);
      setShowPreview(true);
    } catch (error) {
      console.error('Error generating preview:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendCommunication = async () => {
    if (!selectedTemplate || selectedSales.length === 0) return;
    
    try {
      setSending(true);
      
      const payload = {
        templateId: selectedTemplate,
        sales: selectedSales.map(sale => ({
          id: sale.id,
          payment_type: sale.payment_type,
          lead_name: sale.lead_name,
          lead_email: sale.lead_email,
          lead_phone: sale.lead_phone,
          amount: sale.amount,
          sale_date: sale.sale_created_at || sale.created_at
        })),
        communicationType,
        customSubject,
        customEmailBody,
        customSmsBody
      };
      
      const response = await axios.post('/api/sales/bulk-communication', payload, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      // Show detailed results
      let resultMessage = `${response.data.message}\n\n${response.data.note || ''}`;

      if (response.data.errorCount > 0) {
        resultMessage += '\n\nErrors:';
        response.data.results.forEach(result => {
          if (result.error) {
            resultMessage += `\n• ${result.customerName || result.saleId}: ${result.error}`;
          }
        });
      }

      alert(resultMessage);
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error sending communications:', error);
      alert('Error sending communications. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const getPaymentTypeLabel = (paymentType) => {
    switch (paymentType) {
      case 'full_payment': return 'Paid in Full';
      case 'finance': return 'Finance Agreement';
      default: return paymentType?.replace('_', ' ') || 'Unknown';
    }
  };

  const getPaymentTypeColor = (paymentType) => {
    switch (paymentType) {
      case 'full_payment': return 'bg-green-100 text-green-800';
      case 'finance': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border w-full max-w-4xl shadow-lg rounded-md bg-white">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-gray-900">
            Send Communication to {selectedSales.length} Customer{selectedSales.length !== 1 ? 's' : ''}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <FiX className="h-6 w-6" />
          </button>
        </div>

        {/* Selected Sales Summary */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center mb-3">
            <FiUsers className="h-5 w-5 text-gray-600 mr-2" />
            <span className="font-medium text-gray-700">Selected Customers:</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {selectedSales.slice(0, 6).map((sale, index) => (
              <div key={sale.id} className="flex items-center justify-between p-2 bg-white rounded border">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-medium text-blue-600">
                    {index + 1}
                  </div>
                  <div className="ml-3">
                    <div className="text-sm font-medium text-gray-900">{sale.lead_name}</div>
                    <div className="text-xs text-gray-500">{sale.lead_email}</div>
                  </div>
                </div>
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPaymentTypeColor(sale.payment_type)}`}>
                  {getPaymentTypeLabel(sale.payment_type)}
                </span>
              </div>
            ))}
            {selectedSales.length > 6 && (
              <div className="text-sm text-gray-500 italic">
                +{selectedSales.length - 6} more customers
              </div>
            )}
          </div>
        </div>

        {/* Template Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Template
          </label>
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={loading}
          >
            <option value="">Choose a template...</option>
            {templates.map(template => (
              <option key={template._id} value={template._id}>
                {template.name} ({template.type.replace(/_/g, ' ')})
              </option>
            ))}
          </select>
        </div>

        {/* Communication Type Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Communication Type
          </label>
          <div className="flex space-x-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="email"
                checked={communicationType === 'email'}
                onChange={(e) => setCommunicationType(e.target.value)}
                className="mr-2"
              />
              <FiMail className="h-4 w-4 text-blue-600 mr-1" />
              Email Only
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="sms"
                checked={communicationType === 'sms'}
                onChange={(e) => setCommunicationType(e.target.value)}
                className="mr-2"
              />
              <FiPhone className="h-4 w-4 text-green-600 mr-1" />
              SMS Only
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="both"
                checked={communicationType === 'both'}
                onChange={(e) => setCommunicationType(e.target.value)}
                className="mr-2"
              />
              <FiMail className="h-4 w-4 text-blue-600 mr-1" />
              <FiPhone className="h-4 w-4 text-green-600 mr-1" />
              Both
            </label>
          </div>
        </div>

        {/* Custom Content */}
        {(communicationType === 'email' || communicationType === 'both') && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Subject
            </label>
            <input
              type="text"
              value={customSubject}
              onChange={(e) => setCustomSubject(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter email subject..."
            />
          </div>
        )}

        {(communicationType === 'email' || communicationType === 'both') && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Body
            </label>
            <textarea
              value={customEmailBody}
              onChange={(e) => setCustomEmailBody(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter email body..."
            />
          </div>
        )}

        {(communicationType === 'sms' || communicationType === 'both') && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              SMS Body
            </label>
            <textarea
              value={customSmsBody}
              onChange={(e) => setCustomSmsBody(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter SMS message..."
            />
            <div className="text-xs text-gray-500 mt-1">
              Character count: {customSmsBody.length} (SMS limit: 160 characters)
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center">
          <div className="flex space-x-3">
            <button
              onClick={generatePreview}
              disabled={!selectedTemplate || loading}
              className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 flex items-center"
            >
              <FiEye className="h-4 w-4 mr-2" />
              Preview
            </button>
          </div>
          
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
            >
              Cancel
            </button>
            <button
              onClick={sendCommunication}
              disabled={!selectedTemplate || sending || selectedSales.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center"
            >
              {sending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Sending...
                </>
              ) : (
                <>
                  <FiSend className="h-4 w-4 mr-2" />
                  Send to {selectedSales.length} Customer{selectedSales.length !== 1 ? 's' : ''}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Preview Modal */}
        {showPreview && previewData && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-lg font-medium text-gray-900">Preview</h4>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <FiX className="h-6 w-6" />
                </button>
              </div>
              
              <div className="space-y-4">
                {previewData.map((preview, index) => (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-700">{preview.customerName}</span>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPaymentTypeColor(preview.paymentType)}`}>
                        {getPaymentTypeLabel(preview.paymentType)}
                      </span>
                    </div>
                    
                    {(communicationType === 'email' || communicationType === 'both') && (
                      <div className="mb-3">
                        <div className="text-sm font-medium text-gray-600 mb-1">Email Preview:</div>
                        <div className="text-sm text-gray-800 bg-gray-50 p-2 rounded">
                          <div className="font-medium">Subject: {preview.emailSubject}</div>
                          <div className="mt-2 whitespace-pre-wrap">{preview.emailBody}</div>
                        </div>
                      </div>
                    )}
                    
                    {(communicationType === 'sms' || communicationType === 'both') && (
                      <div>
                        <div className="text-sm font-medium text-gray-600 mb-1">SMS Preview:</div>
                        <div className="text-sm text-gray-800 bg-gray-50 p-2 rounded">
                          {preview.smsBody}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SalesCommunicationModal;
