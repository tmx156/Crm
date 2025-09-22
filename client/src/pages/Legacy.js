import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { FiArchive, FiSearch, FiDownload, FiUpload, FiEye, FiBarChart, FiDatabase, FiUsers, FiImage, FiMail, FiPhone } from 'react-icons/fi';

const Legacy = () => {
  const { user } = useAuth();
  const [legacyLeads, setLegacyLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLeads, setSelectedLeads] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [searchType, setSearchType] = useState('all');
  const [showStats, setShowStats] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    fetchLegacyStats();
    fetchLegacyLeads();
  }, [currentPage]);

  // Debounced search effect
  useEffect(() => {
    if (searchTerm.trim()) {
      const timeoutId = setTimeout(() => {
        setSearchLoading(true);
        fetchLegacyLeads();
      }, 500); // 500ms delay

      return () => clearTimeout(timeoutId);
    }
  }, [searchTerm]);

  const fetchLegacyStats = async () => {
    try {
      const response = await axios.get('/api/legacy/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching legacy stats:', error);
    }
  };

  const fetchLegacyLeads = async () => {
    try {
      setLoading(true);
      setError('');
      let url = `/api/legacy/leads?page=${currentPage}&limit=50`;

      if (searchTerm.trim()) {
        url += `&search=${encodeURIComponent(searchTerm.trim())}`;
      }

      console.log('🔍 Fetching legacy leads:', url);
      const response = await axios.get(url);
      setLegacyLeads(response.data.leads || []);
      setPagination(response.data.pagination);
      console.log('✅ Legacy leads fetched:', response.data.leads?.length || 0);
    } catch (error) {
      console.error('❌ Error fetching legacy leads:', error);
      setError('Failed to fetch legacy data: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
      setSearchLoading(false);
    }
  };

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1); // Reset to first page when searching
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchLegacyLeads();
  };

  const handleExport = async () => {
    try {
      const response = await axios.get('/api/legacy/export', {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'legacy-leads-export.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Export error:', error);
      alert('Export failed');
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
    if (selectedLeads.length === legacyLeads.length) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(legacyLeads.map(lead => lead.id));
    }
  };

  const handleMigrateSelected = async () => {
    if (selectedLeads.length === 0) {
      alert('Please select leads to migrate');
      return;
    }

    if (!window.confirm(`Are you sure you want to migrate ${selectedLeads.length} leads to current data?`)) {
      return;
    }

    try {
      // This would be implemented in the backend
      alert('Migration feature coming soon!');
    } catch (error) {
      console.error('Migration error:', error);
      alert('Migration failed');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusColor = (status) => {
    const colors = {
      'New': 'bg-blue-100 text-blue-800',
      'Booked': 'bg-green-100 text-green-800',
      'Attended': 'bg-purple-100 text-purple-800',
      'Cancelled': 'bg-red-100 text-red-800',
      'Assigned': 'bg-yellow-100 text-yellow-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <FiArchive className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">Access Denied</h3>
            <p className="mt-1 text-sm text-gray-500">
              Only administrators can access legacy data.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Legacy Data Management</h1>
              <p className="mt-2 text-gray-600">
                View and manage legacy leads imported from CSV data
              </p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowStats(!showStats)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                <FiBarChart className="mr-2 h-4 w-4" />
                {showStats ? 'Hide' : 'Show'} Stats
              </button>
              <button
                onClick={handleExport}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
              >
                <FiDownload className="mr-2 h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>
        </div>

        {/* Stats Dashboard */}
        {showStats && stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiDatabase className="h-6 w-6 text-blue-500" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Leads</dt>
                      <dd className="text-lg font-medium text-gray-900">{stats.total_leads?.toLocaleString() || 0}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiMail className="h-6 w-6 text-green-500" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Valid Emails</dt>
                      <dd className="text-lg font-medium text-gray-900">{stats.data_completeness?.has_email || 0}%</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiPhone className="h-6 w-6 text-purple-500" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Valid Phones</dt>
                      <dd className="text-lg font-medium text-gray-900">{stats.data_completeness?.has_phone || 0}%</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiImage className="h-6 w-6 text-orange-500" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">With Images</dt>
                      <dd className="text-lg font-medium text-gray-900">{stats.data_completeness?.has_image || 0}%</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quality Score Distribution */}
        {showStats && stats && (
          <div className="bg-white shadow rounded-lg mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Data Quality Distribution</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{stats.quality_score_distribution?.excellent || 0}</div>
                  <div className="text-sm text-gray-500">Excellent (90-100)</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{stats.quality_score_distribution?.good || 0}</div>
                  <div className="text-sm text-gray-500">Good (70-89)</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{stats.quality_score_distribution?.fair || 0}</div>
                  <div className="text-sm text-gray-500">Fair (50-69)</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{stats.quality_score_distribution?.poor || 0}</div>
                  <div className="text-sm text-gray-500">Poor (0-49)</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search and Filters */}
        <div className="bg-white shadow rounded-lg mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <form onSubmit={handleSearchSubmit} className="flex items-center justify-between">
              <div className="flex-1 max-w-lg">
                <label htmlFor="search" className="sr-only">Search legacy leads</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiSearch className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="search"
                    name="search"
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Search names, emails, phones..."
                    type="search"
                    value={searchTerm}
                    onChange={handleSearch}
                    disabled={searchLoading}
                  />
                </div>
              </div>
              <div className="ml-4 flex items-center space-x-4">
                <button
                  type="submit"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={searchLoading}
                >
                  {searchLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Searching...
                    </>
                  ) : (
                    'Search'
                  )}
                </button>
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setCurrentPage(1);
                      fetchLegacyLeads();
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Search Results Info */}
        {searchTerm && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
            <div className="flex items-center">
              <FiSearch className="h-5 w-5 text-blue-500 mr-2" />
              <span className="text-sm text-blue-700">
                {searchLoading ? 'Searching...' : `Search results for "${searchTerm}"`}
              </span>
              {!searchLoading && pagination && (
                <span className="ml-2 text-sm text-blue-600">
                  ({pagination.total_records} found)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Legacy Leads Table */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
              <p className="mt-4 text-gray-500">Loading legacy data...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-500">{error}</p>
              <button
                onClick={() => {
                  setCurrentPage(1);
                  fetchLegacyLeads();
                }}
                className="mt-4 text-blue-600 hover:text-blue-500"
              >
                Try Again
              </button>
            </div>
          ) : (
            <>
              {/* Table Header */}
              <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="col-span-3">Name</div>
                  <div className="col-span-3">Contact</div>
                  <div className="col-span-2">Location</div>
                  <div className="col-span-1">Age</div>
                  <div className="col-span-2">Quality</div>
                  <div className="col-span-1">Image</div>
                </div>
              </div>

              {/* Table Body */}
              <ul className="divide-y divide-gray-200">
                {legacyLeads.length === 0 ? (
                  <li className="px-6 py-12 text-center">
                    <FiArchive className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">
                      {searchTerm ? 'No results found' : 'No legacy leads found'}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {searchTerm ? (
                        <>
                          No legacy leads match "{searchTerm}". Try:
                          <br />
                          • Different spelling or keywords
                          <br />
                          • Searching by email, phone, or postcode
                          <br />
                          • Clearing the search to see all leads
                        </>
                      ) : (
                        'No legacy data has been imported yet.'
                      )}
                    </p>
                    {searchTerm && (
                      <button
                        onClick={() => {
                          setSearchTerm('');
                          setCurrentPage(1);
                          fetchLegacyLeads();
                        }}
                        className="mt-4 text-blue-600 hover:text-blue-500 text-sm"
                      >
                        Clear search
                      </button>
                    )}
                  </li>
                ) : (
                  legacyLeads.map((lead) => (
                    <li key={lead.id} className="px-6 py-4 hover:bg-gray-50">
                      <div className="grid grid-cols-12 gap-4 items-center">
                        {/* Name */}
                        <div className="col-span-3">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {lead.name || <span className="text-gray-400 italic">No name</span>}
                          </div>
                          <div className="text-xs text-gray-500">
                            Imported: {formatDate(lead.import_timestamp)}
                          </div>
                        </div>

                        {/* Contact */}
                        <div className="col-span-3">
                          <div className="text-sm text-gray-900">
                            {lead.email && (
                              <div className="flex items-center">
                                <FiMail className="h-3 w-3 mr-1 text-gray-400" />
                                <span className="truncate">{lead.email}</span>
                              </div>
                            )}
                            {lead.phone && (
                              <div className="flex items-center mt-1">
                                <FiPhone className="h-3 w-3 mr-1 text-gray-400" />
                                <span className="truncate">{lead.phone}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Location */}
                        <div className="col-span-2">
                          <div className="text-sm text-gray-900 truncate">
                            {lead.postcode || <span className="text-gray-400">No postcode</span>}
                          </div>
                        </div>

                        {/* Age */}
                        <div className="col-span-1">
                          <div className="text-sm text-gray-900">
                            {lead.age || <span className="text-gray-400">-</span>}
                          </div>
                        </div>

                        {/* Quality Score */}
                        <div className="col-span-2">
                          <div className="flex items-center">
                            <div className={`text-xs font-medium px-2 py-1 rounded-full ${
                              lead.data_quality_score >= 90 ? 'bg-green-100 text-green-800' :
                              lead.data_quality_score >= 70 ? 'bg-blue-100 text-blue-800' :
                              lead.data_quality_score >= 50 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {lead.data_quality_score || 0}/100
                            </div>
                          </div>
                        </div>

                        {/* Image */}
                        <div className="col-span-1">
                          {lead.image_url ? (
                            <div className="flex items-center">
                              <FiImage className="h-4 w-4 text-green-500" />
                              <span className="ml-1 text-xs text-green-600">Yes</span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">No</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))
                )}
              </ul>

              {/* Pagination */}
              {pagination && pagination.total_pages > 1 && (
                <div className="bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-700">
                      Showing {((pagination.current_page - 1) * pagination.records_per_page) + 1} to{' '}
                      {Math.min(pagination.current_page * pagination.records_per_page, pagination.total_records)} of{' '}
                      {pagination.total_records} results
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={!pagination.has_prev}
                        className="relative inline-flex items-center px-2 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>

                      {/* Page numbers */}
                      {Array.from({ length: Math.min(5, pagination.total_pages) }, (_, i) => {
                        const pageNum = Math.max(1, Math.min(pagination.total_pages - 4, pagination.current_page - 2)) + i;
                        if (pageNum > pagination.total_pages) return null;

                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`relative inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                              pageNum === pagination.current_page
                                ? 'text-blue-600 bg-blue-50 border-blue-500'
                                : 'text-gray-500 bg-white border-gray-300 hover:bg-gray-50'
                            } border`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}

                      <button
                        onClick={() => setCurrentPage(prev => Math.min(pagination.total_pages, prev + 1))}
                        disabled={!pagination.has_next}
                        className="relative inline-flex items-center px-2 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Legacy; 