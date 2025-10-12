import React, { useState, useEffect, useRef } from 'react';
import { FiSend, FiCpu, FiAlertCircle, FiCheck, FiInfo, FiHelpCircle } from 'react-icons/fi';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const AIAssistant = () => {
  const { user } = useAuth();
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [examples, setExamples] = useState([]);
  const [aiStatus, setAiStatus] = useState({ available: false, message: '' });
  const [showSetup, setShowSetup] = useState(false);
  const chatEndRef = useRef(null);

  // Check AI service status on mount
  useEffect(() => {
    checkAIStatus();
    loadExamples();
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const checkAIStatus = async () => {
    try {
      const res = await axios.get('/api/ai-assistant/status');
      setAiStatus(res.data);
      if (!res.data.available) {
        setShowSetup(true);
      }
    } catch (error) {
      console.error('Error checking AI status:', error);
      setAiStatus({ available: false, message: 'Failed to check AI status' });
    }
  };

  const loadExamples = async () => {
    try {
      const res = await axios.get('/api/ai-assistant/examples');
      setExamples(res.data.examples || []);
    } catch (error) {
      console.error('Error loading examples:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!question.trim() || loading) return;

    const userMessage = {
      type: 'user',
      content: question,
      timestamp: new Date()
    };

    setChatHistory(prev => [...prev, userMessage]);
    setQuestion('');
    setLoading(true);

    try {
      const res = await axios.post('/api/ai-assistant/query', { question });
      
      const aiMessage = {
        type: 'ai',
        content: res.data.response,
        data: res.data.data,
        queryStructure: res.data.queryStructure,
        timestamp: new Date()
      };

      setChatHistory(prev => [...prev, aiMessage]);
    } catch (error) {
      const errorMessage = {
        type: 'error',
        content: error.response?.data?.error || 'Failed to process your question. Please try again.',
        setupRequired: error.response?.data?.setupRequired,
        timestamp: new Date()
      };

      setChatHistory(prev => [...prev, errorMessage]);
      
      if (error.response?.data?.setupRequired) {
        setShowSetup(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExampleClick = (exampleQuestion) => {
    setQuestion(exampleQuestion);
  };

  const clearHistory = () => {
    setChatHistory([]);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <FiCpu className="text-blue-500" />
                AI Assistant
              </h1>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                Ask questions about your CRM data in natural language
              </p>
            </div>
            <div className="flex items-center gap-3">
              {aiStatus.available ? (
                <span className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <FiCheck className="w-4 h-4" />
                  AI Ready
                </span>
              ) : (
                <span className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <FiAlertCircle className="w-4 h-4" />
                  Setup Required
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Setup Instructions (if needed) */}
        {showSetup && !aiStatus.available && (
          <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <FiInfo className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
                  AI Assistant Setup Required
                </h3>
                <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
                  To use the AI Assistant, you need to configure a Google Gemini API key.
                </p>
                <div className="bg-white dark:bg-gray-800 rounded p-4 space-y-2 text-sm">
                  <p className="font-medium text-gray-900 dark:text-white">Setup Steps:</p>
                  <ol className="list-decimal list-inside space-y-1 text-gray-700 dark:text-gray-300">
                    <li>Visit <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google AI Studio</a></li>
                    <li>Create a free API key (no credit card required)</li>
                    <li>Add <code className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">GEMINI_API_KEY=your_key_here</code> to your .env file</li>
                    <li>Restart the server</li>
                  </ol>
                </div>
                <button
                  onClick={() => setShowSetup(false)}
                  className="mt-3 text-sm text-yellow-700 dark:text-yellow-300 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chat Area */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 250px)' }}>
              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {chatHistory.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                    <div className="text-center">
                      <FiHelpCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg">Ask me anything about your CRM data</p>
                      <p className="text-sm mt-2">Try one of the example questions →</p>
                    </div>
                  </div>
                ) : (
                  chatHistory.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-4 ${
                          msg.type === 'user'
                            ? 'bg-blue-500 text-white'
                            : msg.type === 'error'
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                        }`}
                      >
                        {msg.type === 'user' && (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                        {msg.type === 'ai' && (
                          <div>
                            <p className="whitespace-pre-wrap mb-3">{msg.content}</p>
                            {msg.data && msg.data.length > 0 && (
                              <details className="mt-3">
                                <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                                  View raw data ({msg.data.length} records)
                                </summary>
                                <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded text-xs overflow-auto max-h-48">
                                  <pre>{JSON.stringify(msg.data, null, 2)}</pre>
                                </div>
                              </details>
                            )}
                          </div>
                        )}
                        {msg.type === 'error' && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <FiAlertCircle className="w-4 h-4" />
                              <span className="font-semibold">Error</span>
                            </div>
                            <p>{msg.content}</p>
                          </div>
                        )}
                        <p className="text-xs opacity-70 mt-2">
                          {msg.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
              <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900">
                <form onSubmit={handleSubmit} className="flex gap-3">
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a question about your CRM data..."
                    disabled={loading || !aiStatus.available}
                    className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg 
                             focus:ring-2 focus:ring-blue-500 focus:border-transparent
                             disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed
                             bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    disabled={loading || !question.trim() || !aiStatus.available}
                    className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg
                             disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed
                             transition-colors flex items-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <FiSend className="w-4 h-4" />
                        Send
                      </>
                    )}
                  </button>
                </form>
                {chatHistory.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="mt-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    Clear history
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Examples Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Example Questions
              </h3>
              <div className="space-y-2">
                {examples.map((example, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleExampleClick(example)}
                    disabled={loading || !aiStatus.available}
                    className="w-full text-left p-3 rounded-lg bg-gray-50 dark:bg-gray-700 
                             hover:bg-gray-100 dark:hover:bg-gray-600 
                             text-sm text-gray-700 dark:text-gray-300
                             disabled:opacity-50 disabled:cursor-not-allowed
                             transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Tips
                </h4>
                <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    <span>Ask specific questions about bookings, sales, or revenue</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    <span>Use time ranges like "this week", "today", or "this month"</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    <span>Reference bookers by name (e.g., "Chicko")</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    <span>Ask for comparisons, averages, or totals</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;

