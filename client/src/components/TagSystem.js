import React, { useState, useEffect } from 'react';
import { FiX, FiTag } from 'react-icons/fi';
import axios from 'axios';

const TagSystem = ({ leadId, onTagsUpdate }) => {
  const [appliedTags, setAppliedTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Preset tags with colors
  const availableTags = [
    { name: "No Answer", color: "gray", bgColor: "bg-gray-100", textColor: "text-gray-700", borderColor: "border-gray-300" },
    { name: "Call Back Requested", color: "blue", bgColor: "bg-blue-100", textColor: "text-blue-700", borderColor: "border-blue-300" },
    { name: "Number Disconnected", color: "red", bgColor: "bg-red-100", textColor: "text-red-700", borderColor: "border-red-300" },
    { name: "Wrong Number", color: "orange", bgColor: "bg-orange-100", textColor: "text-orange-700", borderColor: "border-orange-300" },
    { name: "Not Interested", color: "red", bgColor: "bg-red-100", textColor: "text-red-700", borderColor: "border-red-300" },
    { name: "Already Signed Up", color: "green", bgColor: "bg-green-100", textColor: "text-green-700", borderColor: "border-green-300" }
  ];

  // Fetch current tags
  const fetchTags = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/leads/${leadId}/tags`);
      setAppliedTags(response.data.tags || []);
      setError('');
    } catch (err) {
      console.error('Error fetching tags:', err);
      setError('Failed to load tags');
    } finally {
      setLoading(false);
    }
  };

  // Add a tag
  const addTag = async (tagName) => {
    if (appliedTags.includes(tagName)) return; // Already applied

    try {
      setLoading(true);
      const response = await axios.post(`/api/leads/${leadId}/tags`, { tag: tagName });
      setAppliedTags(response.data.tags);
      setError('');
      
      // Notify parent component
      if (onTagsUpdate) {
        onTagsUpdate(response.data.tags);
      }
    } catch (err) {
      console.error('Error adding tag:', err);
      setError('Failed to add tag');
    } finally {
      setLoading(false);
    }
  };

  // Remove a tag
  const removeTag = async (tagName) => {
    try {
      setLoading(true);
      const response = await axios.delete(`/api/leads/${leadId}/tags/${encodeURIComponent(tagName)}`);
      setAppliedTags(response.data.tags);
      setError('');
      
      // Notify parent component
      if (onTagsUpdate) {
        onTagsUpdate(response.data.tags);
      }
    } catch (err) {
      console.error('Error removing tag:', err);
      setError('Failed to remove tag');
    } finally {
      setLoading(false);
    }
  };

  // Get tag styling
  const getTagStyle = (tagName) => {
    const tag = availableTags.find(t => t.name === tagName);
    return tag || { bgColor: "bg-gray-100", textColor: "text-gray-700", borderColor: "border-gray-300" };
  };

  useEffect(() => {
    if (leadId) {
      fetchTags();
    }
  }, [leadId]);

  if (loading && appliedTags.length === 0) {
    return (
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-6 border border-purple-200 shadow-sm">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2 bg-purple-100 rounded-lg">
            <FiTag className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Lead Tags</h3>
            <p className="text-sm text-gray-600">Loading tags...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-6 border border-purple-200 shadow-sm">
      <div className="flex items-center space-x-3 mb-6">
        <div className="p-2 bg-purple-100 rounded-lg">
          <FiTag className="h-5 w-5 text-purple-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Lead Tags</h3>
          <p className="text-sm text-gray-600">Add tags to categorize and track lead status</p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Available Tags */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Available Tags:</h4>
        <div className="flex flex-wrap gap-2">
          {availableTags.map((tag) => {
            const isApplied = appliedTags.includes(tag.name);
            return (
              <button
                key={tag.name}
                onClick={() => !isApplied && addTag(tag.name)}
                disabled={isApplied || loading}
                className={`
                  px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
                  ${isApplied 
                    ? 'opacity-50 cursor-not-allowed' 
                    : 'hover:scale-105 hover:shadow-md cursor-pointer'
                  }
                  ${tag.bgColor} ${tag.textColor} ${tag.borderColor} border
                `}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Applied Tags */}
      {appliedTags.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">Applied Tags:</h4>
          <div className="flex flex-wrap gap-2">
            {appliedTags.map((tag) => {
              const style = getTagStyle(tag);
              return (
                <div
                  key={tag}
                  className={`
                    flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium
                    ${style.bgColor} ${style.textColor} ${style.borderColor} border
                  `}
                >
                  <span>{tag}</span>
                  <button
                    onClick={() => removeTag(tag)}
                    disabled={loading}
                    className="ml-1 p-0.5 rounded-full hover:bg-black hover:bg-opacity-10 transition-colors"
                  >
                    <FiX className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No Tags Applied */}
      {appliedTags.length === 0 && !loading && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500">No tags applied yet. Click on a tag above to add it.</p>
        </div>
      )}
    </div>
  );
};

export default TagSystem; 