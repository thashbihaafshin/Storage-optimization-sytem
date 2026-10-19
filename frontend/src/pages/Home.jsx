import React, { useState, useMemo } from 'react';
import AnalyticsDashboard from '../components/AnalyticsDashboard';
import DuplicateResolver from '../components/DuplicateResolver';
import SearchBar from '../components/SearchBar';
import { useHoverPreview, FileHoverPreview } from '../components/FileHoverPreview';

export default function Home({ 
  folderPath, 
  setFolderPath, 
  isScanning, 
  setIsScanning, 
  scanResult, 
  setScanResult 
}) {
  const [isOrganizing, setIsOrganizing] = useState(false);
  
  // Tab Navigation State
  const [activeTab, setActiveTab] = useState('organize'); // 'organize' | 'analytics'
  const [duplicateCount, setDuplicateCount] = useState(0);

  // State for UI interactions
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [message, setMessage] = useState({ type: '', text: '' });

  // State for the "New Category" Modal
  const [newCategoryModal, setNewCategoryModal] = useState({ isOpen: false, filePath: null, sourceClusterId: null });
  const [newCategoryName, setNewCategoryName] = useState('');

  // Initialize Hover Preview Hook
  const { hoverState, handleMouseEnter, handleMouseMove, handleMouseLeave } = useHoverPreview(200);

  // --------------------------------------------------------
  // API: SCAN DIRECTORY
  // --------------------------------------------------------
  const handleScan = async () => {
    if (!folderPath.trim()) {
      setMessage({ type: 'error', text: 'Please enter a folder path.' });
      return;
    }

    setIsScanning(true);
    setMessage({ type: '', text: '' });
    setScanResult(null);
    setActiveTab('organize'); // Reset to organize tab on new scan

    try {
      const response = await fetch('http://localhost:5000/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: folderPath })
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Scan failed');

      setScanResult(data);
      
      // Auto-select all clustered files by default
      const initialSelection = new Set();
      const initialExpanded = new Set();
      
      Object.entries(data.clusters || {}).forEach(([clusterId, cluster]) => {
        initialExpanded.add(clusterId); // Expand all by default
        cluster.files.forEach(file => {
          initialSelection.add(file.file_path);
        });
      });
      
      setSelectedFiles(initialSelection);
      setExpandedClusters(initialExpanded);
      setMessage({ type: 'success', text: 'AI Scan completed successfully!' });

    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsScanning(false);
    }
  };

  // --------------------------------------------------------
  // API: ORGANIZE FILES
  // --------------------------------------------------------
  const handleOrganize = async () => {
    if (!scanResult) return;

    setIsOrganizing(true);
    setMessage({ type: '', text: '' });

    // Build the recommended_structure payload based on user selections
    const recommendedStructure = {};
    
    Object.values(scanResult.clusters).forEach(cluster => {
      const filesToMove = cluster.files
        .filter(file => selectedFiles.has(file.file_path))
        .map(file => file.file_path);

      if (filesToMove.length > 0) {
        recommendedStructure[cluster.label] = filesToMove;
      }
    });

    if (Object.keys(recommendedStructure).length === 0) {
      setMessage({ type: 'error', text: 'No files selected for organization.' });
      setIsOrganizing(false);
      return;
    }

    try {
      const response = await fetch('http://localhost:5000/api/organize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_path: folderPath, // Organizing in the same root folder
          recommended_structure: recommendedStructure,
          dry_run: false // Set to false to actually move files
        })
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Organization failed');

      setMessage({ 
        type: 'success', 
        text: `Successfully organized ${data.moved_count} files into categories!` 
      });
      
      // Clear results after successful organization
      setScanResult(null);

    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsOrganizing(false);
    }
  };

  // --------------------------------------------------------
  // UI HELPERS & STATE MANAGEMENT
  // --------------------------------------------------------
  const toggleCluster = (clusterId) => {
    const newExpanded = new Set(expandedClusters);
    if (newExpanded.has(clusterId)) newExpanded.delete(clusterId);
    else newExpanded.add(clusterId);
    setExpandedClusters(newExpanded);
  };

  const toggleFile = (filePath) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(filePath)) newSelected.delete(filePath);
    else newSelected.add(filePath);
    setSelectedFiles(newSelected);
  };

  const toggleAllInCluster = (clusterId, files, isAllSelected) => {
    const newSelected = new Set(selectedFiles);
    files.forEach(file => {
      if (isAllSelected) newSelected.delete(file.file_path);
      else newSelected.add(file.file_path);
    });
    setSelectedFiles(newSelected);
  };

  // Core function to move a file in the React state
  const executeMove = (filePath, sourceClusterId, targetClusterId) => {
    if (sourceClusterId === targetClusterId) return;

    setScanResult(prev => {
      const newData = { ...prev };
      const newClusters = { ...newData.clusters };
      
      // 1. Remove file from source cluster
      const sourceCluster = { ...newClusters[sourceClusterId] };
      sourceCluster.files = [...sourceCluster.files];
      
      const fileIndex = sourceCluster.files.findIndex(f => f.file_path === filePath);
      if (fileIndex === -1) return prev;
      
      const [fileToMove] = sourceCluster.files.splice(fileIndex, 1);

      // Clean up source cluster if it's empty now
      if (sourceCluster.files.length === 0) {
        delete newClusters[sourceClusterId];
      } else {
        newClusters[sourceClusterId] = sourceCluster;
      }

      // 2. Add file to target cluster (create if it doesn't exist)
      if (!newClusters[targetClusterId]) {
        newClusters[targetClusterId] = {
          label: targetClusterId,
          confidence: 100, // Manual moves are 100% confident
          reasons: ["Manually organized by user"],
          files: []
        };
        
        // Auto-expand the newly created category
        setExpandedClusters(prevExpanded => new Set(prevExpanded).add(targetClusterId));
      }
      
      const targetCluster = { ...newClusters[targetClusterId] };
      targetCluster.files = [...targetCluster.files, fileToMove];
      newClusters[targetClusterId] = targetCluster;

      newData.clusters = newClusters;
      return newData;
    });
  };

  // Handle dropdown selection
  const handleDropdownChange = (filePath, sourceClusterId, targetValue) => {
    if (targetValue === 'NEW_CATEGORY') {
      // Open the modal instead of moving immediately
      setNewCategoryModal({ isOpen: true, filePath, sourceClusterId });
    } else {
      executeMove(filePath, sourceClusterId, targetValue);
    }
  };

  // Handle Modal Submission
  const handleCreateNewCategory = () => {
    if (!newCategoryName.trim()) return;
    
    executeMove(newCategoryModal.filePath, newCategoryModal.sourceClusterId, newCategoryName.trim());
    
    // Close and reset modal
    setNewCategoryModal({ isOpen: false, filePath: null, sourceClusterId: null });
    setNewCategoryName('');
  };

  // Callback to sync state when duplicates are deleted
  const handleDuplicatesResolved = (deletedPaths) => {
    if (!scanResult) return;
    
    setScanResult(prev => {
      const newData = { ...prev };
      
      // Remove from flat files array (updates Analytics chart)
      newData.files = newData.files.filter(f => !deletedPaths.includes(f.file_path));
      
      // Remove from clusters (updates Organize tab)
      const newClusters = { ...newData.clusters };
      Object.keys(newClusters).forEach(clusterId => {
        newClusters[clusterId].files = newClusters[clusterId].files.filter(
          f => !deletedPaths.includes(f.file_path)
        );
        // Clean up empty clusters
        if (newClusters[clusterId].files.length === 0) {
          delete newClusters[clusterId];
        }
      });
      
      newData.clusters = newClusters;
      return newData;
    });
  };

  // Calculate total storage of analyzed files
  const totalStorageMB = useMemo(() => {
    if (!scanResult || !scanResult.files) return "0.00";
    let total = 0;
    scanResult.files.forEach(file => {
      total += (file.file_size_mb || 0);
    });
    return total.toFixed(2);
  }, [scanResult]);

  // --------------------------------------------------------
  // RENDER
  // --------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 p-8 font-sans relative">
      
      {/* FLOATING HOVER PREVIEW CARD */}
      <FileHoverPreview {...hoverState} />

      {/* NEW CATEGORY MODAL */}
      {newCategoryModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-md animate-fade-in">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Create New Category</h3>
            <p className="text-sm text-gray-500 mb-4">Enter a name for the new folder.</p>
            
            <input
              type="text"
              autoFocus
              placeholder="e.g., Tax Documents 2024"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-6"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateNewCategory()}
            />
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => {
                  setNewCategoryModal({ isOpen: false, filePath: null, sourceClusterId: null });
                  setNewCategoryName('');
                }}
                className="px-5 py-2.5 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateNewCategory}
                disabled={!newCategoryName.trim()}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg font-medium transition-colors"
              >
                Create & Move
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* HEADER */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
            Storage Optimization System
          </h1>
          <p className="text-gray-500">AI-powered semantic file clustering and organization</p>
        </div>

        {/* INPUT SECTION */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex gap-4 items-center">
          <input
            type="text"
            placeholder="Enter local folder path (e.g., C:\Users\Name\Downloads)"
            className="flex-1 px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            disabled={isScanning || isOrganizing}
          />
          <button
            onClick={handleScan}
            disabled={isScanning || isOrganizing || !folderPath}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isScanning ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Scanning...
              </>
            ) : 'Start Scan'}
          </button>
        </div>

        {/* MESSAGES */}
        {message.text && (
          <div className={`p-4 rounded-lg font-medium ${message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {message.text}
          </div>
        )}

        {/* TAB NAVIGATION */}
        {scanResult && (
          <div className="flex space-x-6 border-b border-gray-200 mt-8">
            <button 
              onClick={() => setActiveTab('organize')} 
              className={`pb-3 text-sm font-bold uppercase tracking-wider transition-colors ${activeTab === 'organize' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Recommended Organization
            </button>
            <button 
              onClick={() => setActiveTab('analytics')} 
              className={`pb-3 text-sm font-bold uppercase tracking-wider transition-colors ${activeTab === 'analytics' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Analytics & Duplicates
            </button>
          </div>
        )}

        {/* CONDITIONAL SEARCH BAR (Only shows after scan is complete) */}
        {scanResult && !isScanning && (
          <div className="mt-6 flex justify-center animate-fade-in">
            <SearchBar />
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 1: AI ORGANIZATION */}
        {/* ========================================================= */}
        {scanResult && activeTab === 'organize' && (
          <div className="space-y-6 animate-fade-in mt-6">
            
            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 border-l-4 border-l-blue-500">
                <p className="text-sm text-gray-500 font-semibold uppercase">Total Files Scanned</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{scanResult.files.length}</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 border-l-4 border-l-purple-500">
                <p className="text-sm text-gray-500 font-semibold uppercase">Categories Detected</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{Object.keys(scanResult.clusters).length}</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 border-l-4 border-l-green-500">
                <p className="text-sm text-gray-500 font-semibold uppercase">Storage Analyzed</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalStorageMB} MB</p>
              </div>
            </div>

            {/* CLUSTERS / CATEGORIES */}
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-gray-800">Recommended Organization</h2>
              
              {Object.entries(scanResult.clusters).map(([clusterId, cluster]) => {
                const isExpanded = expandedClusters.has(clusterId);
                const clusterFiles = cluster.files;
                const selectedInCluster = clusterFiles.filter(f => selectedFiles.has(f.file_path));
                const isAllSelected = selectedInCluster.length === clusterFiles.length && clusterFiles.length > 0;

                return (
                  <div key={clusterId} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    
                    {/* CLUSTER HEADER */}
                    <div 
                      className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => toggleCluster(clusterId)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{isExpanded ? '📂' : '📁'}</span>
                        <div>
                          <h3 className="font-bold text-lg text-gray-800">{cluster.label}</h3>
                          <p className="text-xs text-gray-500">
                            {clusterFiles.length} files • {cluster.confidence}% AI Confidence
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleAllInCluster(clusterId, clusterFiles, isAllSelected);
                          }}
                          className="text-sm text-blue-600 hover:underline font-medium"
                        >
                          {isAllSelected ? 'Deselect All' : 'Select All'}
                        </button>
                        <span className="text-gray-400 transform transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                          ▼
                        </span>
                      </div>
                    </div>

                    {/* CLUSTER FILES (COLLAPSIBLE) */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 divide-y divide-gray-100">
                        {clusterFiles.map((file, idx) => (
                          <div 
                            key={idx} 
                            className="flex items-center gap-4 p-3 hover:bg-gray-50 transition-colors"
                            // ATTACH HOVER EVENTS HERE
                            onMouseEnter={(e) => handleMouseEnter(file, e)}
                            onMouseMove={handleMouseMove}
                            onMouseLeave={handleMouseLeave}
                          >
                            
                            {/* Checkbox */}
                            <input 
                              type="checkbox" 
                              className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                              checked={selectedFiles.has(file.file_path)}
                              onChange={() => toggleFile(file.file_path)}
                            />
                            
                            {/* File Info */}
                            <div 
                              className="flex-1 truncate cursor-pointer" 
                              onClick={() => toggleFile(file.file_path)}
                            >
                              <p className="text-sm font-medium text-gray-800 truncate">{file.file_name}</p>
                              <p className="text-xs text-gray-400 truncate">{file.file_path}</p>
                            </div>

                            {/* Move Dropdown */}
                            <select
                              value={clusterId}
                              onChange={(e) => handleDropdownChange(file.file_path, clusterId, e.target.value)}
                              className="text-xs border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
                            >
                              {Object.keys(scanResult.clusters).map(key => (
                                <option key={key} value={key}>
                                  {scanResult.clusters[key].label}
                                </option>
                              ))}
                              <option disabled>──────────</option>
                              <option value="NEW_CATEGORY">➕ Move to New Category...</option>
                            </select>

                            {/* Extension Badge */}
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                              {file.extension.toUpperCase()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ACTION FOOTER */}
            <div className="flex justify-end pt-6">
              <button
                onClick={handleOrganize}
                disabled={isOrganizing || selectedFiles.size === 0}
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-bold text-lg shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isOrganizing ? 'Organizing...' : `Apply Organization (${selectedFiles.size} files)`}
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: ANALYTICS & DUPLICATES */}
        {/* ========================================================= */}
        {scanResult && activeTab === 'analytics' && (
          <div className="animate-fade-in space-y-6 mt-6">
            <AnalyticsDashboard 
              files={scanResult.files} 
              duplicateCount={duplicateCount} 
            />
            <DuplicateResolver 
              folderPath={folderPath} 
              onDuplicatesResolved={handleDuplicatesResolved} 
              onScanComplete={(count) => setDuplicateCount(count)} 
            />
          </div>
        )}
      </div>
    </div>
  );
}