import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit, FiEye, FiDollarSign, FiCalendar, FiMail, FiPhone, FiTrendingUp, FiAlertCircle, FiCheckCircle, FiClock, FiX, FiBell } from 'react-icons/fi';
import axios from 'axios';
import PaymentModal from '../components/PaymentModal';

const Finance = () => {
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingAgreement, setEditingAgreement] = useState(null);
  const [selectedAgreement, setSelectedAgreement] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPaymentAgreement, setSelectedPaymentAgreement] = useState(null);
  const [stats, setStats] = useState({});
  const [duePayments, setDuePayments] = useState([]);
  const [overduePayments, setOverduePayments] = useState([]);
  const [leads, setLeads] = useState([]);
  const [formData, setFormData] = useState({
    leadId: '',
    saleId: '',
    totalAmount: '',
    paymentAmount: '',
    frequency: 'monthly',
    startDate: '',
    dueDay: 1,
    gracePeriodDays: 5,
    lateFeeAmount: 0,
    notes: '',
    emailReminders: true,
    smsReminders: true
  });

  useEffect(() => {
    fetchAgreements();
    fetchStats();
    fetchDuePayments();
    fetchOverduePayments();
    fetchLeads();
  }, []);

  const fetchAgreements = async () => {
    try {
      const response = await axios.get('/api/finance/agreements');
      setAgreements(response.data);
    } catch (error) {
      console.error('Error fetching agreements:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await axios.get('/api/finance/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchDuePayments = async () => {
    try {
      const response = await axios.get('/api/finance/due-payments');
      setDuePayments(response.data);
    } catch (error) {
      console.error('Error fetching due payments:', error);
    }
  };

  const fetchOverduePayments = async () => {
    try {
      const response = await axios.get('/api/finance/overdue');
      setOverduePayments(response.data);
    } catch (error) {
      console.error('Error fetching overdue payments:', error);
    }
  };

  const fetchLeads = async () => {
    try {
      const response = await axios.get('/api/leads');
      setLeads(response.data);
    } catch (error) {
      console.error('Error fetching leads:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      // Validate and convert numeric fields
      const submitData = {
        ...formData,
        totalAmount: parseFloat(formData.totalAmount) || 0,
        paymentAmount: parseFloat(formData.paymentAmount) || 0,
        dueDay: parseInt(formData.dueDay) || 1,
        gracePeriodDays: parseInt(formData.gracePeriodDays) || 5,
        lateFeeAmount: parseFloat(formData.lateFeeAmount) || 0
      };

      // Additional validation
      if (!submitData.leadId || !submitData.totalAmount || !submitData.paymentAmount) {
        alert('Please fill in all required fields');
        return;
      }

      console.log('📤 Submitting finance agreement:', submitData);

      const url = editingAgreement
        ? `/api/finance/agreement/${editingAgreement.id}`
        : '/api/finance/agreement';

      const method = editingAgreement ? 'PUT' : 'POST';

      const response = await axios({
        method,
        url,
        data: submitData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.status === 200 || response.status === 201) {
        setShowModal(false);
        setEditingAgreement(null);
        resetForm();
        fetchAgreements();
        fetchStats();
      }
    } catch (error) {
      console.error('Error saving agreement:', error);
      alert(error.response?.data?.message || 'Error saving agreement');
    }
  };

  const handleEdit = (agreement) => {
    setEditingAgreement(agreement);
    setFormData({
      leadId: agreement.lead_id,
      saleId: agreement.sale_id || '',
      totalAmount: agreement.total_amount,
      paymentAmount: agreement.monthly_payment,
      frequency: agreement.payment_frequency,
      startDate: agreement.start_date?.split('T')[0] || '',
      dueDay: 1,
      gracePeriodDays: 5,
      lateFeeAmount: 0,
      notes: agreement.notes || '',
      emailReminders: true,
      smsReminders: true
    });
    setShowModal(true);
  };

  const handleViewDetails = async (agreement) => {
    try {
      const response = await axios.get(`/api/finance/agreement/${agreement.id}`);
      setSelectedAgreement(response.data);
      setShowDetails(true);
    } catch (error) {
      console.error('Error fetching agreement details:', error);
    }
  };

  const handleRecordPayment = (agreement) => {
    setSelectedPaymentAgreement(agreement);
    setShowPaymentModal(true);
  };

  const handlePaymentSuccess = () => {
    fetchAgreements();
    fetchStats();
    fetchDuePayments();
    fetchOverduePayments();
  };

  const resetForm = () => {
    setFormData({
      leadId: '',
      saleId: '',
      totalAmount: '',
      paymentAmount: '',
      frequency: 'monthly',
      startDate: '',
      dueDay: 1,
      gracePeriodDays: 5,
      lateFeeAmount: 0,
      notes: '',
      emailReminders: true,
      smsReminders: true
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', { 
      style: 'currency', 
      currency: 'GBP' 
    }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'completed': return 'text-blue-600 bg-blue-100';
      case 'defaulted': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getFrequencyLabel = (frequency) => {
    const labels = {
      'weekly': 'Weekly',
      'bi-weekly': 'Bi-weekly',
      'monthly': 'Monthly',
      'bi-monthly': 'Bi-monthly',
      'quarterly': 'Quarterly'
    };
    return labels[frequency] || frequency;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-gray-200 rounded"></div>
              ))}
            </div>
            <div className="h-96 bg-gray-200 rounded"></div>
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
              <h1 className="text-3xl font-bold text-gray-900">Finance Management</h1>
              <p className="text-gray-600 mt-2">Manage finance agreements and payment schedules</p>
            </div>
            <button
              onClick={() => {
                setEditingAgreement(null);
                resetForm();
                setShowModal(true);
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
            >
              <FiPlus /> New Agreement
            </button>
          </div>
        </div>

        {/* Enhanced Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-200 p-6 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl shadow-lg">
                <FiDollarSign className="h-8 w-8 text-white" />
              </div>
              <div className="ml-6">
                <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Total Financed</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{formatCurrency(stats?.total_financed || 0)}</p>
                <p className="text-xs text-blue-600 font-medium mt-1">Active agreements</p>
              </div>
            </div>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-br from-green-400 to-green-600 rounded-2xl shadow-lg">
                <FiCheckCircle className="h-8 w-8 text-white" />
              </div>
              <div className="ml-6">
                <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Total Paid</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{formatCurrency(stats?.total_collected || 0)}</p>
                <p className="text-xs text-green-600 font-medium mt-1">↗ Collected so far</p>
              </div>
            </div>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-red-200 p-6 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-br from-red-400 to-red-600 rounded-2xl shadow-lg">
                <FiAlertCircle className="h-8 w-8 text-white" />
              </div>
              <div className="ml-6">
                <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Unpaid Amount</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{formatCurrency(stats?.total_outstanding || 0)}</p>
                <p className="text-xs text-red-600 font-medium mt-1">Outstanding balance</p>
              </div>
            </div>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-orange-200 p-6 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl shadow-lg">
                <FiClock className="h-8 w-8 text-white" />
              </div>
              <div className="ml-6">
                <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Due This Month</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{formatCurrency(stats?.total_due_this_month || 0)}</p>
                <p className="text-xs text-orange-600 font-medium mt-1">{stats?.agreements_due_this_month || 0} payments</p>
              </div>
            </div>
          </div>
        </div>

        {/* Payment Status Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 flex items-center">
                <FiTrendingUp className="h-6 w-6 text-blue-600 mr-3" />
                Payment Performance
              </h2>
              <div className="flex space-x-2">
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                  {stats?.total_collected && stats?.total_financed ?
                    Math.round((stats.total_collected / stats.total_financed) * 100) : 0}% Collected
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-600">Collection Progress</span>
                <span className="text-sm text-gray-500">
                  {formatCurrency(stats?.total_collected || 0)} of {formatCurrency(stats?.total_financed || 0)}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-green-400 to-green-600 h-3 rounded-full transition-all duration-500"
                  style={{
                    width: `${stats?.total_collected && stats?.total_financed ?
                      (stats.total_collected / stats.total_financed) * 100 : 0}%`
                  }}
                ></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="bg-gradient-to-br from-blue-50 to-purple-50 p-4 rounded-xl border border-blue-200">
                <p className="text-sm font-medium text-gray-600">Active Agreements</p>
                <p className="text-2xl font-bold text-blue-600">{stats?.active_agreements || 0}</p>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-blue-50 p-4 rounded-xl border border-green-200">
                <p className="text-sm font-medium text-gray-600">Avg Payment</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(stats?.avg_payment_amount || 0)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
              <FiBell className="h-5 w-5 text-red-600 mr-2" />
              Payment Alerts
            </h3>

            <div className="space-y-4">
              {overduePayments && overduePayments.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-red-800">Overdue Payments</p>
                      <p className="text-2xl font-bold text-red-600">{overduePayments.length}</p>
                    </div>
                    <FiAlertCircle className="h-8 w-8 text-red-500" />
                  </div>
                  <p className="text-xs text-red-600 mt-2">Require immediate attention</p>
                </div>
              )}

              {duePayments && duePayments.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-yellow-800">Due Soon</p>
                      <p className="text-2xl font-bold text-yellow-600">{duePayments.length}</p>
                    </div>
                    <FiClock className="h-8 w-8 text-yellow-500" />
                  </div>
                  <p className="text-xs text-yellow-600 mt-2">Next 7 days</p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-800">On Track</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {Math.max(0, (stats?.active_agreements || 0) - (overduePayments?.length || 0) - (duePayments?.length || 0))}
                    </p>
                  </div>
                  <FiCheckCircle className="h-8 w-8 text-blue-500" />
                </div>
                <p className="text-xs text-blue-600 mt-2">Up to date</p>
              </div>
            </div>
          </div>
        </div>

        {/* Alerts */}
        {((duePayments && duePayments.length > 0) || (overduePayments && overduePayments.length > 0)) && (
          <div className="mb-6 space-y-3">
            {overduePayments && overduePayments.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center">
                  <FiAlertCircle className="h-5 w-5 text-red-400" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">
                      {overduePayments.length} Overdue Payment{overduePayments.length !== 1 ? 's' : ''}
                    </h3>
                    <p className="text-sm text-red-700 mt-1">
                      These payments are past due and require immediate attention.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {duePayments && duePayments.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center">
                  <FiClock className="h-5 w-5 text-yellow-400" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-yellow-800">
                      {duePayments.length} Payment{duePayments.length !== 1 ? 's' : ''} Due Soon
                    </h3>
                    <p className="text-sm text-yellow-700 mt-1">
                      These payments are due within the next 7 days.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Agreements Table */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Finance Agreements</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Agreement
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Payment
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Next Due
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {agreements && agreements.length > 0 ? agreements.map((agreement) => (
                  <tr key={agreement.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {agreement?.agreement_number || 'N/A'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {getFrequencyLabel(agreement?.payment_frequency || 'monthly')}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {agreement?.lead_name || 'N/A'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {agreement?.lead_email || 'N/A'}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {formatCurrency(agreement?.total_amount || 0)}
                        </div>
                        <div className="text-sm text-gray-500">
                          {formatCurrency(agreement?.remaining_balance || 0)} remaining
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                                          <div className="text-sm text-gray-900">
                      {formatCurrency(agreement?.monthly_payment || 0)}
                    </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                                          <div className="text-sm text-gray-900">
                      {agreement?.next_payment_date ? formatDate(agreement.next_payment_date) : 'N/A'}
                    </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                                              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(agreement?.status || 'active')}`}>
                          {agreement?.status || 'active'}
                        </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleViewDetails(agreement)}
                          className="text-blue-600 hover:text-blue-900"
                          title="View Details"
                        >
                          <FiEye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(agreement)}
                          className="text-indigo-600 hover:text-indigo-900"
                          title="Edit Agreement"
                        >
                          <FiEdit className="h-4 w-4" />
                        </button>
                        {agreement?.remaining_balance > 0 && (
                          <button
                            onClick={() => handleRecordPayment(agreement)}
                            className="text-green-600 hover:text-green-900"
                            title="Record Payment"
                          >
                            <FiDollarSign className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="7" className="px-6 py-4 text-center text-gray-500">
                      No finance agreements found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {editingAgreement ? 'Edit Finance Agreement' : 'New Finance Agreement'}
              </h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Lead</label>
                  <select
                    value={formData.leadId}
                    onChange={(e) => setFormData({...formData, leadId: e.target.value})}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  >
                    <option value="">Select a lead</option>
                    {leads && leads.length > 0 ? leads.map(lead => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name} - {lead.email}
                      </option>
                    )) : (
                      <option value="" disabled>No leads available</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Total Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.totalAmount}
                    onChange={(e) => setFormData({...formData, totalAmount: e.target.value})}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Payment Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.paymentAmount}
                    onChange={(e) => setFormData({...formData, paymentAmount: e.target.value})}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Frequency</label>
                  <select
                    value={formData.frequency}
                    onChange={(e) => setFormData({...formData, frequency: e.target.value})}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  >
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="bi-monthly">Bi-monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Start Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({...formData, startDate: e.target.value})}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Due Day</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={formData.dueDay}
                    onChange={(e) => setFormData({...formData, dueDay: parseInt(e.target.value)})}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>

                <div className="flex items-center space-x-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.emailReminders}
                      onChange={(e) => setFormData({...formData, emailReminders: e.target.checked})}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span className="ml-2 text-sm text-gray-700">Email Reminders</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.smsReminders}
                      onChange={(e) => setFormData({...formData, smsReminders: e.target.checked})}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span className="ml-2 text-sm text-gray-700">SMS Reminders</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    rows="3"
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
                  >
                    {editingAgreement ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Agreement Details Modal */}
      {showDetails && selectedAgreement && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-3/4 max-w-4xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Finance Agreement Details
                </h3>
                <button
                  onClick={() => setShowDetails(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <FiX className="h-6 w-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Agreement Information</h4>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Agreement Number</dt>
                      <dd className="text-sm text-gray-900">{selectedAgreement?.agreement_number || 'N/A'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Customer</dt>
                      <dd className="text-sm text-gray-900">{selectedAgreement?.lead_name || 'N/A'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Total Amount</dt>
                      <dd className="text-sm text-gray-900">{formatCurrency(selectedAgreement?.total_amount || 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Payment Amount</dt>
                      <dd className="text-sm text-gray-900">{formatCurrency(selectedAgreement?.monthly_payment || 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Frequency</dt>
                      <dd className="text-sm text-gray-900">{getFrequencyLabel(selectedAgreement?.payment_frequency || 'monthly')}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Start Date</dt>
                      <dd className="text-sm text-gray-900">{selectedAgreement?.start_date ? formatDate(selectedAgreement.start_date) : 'N/A'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Next Payment Due</dt>
                      <dd className="text-sm text-gray-900">{selectedAgreement?.next_payment_date ? formatDate(selectedAgreement.next_payment_date) : 'N/A'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Status</dt>
                      <dd className="text-sm text-gray-900">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(selectedAgreement?.status || 'active')}`}>
                          {selectedAgreement?.status || 'active'}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Payment Summary</h4>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Total Paid</dt>
                      <dd className="text-sm text-gray-900">{formatCurrency(selectedAgreement?.total_paid || 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Remaining Amount</dt>
                      <dd className="text-sm text-gray-900">{formatCurrency(selectedAgreement?.remaining_balance || 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Payment Count</dt>
                      <dd className="text-sm text-gray-900">{selectedAgreement?.payments?.length || 0}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Last Payment</dt>
                      <dd className="text-sm text-gray-900">
                        {selectedAgreement?.payments && selectedAgreement.payments.length > 0 ?
                          formatDate(selectedAgreement.payments[0].payment_date) : 'No payments yet'}
                      </dd>
                    </div>
                  </dl>

                  {selectedAgreement?.payments && selectedAgreement.payments.length > 0 && (
                    <div className="mt-4">
                      <h5 className="font-medium text-gray-900 mb-2">Payment History</h5>
                      <div className="space-y-2">
                        {selectedAgreement.payments.map((payment) => (
                          <div key={payment.id} className="flex justify-between text-sm">
                            <span>{formatDate(payment.payment_date)}</span>
                            <span className="font-medium">{formatCurrency(payment.amount_paid)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowDetails(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setSelectedPaymentAgreement(null);
        }}
        agreement={selectedPaymentAgreement}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
};

export default Finance; 