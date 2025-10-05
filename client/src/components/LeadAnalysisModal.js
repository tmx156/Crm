import React, { useState, useMemo } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { MapPinIcon, PhoneIcon, UserIcon, ExclamationTriangleIcon, EnvelopeIcon } from '@heroicons/react/24/solid';

const LeadAnalysisModal = ({ isOpen, onClose, report, distanceStats, processedLeads, onAcceptAll, onDiscardDuplicates, onExportCSV, onSaveValidLeads, isImporting }) => {
  const [activeTab, setActiveTab] = useState('duplicates');

  // Filter report data based on active tab
  const filteredData = useMemo(() => {
    if (!report) return [];
    
    switch (activeTab) {
      case 'duplicates':
        return report.filter(item => item.duplicateOf);
      case 'far':
        return report.filter(item => item.farFlag);
      case 'all':
        return report;
      default:
        return [];
    }
  }, [report, activeTab]);

  // Count duplicates and far leads
  const duplicateCount = report?.filter(item => item.duplicateOf)?.length || 0;
  const listDuplicateCount = report?.filter(item => item.duplicateType === 'list')?.length || 0;
  const existingDuplicateCount = report?.filter(item => item.duplicateType === 'existing')?.length || 0;
  const legacyDuplicateCount = report?.filter(item => item.duplicateType === 'legacy')?.length || 0;
  const farCount = report?.filter(item => item.farFlag)?.length || 0;

  if (!isOpen) return null;

  const formatDistance = (miles) => {
    if (!miles && miles !== 0) return 'N/A';
    return `${miles.toFixed(1)} mi`;
  };

  const getDuplicateLabel = (duplicateOf, duplicateType) => {
    if (!duplicateOf) return null;
    if (duplicateOf.startsWith('row-')) {
      return `Row ${duplicateOf.replace('row-', '')} (List Duplicate)`;
    }
    if (duplicateType === 'legacy') {
      return `Legacy Lead`;
    }
    return `Existing Lead`;
  };

  const getReasonBadge = (reason) => {
    if (!reason) return null;
    
    const badges = {
      phone: 'bg-blue-100 text-blue-800',
      email: 'bg-green-100 text-green-800',
      phone_and_email: 'bg-red-100 text-red-800'
    };

    const labels = {
      phone: 'Phone',
      email: 'Email',
      phone_and_email: 'Phone & Email'
    };

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${badges[reason] || 'bg-gray-100 text-gray-800'}`}>
        {labels[reason] || reason.charAt(0).toUpperCase() + reason.slice(1)}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-6xl shadow-lg rounded-lg bg-white">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-2xl font-bold text-gray-900">Lead Analysis Report</h3>
            <p className="text-sm text-gray-600 mt-1">
              {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''} ({listDuplicateCount} list, {existingDuplicateCount} existing, {legacyDuplicateCount} legacy), {farCount} far lead{farCount !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('duplicates')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'duplicates'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Duplicates ({duplicateCount})
            </button>
            <button
              onClick={() => setActiveTab('far')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'far'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Far (&gt;150 mi) ({farCount})
            </button>
            <button
              onClick={() => setActiveTab('all')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'all'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              All Findings ({report?.length || 0})
            </button>
          </nav>
        </div>

        {/* Table */}
        <div className="overflow-x-auto mb-6">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Row
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Phone
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Postcode
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Distance
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Issues
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-4 text-center text-gray-500">
                    No issues found in this category
                  </td>
                </tr>
              ) : (
                filteredData.map((item, index) => (
                  <tr key={index} className={item.duplicateOf ? 'bg-red-50' : item.farFlag ? 'bg-yellow-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {item.row}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex items-center">
                        <UserIcon className="h-4 w-4 text-gray-400 mr-2" />
                        {item.lead.name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex items-center">
                        <PhoneIcon className="h-4 w-4 text-gray-400 mr-2" />
                        {item.lead.phone}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex items-center">
                        <EnvelopeIcon className="h-4 w-4 text-gray-400 mr-2" />
                        {item.lead.email}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex items-center">
                        <MapPinIcon className="h-4 w-4 text-gray-400 mr-2" />
                        {item.lead.postcode}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDistance(item.distanceMiles)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center space-x-2">
                        {item.duplicateOf && (
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              item.duplicateType === 'list' ? 'bg-orange-100 text-orange-800' :
                              item.duplicateType === 'legacy' ? 'bg-purple-100 text-purple-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {item.duplicateType === 'list' ? 'List Duplicate' :
                               item.duplicateType === 'legacy' ? 'Legacy Lead' :
                               'Existing Lead Duplicate'}
                            </span>
                            {item.duplicateType === 'list' && (
                              <span className="bg-gray-100 text-gray-800 px-2 py-1 text-xs font-medium rounded-full">
                                Row {item.duplicateOf.replace('row-', '')}
                              </span>
                            )}
                            {getReasonBadge(item.reason)}
                          </div>
                        )}
                        {item.farFlag && (
                          <span className="bg-yellow-100 text-yellow-800 px-2 py-1 text-xs font-medium rounded-full flex items-center">
                            <ExclamationTriangleIcon className="h-3 w-3 mr-1" />
                            Far ({formatDistance(item.distanceMiles)})
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Distance Statistics */}
        {distanceStats && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h4 className="text-sm font-medium text-gray-900 mb-3">Distance Statistics</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Total Leads</p>
                <p className="font-semibold text-gray-900">{distanceStats.count}</p>
              </div>
              <div>
                <p className="text-gray-500">Avg Distance</p>
                <p className="font-semibold text-gray-900">{formatDistance(distanceStats.avgMiles)}</p>
              </div>
              <div>
                <p className="text-gray-500">Min Distance</p>
                <p className="font-semibold text-gray-900">{formatDistance(distanceStats.minMiles)}</p>
              </div>
              <div>
                <p className="text-gray-500">Max Distance</p>
                <p className="font-semibold text-gray-900">{formatDistance(distanceStats.maxMiles)}</p>
              </div>
              <div>
                <p className="text-gray-500">Within 50 mi</p>
                <p className="font-semibold text-gray-900">{distanceStats.within50}</p>
              </div>
              <div>
                <p className="text-gray-500">Within 150 mi</p>
                <p className="font-semibold text-gray-900">{distanceStats.within150}</p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onExportCSV}
            disabled={isImporting}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export CSV
          </button>
          <button
            onClick={onDiscardDuplicates}
            disabled={isImporting}
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? 'Importing...' : 'Discard Duplicates'}
          </button>
          <button
            onClick={onAcceptAll}
            disabled={isImporting}
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? 'Importing...' : 'Accept All'}
          </button>
          <button
            onClick={onSaveValidLeads}
            disabled={isImporting}
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? 'Importing...' : 'Save Valid Leads'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LeadAnalysisModal; 