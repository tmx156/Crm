import React, { useState, useEffect } from 'react';
import { X, Mail, MessageSquare, DollarSign, CreditCard } from 'lucide-react';

const SaleModal = ({ isOpen, onClose, lead, existingSale, onSaveSuccess }) => {
  const [formData, setFormData] = useState({
    saleAmount: (existingSale && existingSale.saleAmount) ? existingSale.saleAmount.toString() : '',
    paymentMethod: existingSale?.paymentMethod || 'cash',
    paymentType: existingSale?.paymentType || 'full_payment',
    financeAmount: '',
    financeFrequency: 'monthly',
    financeStartDate: new Date().toISOString().split('T')[0],
    notes: existingSale?.notes || '',
    images: [],
    emailReceipt: false,
    smsReceipt: false,
    customEmail: '',
    customPhone: ''
  });

  const [loading, setLoading] = useState(false);
  const [receiptSending, setReceiptSending] = useState(false);

  // Update form data when existingSale changes
  useEffect(() => {
    if (existingSale) {
      setFormData({
        saleAmount: existingSale.saleAmount ? existingSale.saleAmount.toString() : '',
        paymentMethod: existingSale.paymentMethod || 'cash',
        paymentType: existingSale.paymentType || 'full_payment',
        financeAmount: '',
        financeFrequency: 'monthly',
        financeStartDate: new Date().toISOString().split('T')[0],
        notes: existingSale.notes || '',
        images: [],
        emailReceipt: false,
        smsReceipt: false,
        customEmail: '',
        customPhone: ''
      });
    } else {
      setFormData({
        saleAmount: '',
        paymentMethod: 'cash',
        paymentType: 'full_payment',
        financeAmount: '',
        financeFrequency: 'monthly',
        financeStartDate: new Date().toISOString().split('T')[0],
        notes: '',
        images: [],
        emailReceipt: false,
        smsReceipt: false,
        customEmail: '',
        customPhone: ''
      });
    }
  }, [existingSale]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const saleData = {
        saleAmount: parseFloat(formData.saleAmount),
        paymentMethod: formData.paymentMethod,
        paymentType: formData.paymentType,
        notes: formData.notes,
        sendReceipt: formData.emailReceipt || formData.smsReceipt,
        customEmail: formData.customEmail || lead.email,
        customPhone: formData.customPhone || lead.phone
      };

      let response;
      if (existingSale) {
        // Update existing sale
        response = await fetch(`/api/sales/${existingSale.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(saleData)
        });
      } else {
        // Create new sale
        saleData.leadId = lead.id;
        response = await fetch('/api/sales', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(saleData)
        });
      }

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Sale completed successfully:', result);

        // If it's a finance agreement, create the finance record
        if (formData.paymentType === 'finance' && !existingSale) {
          await createFinanceAgreement(result.id);
        }

        // Send receipts if requested
        if ((formData.emailReceipt || formData.smsReceipt) && result.id) {
          await sendReceipts(result.id);
        }

        onSaveSuccess?.();
        onClose();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save sale');
      }
    } catch (error) {
      console.error('Error saving sale:', error);
      alert('Failed to save sale: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const createFinanceAgreement = async (saleId) => {
    try {
      const financeData = {
        leadId: lead.id,
        totalAmount: parseFloat(formData.saleAmount),
        paymentAmount: parseFloat(formData.financeAmount),
        frequency: formData.financeFrequency,
        startDate: formData.financeStartDate,
        notes: `Finance agreement created from sale ${saleId}`
      };

      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(financeData)
      });

      if (!response.ok) {
        throw new Error('Failed to create finance agreement');
      }
    } catch (error) {
      console.error('Error creating finance agreement:', error);
      alert('Sale saved but failed to create finance agreement. Please create it manually.');
    }
  };

  const sendReceipts = async (saleId) => {
    setReceiptSending(true);
    try {
      const promises = [];

      if (formData.emailReceipt) {
        promises.push(
          fetch(`/api/sales/${saleId}/send-receipt/email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
              email: formData.customEmail || lead.email
            })
          }).then(async response => {
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
              throw new Error(`Email receipt failed: ${response.status} - ${errorData.error || errorData.message || 'Unknown error'}`);
            }
            return response.json();
          })
        );
      }

      if (formData.smsReceipt) {
        promises.push(
          fetch(`/api/sales/${saleId}/send-receipt/sms`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
              phone: formData.customPhone || lead.phone
            })
          }).then(async response => {
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
              throw new Error(`SMS receipt failed: ${response.status} - ${errorData.error || errorData.message || 'Unknown error'}`);
            }
            return response.json();
          })
        );
      }

      const results = await Promise.allSettled(promises);

      // Check results and log any failures
      results.forEach((result, index) => {
        const type = index === 0 && formData.emailReceipt ? 'email' : 'SMS';
        if (result.status === 'fulfilled') {
          console.log(`✅ ${type} receipt sent successfully`);
        } else {
          console.error(`❌ ${type} receipt failed:`, result.reason);
        }
      });

      // Check if any failed
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.error(`❌ ${failures.length} receipt(s) failed to send`);
        alert(`Sale saved but ${failures.length} receipt(s) failed to send. Check console for details.`);
      } else {
        console.log('✅ All receipts sent successfully');
      }
    } catch (error) {
      console.error('Error sending receipts:', error);
      alert('Sale saved but failed to send receipts. You can send them manually later.');
    } finally {
      setReceiptSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[98vh] flex flex-col overflow-hidden">
        {/* Sticky Header */}
        <div className="flex items-center justify-between p-6 border-b bg-white sticky top-0 z-10">
          <h2 className="text-xl font-semibold text-gray-900">
            {existingSale ? 'Edit Sale' : 'Record Sale'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Sale Amount - moved to top */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sale Amount (£)
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input
                type="number"
                name="saleAmount"
                value={formData.saleAmount}
                onChange={handleInputChange}
                step="0.01"
                min="0"
                required
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Customer Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium text-gray-900 mb-2">Customer Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Name:</span> {lead.name}
              </div>
              <div>
                <span className="font-medium">Email:</span> {lead.email}
              </div>
              <div>
                <span className="font-medium">Phone:</span> {lead.phone}
              </div>
              <div>
                <span className="font-medium">Booking Date:</span> {new Date(lead.dateBooked).toLocaleDateString()}
              </div>
            </div>
          </div>

          {/* Payment Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Type
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center p-3 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="paymentType"
                  value="full_payment"
                  checked={formData.paymentType === 'full_payment'}
                  onChange={handleInputChange}
                  className="mr-2"
                />
                <span className="text-sm font-medium">Full Payment</span>
              </label>
              <label className="flex items-center p-3 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="paymentType"
                  value="finance"
                  checked={formData.paymentType === 'finance'}
                  onChange={handleInputChange}
                  className="mr-2"
                />
                <span className="text-sm font-medium">Finance Agreement</span>
              </label>
            </div>
          </div>

          {/* Finance Options - Only show if finance is selected */}
          {formData.paymentType === 'finance' && (
            <div className="bg-blue-50 p-4 rounded-lg space-y-4">
              <h3 className="font-medium text-gray-900">Finance Agreement Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {formData.financeFrequency === 'weekly' ? 'Weekly' : 'Monthly'} Payment Amount (£)
                  </label>
                  <input
                    type="number"
                    name="financeAmount"
                    value={formData.financeAmount}
                    onChange={handleInputChange}
                    step="0.01"
                    min="0"
                    required={formData.paymentType === 'finance'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter custom payment amount"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Set how much the customer will pay each {formData.financeFrequency === 'weekly' ? 'week' : 'month'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Frequency
                  </label>
                  <select
                    name="financeFrequency"
                    value={formData.financeFrequency}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              
              {/* Payment Calculation Display */}
              {formData.saleAmount && formData.financeAmount && (
                <div className="bg-white p-3 rounded-md border border-blue-200">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Payment Summary</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Total Amount:</span>
                      <span className="font-medium ml-2">£{parseFloat(formData.saleAmount).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">{formData.financeFrequency === 'weekly' ? 'Weekly' : 'Monthly'} Payment:</span>
                      <span className="font-medium ml-2">£{parseFloat(formData.financeAmount || 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Number of Payments:</span>
                      <span className="font-medium ml-2">
                        {formData.financeAmount > 0 ? Math.ceil(parseFloat(formData.saleAmount) / parseFloat(formData.financeAmount)) : 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Duration:</span>
                      <span className="font-medium ml-2">
                        {formData.financeAmount > 0 ? (
                          formData.financeFrequency === 'weekly' 
                            ? `${Math.ceil(parseFloat(formData.saleAmount) / parseFloat(formData.financeAmount))} weeks`
                            : `${Math.ceil(parseFloat(formData.saleAmount) / parseFloat(formData.financeAmount))} months`
                        ) : '0 months'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  name="financeStartDate"
                  value={formData.financeStartDate}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Method
            </label>
            <div className="relative">
              <CreditCard className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <select
                name="paymentMethod"
                value={formData.paymentMethod}
                onChange={handleInputChange}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleInputChange}
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Any additional notes about the sale..."
            />
          </div>

          {/* Image Upload - Temporarily Disabled */}
          <div className="bg-gray-100 p-4 rounded-lg">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload Images (Coming Soon)
            </label>
            <p className="text-sm text-gray-500">Image upload feature will be available in the next update.</p>
          </div>

          {/* Receipt Options */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-medium text-gray-900 mb-3">Send Receipt</h3>
            <div className="space-y-3">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="emailReceipt"
                  name="emailReceipt"
                  checked={formData.emailReceipt}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="emailReceipt" className="ml-2 text-sm text-gray-700 flex items-center">
                  <Mail className="w-4 h-4 mr-1" />
                  Send Email Receipt
                </label>
              </div>

              {formData.emailReceipt && (
                <input
                  type="email"
                  name="customEmail"
                  value={formData.customEmail}
                  onChange={handleInputChange}
                  placeholder={lead.email || "Enter email address"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="smsReceipt"
                  name="smsReceipt"
                  checked={formData.smsReceipt}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="smsReceipt" className="ml-2 text-sm text-gray-700 flex items-center">
                  <MessageSquare className="w-4 h-4 mr-1" />
                  Send SMS Receipt
                </label>
              </div>

              {formData.smsReceipt && (
                <input
                  type="tel"
                  name="customPhone"
                  value={formData.customPhone}
                  onChange={handleInputChange}
                  placeholder={lead.phone || "Enter phone number"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || receiptSending}
              className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Saving...' : receiptSending ? 'Sending Receipts...' : (existingSale ? 'Update Sale' : 'Save Sale')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SaleModal; 