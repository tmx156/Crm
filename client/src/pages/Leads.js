import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiPlus, FiSearch, FiFilter, FiChevronRight, FiUserPlus, FiCalendar, FiWifi, FiUpload, FiTrash2, FiX, FiFileText, FiCheck } from 'react-icons/fi';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import LeadAnalysisModal from '../components/LeadAnalysisModal';
import LazyImage from '../components/LazyImage';
import VirtualLeadsList from '../components/VirtualLeadsList';
import { getOptimizedImageUrl } from '../utils/imageUtils';

const Leads = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { subscribeToLeadUpdates, isConnected } = useSocket();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [leadCounts, setLeadCounts] = useState({
    total: 0,
    new: 0,
    booked: 0,
    attended: 0,
    cancelled: 0,
    assigned: 0,
    rejected: 0
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all'); // New: Date filter
  const [customDateStart, setCustomDateStart] = useState(''); // New: Custom date range start
  const [customDateEnd, setCustomDateEnd] = useState(''); // New: Custom date range end
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLeads, setTotalLeads] = useState(0);
  const [leadsPerPage] = useState(25); // Reduced from 50 to 25 for better performance
  const [useVirtualScrolling, setUseVirtualScrolling] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);

  const [selectedLead, setSelectedLead] = useState(null);
  const [salesTeam, setSalesTeam] = useState([]);
  const [selectedBooker, setSelectedBooker] = useState('');
  const [selectedLeads, setSelectedLeads] = useState([]);
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false);
  const [bulkAssignBooker, setBulkAssignBooker] = useState('');

  // Upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  
  // Column mapping state
  const [showColumnMappingModal, setShowColumnMappingModal] = useState(false);
  const [columnMappingData, setColumnMappingData] = useState(null);
  const [columnMapping, setColumnMapping] = useState({});
  const [mappingErrors, setMappingErrors] = useState([]);
  
  // Analysis state
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [processedLeads, setProcessedLeads] = useState([]);
  
  // Quick notes state
  const [showQuickNotesModal, setShowQuickNotesModal] = useState(false);
  const [quickNotesLead, setQuickNotesLead] = useState(null);
  const [quickNotesText, setQuickNotesText] = useState('');
  const [updatingQuickNotes, setUpdatingQuickNotes] = useState(false);


  const [newLead, setNewLead] = useState({
    name: '',
    phone: '',
    email: '',
    postcode: '',
    status: 'New',
    image_url: ''
  });


  // Handle status filter from navigation
  useEffect(() => {
    if (location.state?.statusFilter) {
      setStatusFilter(location.state.statusFilter);
    }
    if (location.state?.searchTerm) {
      setSearchTerm(location.state.searchTerm);
    }
    // Clear the navigation state to prevent it from persisting
    if (location.state) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Clear upload status on component mount to prevent stuck modal
  useEffect(() => {
    setUploadStatus('');
    setUploadProgress(0);
    setUploadFile(null);
  }, []);

  // Emergency clear of upload status - press Escape to clear any stuck modals
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setUploadStatus('');
        setUploadProgress(0);
        setUploadFile(null);
        setShowUploadModal(false);
        setShowAddModal(false);
        setShowColumnMappingModal(false);
        setShowAnalysisModal(false);
        setShowQuickNotesModal(false);
        setShowAssignModal(false);
        setShowBulkAssignModal(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Clean up any undefined values in leads state
  useEffect(() => {
    const hasUndefinedLeads = leads.some(lead => !lead || !lead.id);
    if (hasUndefinedLeads) {
      console.warn('🧹 Cleaning up undefined leads from state');
      setLeads(prevLeads => (prevLeads || []).filter(lead => lead && lead.id));
    }
  }, [leads]);

  // Helper function to calculate date range in GMT/London timezone
  const getDateRange = useCallback(() => {
    // Get current time in London timezone - use proper Date object
    const now = new Date();
    
    // Get today's date string in London timezone (YYYY-MM-DD format)
    const todayLondonStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); // YYYY-MM-DD format
    
    // Create Date objects for calculations
    const todayMidnightLondon = new Date(todayLondonStr + 'T00:00:00.000Z');

    console.log('🕐 Current time:', now.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
    console.log('📅 Today (London midnight):', todayLondonStr, todayMidnightLondon.toISOString());

    switch (dateFilter) {
      case 'today':
        // Today: from midnight to midnight+24h in London time
        const startOfToday = todayLondonStr + 'T00:00:00.000Z';
        const startOfTomorrow = new Date(todayMidnightLondon.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] + 'T00:00:00.000Z';
        return {
          start: startOfToday,
          end: startOfTomorrow
        };
      case 'yesterday':
        // Yesterday: from yesterday midnight to today midnight in London time
        const yesterdayDate = new Date(todayMidnightLondon.getTime() - 24 * 60 * 60 * 1000);
        const startOfYesterday = yesterdayDate.toISOString().split('T')[0] + 'T00:00:00.000Z';
        return {
          start: startOfYesterday,
          end: todayLondonStr + 'T00:00:00.000Z'
        };
      case 'week':
        // Last 7 days: from 7 days ago midnight to now
        const weekAgo = new Date(todayMidnightLondon.getTime() - 7 * 24 * 60 * 60 * 1000);
        const startOfWeek = weekAgo.toISOString().split('T')[0] + 'T00:00:00.000Z';
        return {
          start: startOfWeek,
          end: new Date().toISOString() // Current moment
        };
      case 'month':
        // Last 30 days: from 30 days ago midnight to now
        const monthAgo = new Date(todayMidnightLondon.getTime() - 30 * 24 * 60 * 60 * 1000);
        const startOfMonth = monthAgo.toISOString().split('T')[0] + 'T00:00:00.000Z';
        return {
          start: startOfMonth,
          end: new Date().toISOString() // Current moment
        };
      case 'custom':
        if (customDateStart && customDateEnd) {
          // Custom range: use the dates as-is at midnight
          return {
            start: customDateStart + 'T00:00:00.000Z',
            end: customDateEnd + 'T23:59:59.999Z'
          };
        }
        return null;
      default:
        return null;
    }
  }, [dateFilter, customDateStart, customDateEnd]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      console.log('🔑 Using token for /api/leads:', token);
      console.log('🔍 Fetching leads with statusFilter:', statusFilter);

      // Build params object
      const params = {
        page: currentPage,
        limit: leadsPerPage,
        status: statusFilter,
        search: debouncedSearchTerm
      };

      // Add date filter if applicable
      const dateRange = getDateRange();
      if (dateRange) {
        // Use assigned_at for Assigned status, created_at for all others
        if (statusFilter === 'Assigned') {
          params.assigned_at_start = dateRange.start;
          params.assigned_at_end = dateRange.end;
          console.log('📅 Assigned date filter applied:', dateFilter, dateRange);
        } else {
          params.created_at_start = dateRange.start;
          params.created_at_end = dateRange.end;
          console.log('📅 Created date filter applied:', dateFilter, dateRange);
        }
      }

      const startTime = performance.now();
      const response = await axios.get('/api/leads', {
        params,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: 10000 // 10 second timeout
      });
      
      const endTime = performance.now();
      console.log(`⚡ Leads API response time: ${(endTime - startTime).toFixed(2)}ms`);
      
      console.log('📋 Fetched leads response:', response.data);
      console.log('📋 Total leads fetched:', response.data.leads?.length || 0);
      console.log('🔍 Status filter used:', statusFilter);
      
      // Debug image URLs
      if (response.data.leads && response.data.leads.length > 0) {
        console.log('🖼️ Sample lead image URLs:');
        response.data.leads.slice(0, 3).forEach(lead => {
          console.log(`  ${lead.name}: image_url = "${lead.image_url}"`);
        });
      }
      
      // Check for invalid lead IDs
      const invalidLeads = response.data.leads?.filter(lead => 
        !lead.id || typeof lead.id !== 'string'
      ) || [];
      
      if (invalidLeads.length > 0) {
        console.warn('⚠️ Found leads with invalid IDs:', invalidLeads);
      }
      
      // Filter out any undefined/null leads before setting state
      const validLeads = (response.data.leads || []).filter(lead => lead && lead.id);
      setLeads(validLeads);
      setTotalPages(response.data.totalPages || 1);
      setTotalLeads(response.data.total || 0);
      // Show warning if no leads and user is logged in
      if ((response.data.leads?.length === 0 || !response.data.leads) && user) {
        console.warn('⚠️ No leads returned from API, but user is logged in. This may indicate a token/auth issue.');
      }
    } catch (error) {
      console.error('Error fetching leads:', error);
      setLeads([]);
      // Show user-friendly error message
      if (error.code === 'ECONNABORTED') {
        console.error('⏰ Request timeout - server may be slow');
      } else if (error.response?.status === 500) {
        console.error('🔥 Server error - check server logs');
      }
    } finally {
      setLoading(false);
    }
  }, [currentPage, statusFilter, debouncedSearchTerm, dateFilter, customDateStart, customDateEnd, getDateRange, user, leadsPerPage]);

  const fetchLeadCounts = useCallback(async () => {
    try {
      // Build params for stats API with date filter if applicable
      const params = {};
      const dateRange = getDateRange();

      if (dateRange) {
        // Always use created_at for stats counters
        // (assigned_at is only used for the actual leads list when viewing Assigned status)
        params.created_at_start = dateRange.start;
        params.created_at_end = dateRange.end;
        console.log('📊 Fetching counts with date filter:', dateRange);
      }

      const response = await axios.get('/api/stats/leads', { params });
      console.log('📊 Fetched lead counts with date filter:', response.data);
      setLeadCounts(response.data);
    } catch (error) {
      console.error('❌ Error fetching lead counts:', error);
      // Set default values to indicate an error occurred
      setLeadCounts({
        total: 0,
        new: 0,
        booked: 0,
        attended: 0,
        cancelled: 0,
        assigned: 0,
        rejected: 0,
        error: true
      });
    }
  }, [dateFilter, customDateStart, customDateEnd, getDateRange]);

  // Fetch leads when filters or pagination change
  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Fetch lead counts on mount
  useEffect(() => {
    if (user) {
      fetchLeadCounts();
    }
  }, [user, fetchLeadCounts]);

  // Refetch lead counts when date filter changes
  useEffect(() => {
    if (user) {
      console.log('📅 Date filter changed, refetching counts...');
      fetchLeadCounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, customDateStart, customDateEnd]);

  // Reset to first page when date filter changes
  useEffect(() => {
    console.log('📅 Date filter changed, resetting to page 1...');
    setCurrentPage(1);
  }, [dateFilter, customDateStart, customDateEnd]);

  // Clear selected leads when leads change (due to filtering/pagination)
  useEffect(() => {
    setSelectedLeads([]);
  }, [statusFilter, searchTerm, currentPage]);

  // Enable virtual scrolling for large datasets
  useEffect(() => {
    setUseVirtualScrolling(totalLeads > 25); // Even more aggressive threshold for better performance
  }, [totalLeads]);

  // Helper function to check if lead should be included in current view
  const shouldIncludeLead = useCallback((lead) => {
    const matchesSearch = !searchTerm || 
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.phone.includes(searchTerm) ||
      lead.postcode.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'sales' ? lead.has_sale === 1 : lead.status === statusFilter);
    
    return matchesSearch && matchesStatus;
  }, [searchTerm, statusFilter]);

  // Memoize filtered leads for better performance
  const filteredLeads = useMemo(() => {
    return leads.filter(shouldIncludeLead);
  }, [leads, shouldIncludeLead]);


  // Debounce search term to reduce API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 200); // Reduced to 200ms for faster response

    return () => clearTimeout(timer);
  }, [searchTerm]);


  useEffect(() => {
    if (user?.role === 'admin') {
      fetchSalesTeam();
    }
  }, [user]);

  // Subscribe to real-time lead updates
  useEffect(() => {
    const unsubscribe = subscribeToLeadUpdates((update) => {
      console.log('📱 Leads: Real-time update received', update);
      
      switch (update.type) {
        case 'LEAD_CREATED':
          // Add new lead to the list if it matches current filters
          const newLead = update.data.lead;
          if (shouldIncludeLead(newLead)) {
            setLeads(prevLeads => [newLead, ...prevLeads]);
          }
          // Refresh counts whenever a lead is created
          fetchLeadCounts();
          break;
          
        case 'LEAD_UPDATED':
          // Update existing lead
          const updatedLead = update.data.lead;
          setLeads(prevLeads =>
            (prevLeads || [])
              .filter(lead => lead && lead.id) // Filter out undefined/null leads
              .map(lead =>
                lead.id === updatedLead.id ? updatedLead : lead
              ).filter(lead => shouldIncludeLead(lead))
          );
          // Refresh counts whenever a lead is updated
          fetchLeadCounts();
          break;
          
        case 'LEAD_ASSIGNED':
          // Update lead assignment
          const assignedLead = update.data.lead;
          setLeads(prevLeads =>
            (prevLeads || [])
              .filter(lead => lead && lead.id) // Filter out undefined/null leads
              .map(lead =>
                lead.id === assignedLead.id ? assignedLead : lead
              )
          );
          // Refresh counts whenever a lead is assigned
          fetchLeadCounts();
          break;
          
        case 'LEAD_DELETED':
          // Remove deleted lead
          const deletedLeadId = update.data.leadId;
          setLeads(prevLeads => 
            prevLeads.filter(lead => lead.id !== deletedLeadId)
          );
          // Refresh counts whenever a lead is deleted
          fetchLeadCounts();
          break;
          
        default:
          // For any other updates, refresh the list and counts
          fetchLeads();
          fetchLeadCounts();
      }
    });

    return unsubscribe;
  }, [subscribeToLeadUpdates, statusFilter, searchTerm, fetchLeadCounts]);


  const fetchSalesTeam = async () => {
    try {
      console.log('Fetching sales team...');
      const response = await axios.get('/api/users/bookers');
      console.log('Sales team response:', response.data);
      setSalesTeam(response.data);
    } catch (error) {
      console.error('Error fetching sales team:', error);
    }
  };

  const handleAssignLead = (lead, e) => {
    e.stopPropagation(); // Prevent row click
    setSelectedLead(lead);
    setSelectedBooker(lead.booker?._id || '');
    setShowAssignModal(true);
  };

  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`/api/leads/${selectedLead.id}/assign`, {
        bookerId: selectedBooker
      });
      setShowAssignModal(false);
      setSelectedLead(null);
      setSelectedBooker('');
      fetchLeads(); // Refresh the leads list
      fetchLeadCounts(); // Refresh the counts
    } catch (error) {
      console.error('Error assigning lead:', error);
      alert('Error assigning lead. Please try again.');
    }
  };

  const handleSelectLead = (leadId, isSelected) => {
    // Toggle lead selection when checkbox is clicked
    setSelectedLeads(prevSelected => {
      if (isSelected) {
        return [...prevSelected, leadId];
      } else {
        return prevSelected.filter(id => id !== leadId);
      }
    });
  };

  const handleSelectAll = (isSelected) => {
    if (isSelected) {
      // Get all valid lead IDs from the filtered lead list
      const allIds = leads
        .filter(shouldIncludeLead)
        .filter(lead => lead && lead.id)
        .map(lead => String(lead.id))
        .filter(id => id && id.length > 0); // Validate SQLite ID format
      
      console.log('✅ Selecting all valid leads:', allIds.length);
      setSelectedLeads(allIds);
    } else {
      console.log('✅ Clearing all selections');
      setSelectedLeads([]);
    }
  };
  
  const handleBulkDelete = async () => {
    if (selectedLeads.length === 0) {
      alert('Please select leads to delete');
      return;
    }

    // Log debugging information
    console.log('🔍 DELETE DEBUG - Selected leads:', selectedLeads);
    console.log('🔍 DELETE DEBUG - User role:', user?.role);
    
    // Convert any ObjectId objects to strings and validate format
    const leadIdsToDelete = selectedLeads
      .map(id => {
        // Handle various ID types and convert to string
        let idString = id;
        if (typeof id === 'object' && id !== null) {
          // If it's an ObjectId or has toString()
          idString = id.toString();
        }
        return idString;
      })
      .filter(id => id && id.length === 36); // Validate SQLite UUID format
    
    console.log('🗑️ Attempting to delete leads:', leadIdsToDelete);
    console.log('🔍 Number of leads selected:', selectedLeads.length);
    console.log('🔍 Number of valid IDs:', leadIdsToDelete.length);
    console.log('🔍 First few IDs:', leadIdsToDelete.slice(0, 5));

    if (leadIdsToDelete.length === 0) {
      alert('No valid lead IDs found. Please refresh the page and try again.');
      return;
    }

    if (leadIdsToDelete.length !== selectedLeads.length) {
      console.warn(`⚠️ ${selectedLeads.length - leadIdsToDelete.length} invalid IDs filtered out`);
    }

    if (user?.role !== 'admin') {
      alert('Only administrators can delete leads');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete ${leadIdsToDelete.length} lead${leadIdsToDelete.length === 1 ? '' : 's'}? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      console.log('🔍 DELETE DEBUG - Sending request with:', { leadIds: leadIdsToDelete });
      
      const token = localStorage.getItem('token');
      const response = await axios.delete('/api/leads/bulk', {
        data: { leadIds: leadIdsToDelete },
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      console.log('✅ Delete response:', response.data);
      alert(`Successfully deleted ${response.data.deletedCount || leadIdsToDelete.length} leads`);
      setSelectedLeads([]);
      fetchLeads(); // Refresh the leads list
      fetchLeadCounts(); // Also refresh counts
    } catch (error) {
      console.error('❌ Error deleting leads:', error);
      console.error('❌ Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      if (error.response?.data?.message) {
        alert(`Delete failed: ${error.response.data.message}`);
      } else {
        alert('Failed to delete leads. Please try again.');
      }
    }
  };

  const handleBulkAssign = () => {
    if (selectedLeads.length === 0) {
      alert('Please select leads to assign');
      return;
    }
    setShowBulkAssignModal(true);
  };

  const handleBulkAssignSubmit = async (e) => {
    e.preventDefault();
    try {
      // Assign leads one by one
      const promises = selectedLeads.map(leadId =>
        axios.put(`/api/leads/${leadId}/assign`, { booker: bulkAssignBooker })
      );
      await Promise.all(promises);
      
      setShowBulkAssignModal(false);
      setBulkAssignBooker('');
      setSelectedLeads([]);
      fetchLeads(); // Refresh the leads list
      fetchLeadCounts(); // Refresh the counts
    } catch (error) {
      console.error('Error bulk assigning leads:', error);
      alert('Error assigning leads. Please try again.');
    }
  };

  const handleAddLead = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/leads', newLead);
      setShowAddModal(false);
      setNewLead({
        name: '',
        phone: '',
        email: '',
        postcode: '',
        status: 'New',
        image_url: ''
      });
      fetchLeads();
      fetchLeadCounts();
    } catch (error) {
      console.error('Error adding lead:', error);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'new':
        return 'status-badge status-new';
      case 'booked':
        return 'status-badge status-booked';
      case 'attended':
        return 'status-badge status-attended';
      case 'cancelled':
        return 'status-badge status-cancelled';
      case 'assigned':
        return 'status-badge status-assigned';
      case 'reschedule':
        return 'status-badge status-reschedule';
      default:
        return 'status-badge status-new';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const handleRowClick = (lead, e) => {
    // Prevent navigation if clicking on checkbox
    if (e.target.type !== 'checkbox') {
      const filteredLeads = leads.filter(shouldIncludeLead);
      console.log('🔍 Leads: Navigating to lead detail with context:', {
        leadId: lead.id,
        leadName: lead.name,
        statusFilter,
        searchTerm,
        totalLeads: leads.length,
        filteredLeadsCount: filteredLeads.length
      });
      
      // Navigate to lead details page with filter context
      navigate(`/leads/${lead.id}`, {
        state: {
          statusFilter: statusFilter,
          searchTerm: searchTerm,
          filteredLeads: filteredLeads
        }
      });
    }
  };

  const handleBookLead = (lead, e) => {
    e.stopPropagation(); // Prevent row click
    // Store lead data in localStorage to pass to calendar
    localStorage.setItem('bookingLead', JSON.stringify({
              id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email || '',
      postcode: lead.postcode,
      notes: lead.notes || '',
      imageUrl: lead.imageUrl || '',
      status: lead.status // Include current status
    }));
    // Navigate to calendar
    navigate('/calendar');
  };

  const handleQuickEditNotes = (lead, e) => {
    e.stopPropagation();
    setQuickNotesLead(lead);
    setQuickNotesText(lead.notes || '');
    setShowQuickNotesModal(true);
  };

  const handleQuickNotesSave = async () => {
    if (!quickNotesLead) return;
    
    const currentNotes = quickNotesLead.notes || '';
    const newNotes = quickNotesText.trim();
    
    // Don't save if notes haven't changed
    if (currentNotes === newNotes) {
      setShowQuickNotesModal(false);
      return;
    }
    
    setUpdatingQuickNotes(true);
    try {
      const response = await axios.patch(`/api/leads/${quickNotesLead.id}/notes`, {
        notes: newNotes,
        oldNotes: currentNotes
      });
      
      // Update the lead in the list
      setLeads(prevLeads =>
        (prevLeads || [])
          .filter(lead => lead && lead.id) // Filter out undefined/null leads
          .map(lead =>
            lead.id === quickNotesLead.id
              ? { ...lead, notes: newNotes }
              : lead
          )
      );
      
      // Set refresh trigger for Calendar
      localStorage.setItem('calendarRefreshTrigger', 'true');
      
      setShowQuickNotesModal(false);
      
      // Show success message
      const changeType = currentNotes ? 'modified' : 'added';
      alert(`Notes ${changeType} successfully by ${response.data.updatedBy}!`);
      
    } catch (error) {
      console.error('Error updating notes:', error);
      alert('Failed to update notes. Please try again.');
    } finally {
      setUpdatingQuickNotes(false);
    }
  };

  const handleQuickNotesCancel = () => {
    setShowQuickNotesModal(false);
    setQuickNotesLead(null);
    setQuickNotesText('');
  };

  // Upload handlers
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const validTypes = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
      if (!validTypes.includes(file.type) && !file.name.endsWith('.csv')) {
        alert('Please select a CSV or Excel file');
        return;
      }
      setUploadFile(file);
      setUploadStatus('');
    }
  };

  const handleUploadSubmit = async () => {
    if (!uploadFile) {
      alert('Please select a file first');
      return;
    }

    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      setUploadStatus('Analyzing file...');
      setUploadProgress(10);

      const response = await axios.post('/api/leads/upload-analyze', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(progress);
        },
      });

      setUploadProgress(100);

      // Close upload modal and show column mapping modal
      setShowUploadModal(false);
      setUploadProgress(0);
      setUploadStatus('');
      
      // Check if this is a well-formatted file that can auto-proceed
      const suggestedMapping = response.data.suggestedMapping || {};
      const isWellFormatted = response.data.wellFormatted;
      
      setColumnMappingData(response.data);
      setColumnMapping(suggestedMapping);
      setMappingErrors([]);

      console.log('File analysis response:', response.data);
      
      // Auto-proceed if well-formatted
      if (isWellFormatted && suggestedMapping.name) {
        console.log('🚀 Well-formatted file detected, auto-proceeding to analysis...');
        setUploadStatus('Well-formatted file detected! Auto-processing...');
        
        // Proceed directly to processing
        setTimeout(async () => {
          try {
            setUploadStatus('Auto-processing leads...');
            setUploadProgress(0);
            
            // Simulate progress for auto-processing
            const progressInterval = setInterval(() => {
              setUploadProgress(prev => {
                if (prev >= 90) {
                  clearInterval(progressInterval);
                  return 90;
                }
                return prev + 15;
              });
            }, 300);

            const processResponse = await axios.post('/api/leads/upload-process', {
              tempId: response.data.tempId,
              columnMapping: suggestedMapping
            });

            clearInterval(progressInterval);
            setUploadProgress(100);

            // Show completion briefly
            setUploadStatus('Complete');
            setTimeout(() => {
              // Show analysis results
              setAnalysisData(processResponse.data.analysis);
              setProcessedLeads(processResponse.data.processedLeads);
              setShowAnalysisModal(true);
              
              // Reset upload state
              setUploadFile(null);
              setUploadStatus('');
              setColumnMappingData(null);
              setColumnMapping({});
            }, 1500);

            console.log('Auto-processing response:', processResponse.data);
          } catch (error) {
            console.error('Auto-processing error:', error);
            // Fall back to manual mapping
            setShowColumnMappingModal(true);
            setUploadStatus('');
          }
        }, 1000);
      } else {
        // Show manual mapping interface
        setShowColumnMappingModal(true);
        setUploadStatus('');
        
        // Log auto-detected mappings for debugging
        if (Object.keys(suggestedMapping).length > 0) {
          console.log('Auto-detected mappings:', suggestedMapping);
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      
      let errorMessage = 'Upload failed: ';
      const errorData = error.response?.data;
      
      if (errorData?.suggestions) {
        errorMessage = errorData.message + '\n\nSuggestions:\n• ' + errorData.suggestions.join('\n• ');
      } else {
        errorMessage += errorData?.message || error.message;
      }
      
      setUploadStatus(errorMessage);
      setUploadProgress(0);
      
      // Keep the file selected so user can try again
      // setUploadFile(null); // Don't clear the file
    }
  };

  // Column mapping handlers
  const handleColumnMappingSubmit = async () => {
    if (!columnMappingData) {
      alert('No file data available');
      return;
    }

    try {
      setUploadStatus('Processing leads with column mapping...');
      setUploadProgress(0);
      setShowColumnMappingModal(false);

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      const response = await axios.post('/api/leads/upload-process', {
        tempId: columnMappingData.tempId,
        columnMapping: columnMapping
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      // Show completion briefly
      setUploadStatus('Complete');
      setTimeout(() => {
        // Show analysis results
        setAnalysisData(response.data.analysis);
        setProcessedLeads(response.data.processedLeads);
        setShowAnalysisModal(true);
        
        // Reset upload state
        setUploadFile(null);
        setUploadStatus('');
        setColumnMappingData(null);
        setColumnMapping({});
      }, 1500);

      console.log('Processing response:', response.data);
    } catch (error) {
      console.error('Processing error:', error);
      
      // Show more helpful error messages
      let errorMessage = 'Processing failed: ';
      if (error.response?.data?.errors?.length > 0) {
        errorMessage += '\n\nIssues found:\n' + error.response.data.errors.slice(0, 3).join('\n');
      } else {
        errorMessage += error.response?.data?.message || error.message;
      }
      
      // Re-open column mapping modal with error
      setMappingErrors([errorMessage]);
      setShowColumnMappingModal(true);
      setUploadStatus('');
    }
  };

  const handleColumnMappingCancel = () => {
    setShowColumnMappingModal(false);
    setColumnMappingData(null);
    setColumnMapping({});
    setMappingErrors([]);
    setUploadFile(null);
    setUploadStatus('');
  };


  // Analysis handlers
  const handleAcceptAll = async () => {
    try {
      const response = await axios.post('/api/leads/bulk-create', {
        leads: processedLeads
      });
      
      setShowAnalysisModal(false);
      setAnalysisData(null);
      setProcessedLeads([]);
      fetchLeads();
      
      alert(`Successfully imported ${response.data.imported} leads`);
    } catch (error) {
      console.error('Error importing all leads:', error);
      alert('Error importing leads. Please try again.');
    }
  };

  const handleDiscardDuplicates = async () => {
    try {
      // Filter out duplicates
      const duplicateRows = analysisData.report
        .filter(item => item.duplicateOf)
        .map(item => item.row);
      
      const validLeads = processedLeads.filter((lead, index) => 
        !duplicateRows.includes(index + 1)
      );
      
      const response = await axios.post('/api/leads/bulk-create', {
        leads: validLeads
      });
      
      setShowAnalysisModal(false);
      setAnalysisData(null);
      setProcessedLeads([]);
      fetchLeads();
      
      alert(`Successfully imported ${response.data.imported} leads (${duplicateRows.length} duplicates discarded)`);
    } catch (error) {
      console.error('Error importing leads:', error);
      alert('Error importing leads. Please try again.');
    }
  };

  const handleSaveValidLeads = async () => {
    try {
      // Filter out both duplicates and far leads
      const invalidRows = analysisData.report
        .filter(item => item.duplicateOf || item.farFlag)
        .map(item => item.row);
      
      const validLeads = processedLeads.filter((lead, index) => 
        !invalidRows.includes(index + 1)
      );
      
      const response = await axios.post('/api/leads/bulk-create', {
        leads: validLeads
      });
      
      setShowAnalysisModal(false);
      setAnalysisData(null);
      setProcessedLeads([]);
      fetchLeads();
      
      alert(`Successfully imported ${response.data.imported} valid leads`);
    } catch (error) {
      console.error('Error importing valid leads:', error);
      alert('Error importing leads. Please try again.');
    }
  };

  const handleExportCSV = () => {
    // Create CSV content
    const headers = ['Row', 'Name', 'Phone', 'Postcode', 'Distance (miles)', 'Issue Type', 'Duplicate Of', 'Reason'];
    const rows = analysisData.report.map(item => [
      item.row,
      item.lead.name,
      item.lead.phone,
      item.lead.postcode,
      item.distanceMiles?.toFixed(1) || 'N/A',
      item.duplicateOf ? 'Duplicate' : item.farFlag ? 'Far' : '',
      item.duplicateOf || '',
      item.reason || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lead-analysis-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportSelectedLeads = () => {
    if (selectedLeads.length === 0) {
      alert('Please select leads to export');
      return;
    }

    // Get the selected lead objects
    const selectedLeadObjects = leads.filter(lead => selectedLeads.includes(lead.id));
    
    // Create CSV content for selected leads
    const headers = ['Name', 'Phone', 'Email', 'Postcode', 'Status', 'Notes', 'Booker', 'Date Booked', 'Image URL'];
    const rows = selectedLeadObjects.map(lead => [
      lead.name || '',
      lead.phone || '',
      lead.email || '',
      lead.postcode || '',
      lead.status || '',
      lead.notes || '',
      lead.booker?.name || '',
      lead.date_booked ? formatDate(lead.date_booked) : '',
      lead.image_url || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selected-leads-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        <div className="text-gray-600">Loading leads...</div>
        <div className="text-sm text-gray-500">This should only take a few seconds</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ pointerEvents: 'auto' }}>
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3">
            <h1 className="text-xl font-semibold text-gray-900">Leads</h1>
            <div className="flex items-center space-x-2">
              <FiWifi className={`h-4 w-4 ${isConnected ? 'text-green-500' : 'text-red-500'}`} />
              <span className={`text-xs px-2 py-1 rounded-full ${isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {isConnected ? 'Live' : 'Offline'}
              </span>
            </div>
          </div>
          {user?.role === 'admin' && selectedLeads.length > 0 && (
            <span className="text-sm text-gray-600">
              {selectedLeads.length} selected
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2" style={{ pointerEvents: 'auto' }}>
          {selectedLeads.length > 0 && (
            <>
              <div className="flex items-center space-x-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-md border border-blue-200">
                <span className="text-sm font-medium">
                  {selectedLeads.length} lead{selectedLeads.length === 1 ? '' : 's'} selected
                </span>
              </div>
              
              <button
                onClick={handleExportSelectedLeads}
                className="btn-secondary flex items-center space-x-2"
                title="Export selected leads to CSV"
              >
                <FiFileText className="h-4 w-4" />
                <span>Export Selected</span>
              </button>
              
              {user?.role === 'admin' ? (
                <>
                  <button
                    onClick={handleBulkAssign}
                    className="btn-secondary flex items-center space-x-2"
                  >
                    <FiUserPlus className="h-4 w-4" />
                    <span>Assign Selected</span>
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition-colors duration-200 flex items-center space-x-2"
                    title="Permanently delete selected leads"
                  >
                    <FiTrash2 className="h-4 w-4" />
                    <span>Delete Selected</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setSelectedLeads([])}
                  className="btn-secondary flex items-center space-x-2"
                >
                  <FiX className="h-4 w-4" />
                  <span>Clear Selection</span>
                </button>
              )}
            </>
          )}

          <button
            onClick={() => setShowUploadModal(true)}
            className="btn-secondary flex items-center space-x-2"
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <FiUpload className="h-4 w-4" />
            <span>Upload CSV</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center space-x-2"
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <FiPlus className="h-4 w-4" />
            <span>Add New Lead</span>
          </button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col gap-4">
        {/* Search and Status Filter Row */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
            <input
              type="text"
              placeholder="Search leads..."
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-md w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center space-x-2">
            <FiFilter className="h-5 w-5 text-gray-400" />
            <select
              className="border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[140px]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="New">🆕 New</option>
              <option value="Booked">📅 Booked</option>
              <option value="Attended">✅ Attended</option>
              <option value="Cancelled">❌ Cancelled</option>
              <option value="Assigned">👤 Assigned</option>
              <option value="sales">💰 Sales</option>
            </select>
          </div>
        </div>

        {/* Date Filter Row */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex items-center space-x-2">
            <FiCalendar className="h-5 w-5 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">
              {statusFilter === 'Assigned' ? 'Date Assigned:' : 'Date Added:'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setDateFilter('today')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                dateFilter === 'today'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDateFilter('yesterday')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                dateFilter === 'yesterday'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDateFilter('week')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                dateFilter === 'week'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => setDateFilter('month')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                dateFilter === 'month'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => setDateFilter('all')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                dateFilter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              All Time
            </button>
          </div>

          {/* Custom Date Range */}
          <div className="flex items-center space-x-2 ml-auto">
            <input
              type="date"
              value={customDateStart}
              onChange={(e) => {
                setCustomDateStart(e.target.value);
                if (e.target.value) setDateFilter('custom');
              }}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Start date"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={customDateEnd}
              onChange={(e) => {
                setCustomDateEnd(e.target.value);
                if (e.target.value) setDateFilter('custom');
              }}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="End date"
            />
            {(customDateStart || customDateEnd) && (
              <button
                onClick={() => {
                  setCustomDateStart('');
                  setCustomDateEnd('');
                  setDateFilter('all');
                }}
                className="text-gray-500 hover:text-gray-700 p-1"
                title="Clear custom dates"
              >
                <FiX className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
        <div 
          className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
            statusFilter === 'all' 
              ? 'border-blue-500 bg-blue-50' 
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          onClick={() => setStatusFilter('all')}
        >
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{leadCounts.total}</div>
            <div className="text-sm text-gray-600">All Leads</div>
          </div>
        </div>
        
        <div 
          className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
            statusFilter === 'New' 
              ? 'border-orange-500 bg-orange-50' 
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          onClick={() => setStatusFilter('New')}
        >
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">
              {leadCounts.new}
            </div>
            <div className="text-sm text-gray-600">🆕 New</div>
          </div>
        </div>
        
        <div 
          className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
            statusFilter === 'Booked' 
              ? 'border-blue-500 bg-blue-50' 
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          onClick={() => setStatusFilter('Booked')}
        >
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {leadCounts.booked}
            </div>
            <div className="text-sm text-gray-600">📅 Booked</div>
          </div>
        </div>
        
        <div 
          className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
            statusFilter === 'Attended' 
              ? 'border-green-500 bg-green-50' 
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          onClick={() => setStatusFilter('Attended')}
        >
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {leadCounts.attended}
            </div>
            <div className="text-sm text-gray-600">✅ Attended</div>
          </div>
        </div>
        
        <div 
          className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
            statusFilter === 'Cancelled' 
              ? 'border-red-500 bg-red-50' 
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          onClick={() => setStatusFilter('Cancelled')}
        >
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {leadCounts.cancelled}
            </div>
            <div className="text-sm text-gray-600">❌ Cancelled</div>
          </div>
        </div>
        
        <div 
          className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
            statusFilter === 'Assigned' 
              ? 'border-orange-500 bg-orange-50' 
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          onClick={() => setStatusFilter('Assigned')}
        >
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">
              {leadCounts.assigned}
            </div>
            <div className="text-sm text-gray-600">👤 Assigned</div>
          </div>
        </div>
        
        <div 
          className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
            statusFilter === 'Rejected' 
              ? 'border-red-500 bg-red-50' 
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          onClick={() => {
            console.log('🔄 Clicking rejected tab, current statusFilter:', statusFilter);
            setStatusFilter('Rejected');
            console.log('🔄 Set statusFilter to Rejected');
          }}
        >
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {leadCounts.rejected}
            </div>
            <div className="text-sm text-gray-600">Rejected</div>
          </div>
        </div>
      </div>

      {/* Performance indicator */}
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {leads.length} leads loaded
            {useVirtualScrolling && (
              <span className="ml-2 text-blue-600 font-medium">
                (Virtual scrolling enabled for better performance)
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">
            Page {currentPage} of {totalPages} • {totalLeads} total leads
          </div>
        </div>
      </div>

      {/* Leads Table - Use Virtual Scrolling for Large Lists */}
      {useVirtualScrolling ? (
        <VirtualLeadsList
          leads={filteredLeads}
          onLeadClick={handleRowClick}
          onSelectLead={handleSelectLead}
          selectedLeads={selectedLeads}
          statusFilter={statusFilter}
          getStatusBadgeClass={getStatusBadgeClass}
          formatDate={formatDate}
          height={600}
          itemHeight={60}
        />
      ) : (
        <div className="card">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="table-header">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <input
                    type="checkbox"
                    checked={selectedLeads.length === leads.filter(shouldIncludeLead).length && leads.filter(shouldIncludeLead).length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Photo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Phone
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Postcode
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                {statusFilter === 'Rejected' && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Rejection Reason
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Booker
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {statusFilter === 'Assigned' ? 'Date Assigned' : 'Date Added'}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date Booked
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {leads.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center space-y-2">
                      <div className="text-lg font-medium">No leads found</div>
                      <div className="text-sm">Try adjusting your filters or add a new lead</div>
                    </div>
                  </td>
                </tr>
              ) : (
                leads.filter(shouldIncludeLead).map((lead, index) => {
                  const LeadRow = React.memo(() => (
                  <tr
                    key={lead.id}
                    onClick={(e) => {
                      // Prevent checkbox click from triggering row click
                      if (e.target.type !== 'checkbox') {
                        handleRowClick(lead, e);
                      }
                    }}
                    className={`cursor-pointer hover:bg-gray-50 transition-colors duration-200 ${
                      selectedLeads.includes(lead.id) ? 'bg-blue-50 selected' : ''
                    }`}
                  >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedLeads.includes(lead.id)}
                      onChange={(e) => {
                        // Stop propagation to prevent row click
                        e.stopPropagation();
                        handleSelectLead(lead.id, e.target.checked);
                      }}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <LazyImage
                        src={getOptimizedImageUrl(lead.image_url, 'thumbnail') || ''}
                        alt={lead.name}
                        className="w-6 h-6 rounded-full object-cover border border-gray-200" // Ultra-small for maximum speed
                        fallbackClassName="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center border border-gray-200"
                        lazy={true} // Enable lazy loading for better performance
                        preload={false} // Don't preload all images
                      />
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {lead.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{lead.phone}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{lead.postcode}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={getStatusBadgeClass(lead.status)}>
                      {lead.status}
                    </span>
                  </td>
                  {statusFilter === 'Rejected' && (
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-red-600 font-medium">
                        {lead.reject_reason || 'No reason specified'}
                      </div>
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{lead.booker?.name || 'N/A'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500">
                      {statusFilter === 'Assigned' 
                        ? (lead.assigned_at ? formatDate(lead.assigned_at) : 'N/A')
                        : (lead.created_at ? formatDate(lead.created_at) : 'N/A')
                      }
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{lead.date_booked ? formatDate(lead.date_booked) : 'N/A'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={(e) => handleBookLead(lead, e)}
                        className="text-green-600 hover:text-green-900 p-1 rounded hover:bg-green-50"
                        title="Book Appointment"
                      >
                        <FiCalendar className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuickEditNotes(lead, e);
                        }}
                        className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                        title="Quick Edit Notes"
                      >
                        <FiFileText className="h-4 w-4" />
                      </button>
                      {user?.role === 'admin' && (
                        <button
                          onClick={(e) => handleAssignLead(lead, e)}
                          className="text-purple-600 hover:text-purple-900 p-1 rounded hover:bg-purple-50"
                          title="Assign Lead"
                        >
                          <FiUserPlus className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(lead, e);
                        }}
                        className="text-gray-600 hover:text-gray-900 p-1 rounded hover:bg-gray-50"
                        title="View Details"
                      >
                        <FiChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                  </tr>
                  ));
                  return <LeadRow />;
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Enhanced Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <span className="flex items-center text-sm text-gray-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing <span className="font-medium">{((currentPage - 1) * leadsPerPage) + 1}</span> to{' '}
                  <span className="font-medium">{Math.min(currentPage * leadsPerPage, totalLeads)}</span> of{' '}
                  <span className="font-medium">{totalLeads}</span> leads
                </p>
              </div>
              <div className="flex items-center space-x-2">
                {/* Previous Button */}
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← Previous
                </button>
                
                {/* Page Numbers */}
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  {/* First page */}
                  {currentPage > 3 && (
                    <>
                      <button
                        onClick={() => setCurrentPage(1)}
                        className="relative inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-l-md bg-white text-gray-500 hover:bg-gray-50"
                      >
                        1
                      </button>
                      {currentPage > 4 && (
                        <span className="relative inline-flex items-center px-3 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                          ...
                        </span>
                      )}
                    </>
                  )}
                  
                  {/* Current page and surrounding pages */}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pageNum = Math.max(1, Math.min(totalPages, currentPage - 2 + i));
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`relative inline-flex items-center px-3 py-2 border text-sm font-medium ${
                          currentPage === pageNum
                            ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                            : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  
                  {/* Last page */}
                  {currentPage < totalPages - 2 && (
                    <>
                      {currentPage < totalPages - 3 && (
                        <span className="relative inline-flex items-center px-3 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                          ...
                        </span>
                      )}
                      <button
                        onClick={() => setCurrentPage(totalPages)}
                        className="relative inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-r-md bg-white text-gray-500 hover:bg-gray-50"
                      >
                        {totalPages}
                      </button>
                    </>
                  )}
                </nav>
                
                {/* Next Button */}
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      )}

      {/* Add Lead Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50" style={{ pointerEvents: 'auto' }}>
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Add New Lead</h3>
              <form onSubmit={handleAddLead} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newLead.name}
                    onChange={(e) => setNewLead({ ...newLead, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newLead.phone}
                    onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newLead.email}
                    onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Postcode
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newLead.postcode}
                    onChange={(e) => setNewLead({ ...newLead, postcode: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newLead.status}
                    onChange={(e) => setNewLead({ ...newLead, status: e.target.value })}
                  >
                    <option value="New">New</option>
                    <option value="Booked">Booked</option>
                    <option value="Attended">Attended</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Image URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://example.com/image.jpg"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newLead.image_url}
                    onChange={(e) => setNewLead({ ...newLead, image_url: e.target.value })}
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    Add Lead
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Assign Lead Modal */}
      {showAssignModal && selectedLead && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Assign Lead: {selectedLead.name}
              </h3>
              <form onSubmit={handleAssignSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Current Assignment
                  </label>
                  <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                    {selectedLead.booker?.name || 'Unassigned'}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Assign to Sales Team Member
                  </label>
                  <select
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={selectedBooker}
                    onChange={(e) => setSelectedBooker(e.target.value)}
                  >
                    <option value="">Select a team member...</option>
                    {salesTeam.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} ({member.leads_assigned || 0} leads assigned)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAssignModal(false);
                      setSelectedLead(null);
                      setSelectedBooker('');
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    Assign Lead
                  </button>
                </div>
              </form>
            </div>
                     </div>
         </div>
       )}

      {/* Bulk Assign Modal */}
      {showBulkAssignModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Bulk Assign {selectedLeads.length} Leads
              </h3>
              <form onSubmit={handleBulkAssignSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Assign to Sales Team Member
                  </label>
                  <select
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={bulkAssignBooker}
                    onChange={(e) => setBulkAssignBooker(e.target.value)}
                  >
                    <option value="">Select a team member...</option>
                    {salesTeam.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} ({member.leads_assigned || 0} leads assigned)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <p className="text-sm text-gray-600">
                    This will assign {selectedLeads.length} selected leads to the chosen team member.
                  </p>
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowBulkAssignModal(false);
                      setBulkAssignBooker('');
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    Assign {selectedLeads.length} Leads
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50" style={{ pointerEvents: 'auto' }}>
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Upload Leads</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select CSV or Excel file
                  </label>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileUpload}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {uploadFile && (
                    <p className="text-sm text-gray-600 mt-1">
                      Selected: {uploadFile.name}
                    </p>
                  )}
                </div>

                <div className="bg-blue-50 p-3 rounded-md">
                  <h4 className="text-sm font-medium text-blue-900 mb-2">Smart Upload Features:</h4>
                  <div className="text-xs text-blue-800">
                    <p>🚀 <strong>Auto-processing:</strong> Well-labeled files go straight to analysis</p>
                    <p>🎯 <strong>Smart mapping:</strong> Columns auto-detected based on names</p>
                    <p>🚫 <strong>Skip unwanted:</strong> Empty columns auto-skipped, others can be skipped manually</p>
                    <p className="mt-2 text-green-700">
                      ✅ <strong>Any format works!</strong> Upload and we'll help you map the columns.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadFile(null);
                      setUploadProgress(0);
                      setUploadStatus('');
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleUploadSubmit}
                    disabled={!uploadFile || uploadStatus === 'Uploading...'}
                    className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadStatus === 'Uploading...' ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Beautiful Loading Modal */}
      {uploadStatus && uploadStatus.trim() !== '' && (uploadStatus.includes('Analyzing') || uploadStatus.includes('Processing') || uploadStatus.includes('Uploading') || uploadStatus.includes('Auto-processing') || uploadStatus.includes('Complete')) && (
        <div className="fixed inset-0 bg-black bg-opacity-75 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative mx-auto p-8 border w-96 shadow-2xl rounded-2xl bg-white transform transition-all duration-300">
            <div className="text-center">
              {/* Animated Icon */}
              <div className="mb-6">
                {uploadStatus.includes('Complete') ? (
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-green-500 to-emerald-600 rounded-full">
                    <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full animate-pulse">
                    <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}
              </div>

              {/* Status Text */}
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {uploadStatus.includes('Complete') ? 'Upload Complete!' :
                 uploadStatus.includes('Analyzing') ? 'Analyzing File' : 
                 uploadStatus.includes('Processing') ? 'Processing Leads' :
                 uploadStatus.includes('Auto-processing') ? 'Auto-Processing' : 'Uploading File'}
              </h3>
              
              <p className="text-gray-600 mb-6">
                {uploadStatus.includes('Complete') ? 'Your leads have been successfully processed and are ready for review.' :
                 uploadStatus.includes('Analyzing') ? 'Detecting columns and mapping data...' :
                 uploadStatus.includes('Processing') ? 'Importing leads and checking for duplicates...' :
                 uploadStatus.includes('Auto-processing') ? 'Smart processing in progress...' : 'Please wait while we upload your file...'}
              </p>

              {/* Progress Bar */}
              <div className="mb-6">
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div 
                    className="h-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full transition-all duration-500 ease-out shadow-lg"
                    style={{ 
                      width: `${uploadProgress}%`,
                      backgroundSize: '200% 100%',
                      animation: uploadProgress > 0 ? 'shimmer 2s ease-in-out infinite' : 'none'
                    }}
                  ></div>
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-2">
                  <span>Progress</span>
                  <span>{uploadProgress}%</span>
                </div>
              </div>

              {/* Animated Steps */}
              <div className="space-y-2">
                {uploadStatus.includes('Analyzing') && (
                  <>
                    <div className="flex items-center text-sm text-gray-600">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3 animate-pulse"></div>
                      <span>Reading file structure</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mr-3 animate-pulse"></div>
                      <span>Detecting column types</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <div className="w-2 h-2 bg-purple-500 rounded-full mr-3 animate-pulse"></div>
                      <span>Mapping data fields</span>
                    </div>
                  </>
                )}
                
                {uploadStatus.includes('Processing') && (
                  <>
                    <div className="flex items-center text-sm text-gray-600">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3 animate-pulse"></div>
                      <span>Validating lead data</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mr-3 animate-pulse"></div>
                      <span>Checking for duplicates</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <div className="w-2 h-2 bg-purple-500 rounded-full mr-3 animate-pulse"></div>
                      <span>Preparing import results</span>
                    </div>
                  </>
                )}

                {uploadStatus.includes('Auto-processing') && (
                  <>
                    <div className="flex items-center text-sm text-gray-600">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3 animate-pulse"></div>
                      <span>Smart column detection</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mr-3 animate-pulse"></div>
                      <span>Auto-mapping fields</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <div className="w-2 h-2 bg-purple-500 rounded-full mr-3 animate-pulse"></div>
                      <span>Processing leads</span>
                    </div>
                  </>
                )}
              </div>

              {/* Cancel Button */}
              <button
                onClick={() => {
                  setUploadStatus('');
                  setUploadProgress(0);
                  setUploadFile(null);
                }}
                className="mt-6 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Column Mapping Modal */}
      {showColumnMappingModal && columnMappingData && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-10 mx-auto p-6 border w-full max-w-6xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-xl font-medium text-gray-900 mb-6">
                Import Leads - Map Your Columns
              </h3>
              
              {/* Status Bar */}
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-gray-600">
                    {columnMappingData.fileName} • {columnMappingData.totalRows} rows • {columnMappingData.columns.length} columns with data
                  </span>
                  {columnMappingData.skippedEmptyColumns > 0 && (
                    <span className="text-sm text-yellow-600">
                      ⚠️ {columnMappingData.skippedEmptyColumns} empty columns auto-skipped
                    </span>
                  )}
                  {Object.keys(columnMapping).filter(k => columnMapping[k] !== 'skip').length > 0 && (
                    <span className="text-sm text-green-600">
                      ✅ {Object.keys(columnMapping).filter(k => columnMapping[k] !== 'skip').length} fields mapped
                    </span>
                  )}
                </div>
                
                {/* Show errors inline */}
                {mappingErrors.length > 0 && (
                  <span className="text-sm text-red-600">
                    ❌ {mappingErrors[0]}
                  </span>
                )}
              </div>

              {/* Column Mapping Table */}
              <div className="bg-gray-50 rounded-lg p-1">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white">
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 w-1/4">Your Field Titles</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 w-2/4">Preview</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 w-1/4">Lead Fields</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {columnMappingData.columns.map((column, index) => {
                      const stats = columnMappingData.columnStats?.[column];
                      const hasData = stats?.hasData !== false;
                      const sampleValues = stats?.sampleValues || [];
                      const previewText = sampleValues.slice(0, 3).join(', ') || 'No data';
                      
                      // Find which field this column is mapped to
                      const mappedField = Object.entries(columnMapping).find(([field, col]) => col === column)?.[0];
                      // Check if this was auto-detected
                      const wasAutoDetected = columnMappingData.suggestedMapping?.[mappedField] === column;
                      
                      return (
                        <tr key={column} className={`transition-colors ${hasData ? 'bg-white hover:bg-gray-50' : 'bg-gray-100'}`}>
                          {/* Column Name */}
                          <td className="px-4 py-3">
                            <div className="flex items-center">
                              <span className={`text-sm ${hasData ? 'text-gray-900' : 'text-gray-500'}`}>
                                {column}
                              </span>
                              {!hasData && (
                                <span className="ml-2 text-xs text-gray-400">(empty)</span>
                              )}
                              {wasAutoDetected && mappedField && (
                                <span className="ml-2 text-xs text-green-600" title="Auto-detected">✓</span>
                              )}
                            </div>
                          </td>
                          
                          {/* Preview Data */}
                          <td className="px-4 py-3">
                            <div className="text-sm text-gray-600 truncate max-w-md" title={previewText}>
                              {previewText}
                            </div>
                          </td>
                          
                          {/* Mapping Dropdown */}
                          <td className="px-4 py-3">
                            <select
                              className={`w-full px-3 py-2 text-sm border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                                mappedField === 'skip' ? 'border-gray-400 bg-gray-100 text-gray-600' :
                                mappedField ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-white'
                              }`}
                              value={mappedField || ''}
                              onChange={(e) => {
                                // Remove any existing mapping for this field
                                const newMapping = { ...columnMapping };
                                Object.keys(newMapping).forEach(field => {
                                  if (newMapping[field] === column) {
                                    delete newMapping[field];
                                  }
                                });
                                // Add new mapping if selected
                                if (e.target.value) {
                                  newMapping[e.target.value] = column;
                                }
                                setColumnMapping(newMapping);
                              }}
                              disabled={!hasData}
                            >
                              <option value="">-- Select --</option>
                              <option value="skip" className="text-gray-600">🚫 Skip this column</option>
                              <optgroup label="Required Fields">
                                <option value="name">Name *</option>
                              </optgroup>
                              <optgroup label="Contact Information">
                                <option value="phone">Phone</option>
                                <option value="email">Email</option>
                                <option value="parentPhone">Parent Phone</option>
                              </optgroup>
                              <optgroup label="Additional Fields">
                                <option value="age">Age</option>
                                <option value="postcode">Postcode</option>
                                <option value="imageUrl">Image URL</option>
                              </optgroup>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bottom Section */}
              <div className="mt-6 flex items-center justify-between">
                {/* Tips based on mapping state */}
                <div className="flex-1">
                  {!columnMapping.name && !columnMapping.phone && (
                    <p className="text-sm text-red-600">
                      ❗ You must map at least the Name column to proceed
                    </p>
                  )}
                  {columnMapping.name && !columnMapping.phone && columnMapping.name !== 'skip' && (
                    <p className="text-sm text-amber-600">
                      💡 Consider mapping phone for better duplicate detection
                    </p>
                  )}
                  {Object.keys(columnMapping).filter(k => columnMapping[k] !== 'skip' && columnMapping[k]).length >= 3 && (
                    <p className="text-sm text-green-600">
                      ✅ Great! You've mapped {Object.keys(columnMapping).filter(k => columnMapping[k] !== 'skip' && columnMapping[k]).length} fields
                    </p>
                  )}
                  {Object.values(columnMapping).filter(v => v === 'skip').length > 0 && (
                    <p className="text-sm text-gray-600">
                      🚫 {Object.values(columnMapping).filter(v => v === 'skip').length} columns will be skipped
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={handleColumnMappingCancel}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleColumnMappingSubmit}
                    disabled={(!columnMapping.name || columnMapping.name === 'skip') && (!columnMapping.phone || columnMapping.phone === 'skip')}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Process {columnMappingData.totalRows} Leads
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Modal */}
      {showAnalysisModal && (
        <LeadAnalysisModal
          isOpen={showAnalysisModal}
          onClose={() => setShowAnalysisModal(false)}
          onAcceptAll={handleAcceptAll}
          onDiscardDuplicates={handleDiscardDuplicates}
          onSaveValidLeads={handleSaveValidLeads}
          onExportCSV={handleExportCSV}
          report={analysisData?.report}
          distanceStats={analysisData?.distanceStats}
          processedLeads={processedLeads}
        />
      )}

      {/* Quick Notes Modal */}
      {showQuickNotesModal && quickNotesLead && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Quick Edit Notes: {quickNotesLead.name}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes
                  </label>
                  <div className="relative">
                    <textarea
                      value={quickNotesText}
                      onChange={(e) => setQuickNotesText(e.target.value)}
                      rows="6"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="Add detailed notes about this lead..."
                      autoFocus
                    />
                    <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                      {quickNotesText.length} characters
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    All users can edit notes • Changes appear in booking history
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={handleQuickNotesCancel}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleQuickNotesSave}
                  disabled={updatingQuickNotes}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center space-x-1"
                >
                  {updatingQuickNotes ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <FiCheck className="h-3 w-3" />
                      <span>Save Notes</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Leads; 

