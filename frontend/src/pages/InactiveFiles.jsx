import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Clock, Trash2, Archive, ShieldCheck } from 'lucide-react';
import { formatBytes } from '../utils/formatters';

const INACTIVE_THRESHOLD_DAYS = 180;

export default function InactiveFiles({ scanResult, setScanResult }) {
  const [selectedFiles, setSelectedFiles] = useState(new Set());

  // Filter files that are older than 180 days
  const inactiveFiles = useMemo(() => {
    if (!scanResult || !scanResult.files) return [];
    
    const now = Date.now();
    const thresholdMs = INACTIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    
    return scanResult.files.filter(file => {
      const fileDate = new Date(file.modified_time || file.created_time).getTime();
      return (now - fileDate) > thresholdMs;
    }).sort((a, b) => new Date(a.modified_time).getTime() - new Date(b.modified_time).getTime()); // Oldest first
  }, [scanResult]);

  const totalReclaimable = useMemo(() => {
    return inactiveFiles.reduce((acc, file) => acc + (file.size_bytes || (file.file_size_mb * 1024 * 1024) || 0), 0);
  }, [inactiveFiles]);

  const toggleFile = (path) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(path)) newSelected.delete(path);
    else newSelected.add(path);
    setSelectedFiles(newSelected);
  };

  const toggleAll = () => {
    if (selectedFiles.size === inactiveFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(inactiveFiles.map(f => f.file_path)));
    }
  };

  // Placeholder for Delete Action (Updates UI state)
  const handleDeleteSelected = () => {
    if (!scanResult) return;
    
    const confirmDelete = window.confirm(`Are you sure you want to delete ${selectedFiles.size} files?`);
    if (!confirmDelete) return;

    // In a real app, you would call your backend DELETE API here.
    // For now, we update the React state to remove them from the UI.
    setScanResult(prev => {
      const newData = { ...prev };
      newData.files = newData.files.filter(f => !selectedFiles.has(f.file_path));
      
      const newClusters = { ...newData.clusters };
      Object.keys(newClusters).forEach(clusterId => {
        newClusters[clusterId].files = newClusters[clusterId].files.filter(f => !selectedFiles.has(f.file_path));
        if (newClusters[clusterId].files.length === 0) delete newClusters[clusterId];
      });
      
      newData.clusters = newClusters;
      return newData;
    });
    
    setSelectedFiles(new Set());
  };

  if (!scanResult) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex flex-col items-center justify-center">
        <h2 className="text-xl font-bold text-gray-700 mb-4">No scan data available.</h2>
        <Link to="/" className="text-blue-600 hover:underline">Return to Home and run a scan.</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-4">
            <Link to="/" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <ArrowLeft className="w-6 h-6 text-gray-600" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Clock className="w-6 h-6 text-amber-500" /> Review Inactive Files
              </h1>
              <p className="text-sm text-gray-500 mt-1">Files not modified in over {INACTIVE_THRESHOLD_DAYS} days.</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500 font-semibold uppercase">Reclaimable Space</p>
            <p className="text-2xl font-bold text-amber-600">{formatBytes(totalReclaimable)}</p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <label className="flex items-center gap-3 cursor-pointer">
            <input 
              type="checkbox" 
              className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              checked={inactiveFiles.length > 0 && selectedFiles.size === inactiveFiles.length}
              onChange={toggleAll}
            />
            <span className="font-medium text-gray-700">Select All ({inactiveFiles.length})</span>
          </label>

          <div className="flex gap-3">
            <button 
              disabled={selectedFiles.size === 0}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
            >
              <Archive className="w-4 h-4" /> Archive to ZIP
            </button>
            <button 
              onClick={handleDeleteSelected}
              disabled={selectedFiles.size === 0}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
            >
              <Trash2 className="w-4 h-4" /> Delete Selected
            </button>
          </div>
        </div>

        {/* File List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {inactiveFiles.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <ShieldCheck className="w-16 h-16 text-green-500 mb-4" />
              <h3 className="text-xl font-bold text-gray-800">Your storage is clean!</h3>
              <p className="text-gray-500 mt-2">No inactive files found older than {INACTIVE_THRESHOLD_DAYS} days.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {inactiveFiles.map((file) => (
                <label key={file.file_path} className="flex items-center gap-4 p-4 hover:bg-gray-50 cursor-pointer transition-colors">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    checked={selectedFiles.has(file.file_path)}
                    onChange={() => toggleFile(file.file_path)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{file.file_name}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{file.file_path}</p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <p className="text-sm font-medium text-gray-700">{formatBytes(file.size_bytes || (file.file_size_mb * 1024 * 1024))}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{new Date(file.modified_time).toLocaleDateString()}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}