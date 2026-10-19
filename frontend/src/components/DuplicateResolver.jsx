import React, { useState, useMemo } from 'react';
import { formatBytes } from '../utils/formatters';

export default function DuplicateResolver({ folderPath, onDuplicatesResolved, onScanComplete }) {
  const [duplicates, setDuplicates] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('http://localhost:5000/api/duplicates/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: folderPath })
      });
      const data = await res.json();
      
      const duplicateGroups = data.duplicates || [];
      setDuplicates(duplicateGroups);
      setSelectedFiles(new Set()); // Reset selections
      
      // Calculate total extra files (excluding the 1 original per group)
      let extraFilesCount = 0;
      duplicateGroups.forEach(group => {
        extraFilesCount += (group.files.length - 1);
      });
      
      // Send count to parent (Analytics Dashboard)
      if (onScanComplete) onScanComplete(extraFilesCount);

    } catch (err) {
      console.error(err);
    } finally {
      setIsScanning(false);
    }
  };

  const applyPreset = (groupHash, preset) => {
    const group = duplicates.find(g => g.hash === groupHash);
    const newSelected = new Set(selectedFiles);
    
    // Clear current group selection
    group.files.forEach(f => newSelected.delete(f.file_path));

    if (preset === 'keep_oldest') {
      // Index 0 is oldest. Select all others for deletion.
      group.files.slice(1).forEach(f => newSelected.add(f.file_path));
    } else if (preset === 'keep_newest') {
      // Last index is newest. Select all others for deletion.
      group.files.slice(0, -1).forEach(f => newSelected.add(f.file_path));
    } else if (preset === 'select_all') {
      group.files.forEach(f => newSelected.add(f.file_path));
    }

    setSelectedFiles(newSelected);
  };

  const toggleFile = (path) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(path)) newSelected.delete(path);
    else newSelected.add(path);
    setSelectedFiles(newSelected);
  };

  const executeDeletion = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch('http://localhost:5000/api/duplicates/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_paths: Array.from(selectedFiles) })
      });
      const data = await res.json();
      
      if (data.success) {
        // Remove deleted files from local state
        const remainingDuplicates = duplicates.map(group => ({
          ...group,
          files: group.files.filter(f => !data.deleted.includes(f.file_path))
        })).filter(group => group.files.length > 1); // Remove group if 1 or 0 files left

        setDuplicates(remainingDuplicates);
        setSelectedFiles(new Set());
        setIsModalOpen(false);
        
        // Recalculate remaining duplicates for the dashboard
        let extraFilesCount = 0;
        remainingDuplicates.forEach(group => {
          extraFilesCount += (group.files.length - 1);
        });
        if (onScanComplete) onScanComplete(extraFilesCount);

        // Notify parent to update Analytics charts
        if (onDuplicatesResolved) onDuplicatesResolved(data.deleted);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Calculate total space to be freed
  const spaceToFree = useMemo(() => {
    let bytes = 0;
    duplicates.forEach(group => {
      group.files.forEach(f => {
        if (selectedFiles.has(f.file_path)) bytes += group.size_bytes;
      });
    });
    return bytes;
  }, [duplicates, selectedFiles]);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mt-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Duplicate Detection Engine</h2>
          <p className="text-sm text-gray-500">Find and resolve exact byte-for-byte duplicate files.</p>
        </div>
        <button 
          onClick={handleScan} 
          disabled={isScanning || !folderPath}
          className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {isScanning ? 'Scanning...' : 'Scan for Duplicates'}
        </button>
      </div>

      {duplicates.length > 0 && (
        <div className="space-y-6">
          {duplicates.map((group, idx) => (
            <div key={group.hash} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 p-3 border-b border-gray-200 flex justify-between items-center">
                <span className="font-semibold text-gray-700">Group {idx + 1} <span className="text-xs text-gray-400 font-normal ml-2">({formatBytes(group.size_bytes)} each)</span></span>
                <div className="flex gap-2">
                  <button onClick={() => applyPreset(group.hash, 'keep_oldest')} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition-colors">Keep Oldest</button>
                  <button onClick={() => applyPreset(group.hash, 'keep_newest')} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition-colors">Keep Newest</button>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {group.files.map((file, fIdx) => (
                  <label key={file.file_path} className={`flex items-center gap-4 p-3 cursor-pointer hover:bg-red-50 transition-colors ${selectedFiles.has(file.file_path) ? 'bg-red-50' : ''}`}>
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500 cursor-pointer"
                      checked={selectedFiles.has(file.file_path)}
                      onChange={() => toggleFile(file.file_path)}
                    />
                    <div className="flex-1 truncate">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {file.file_name} 
                        {fIdx === 0 && <span className="ml-2 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded uppercase font-bold">Oldest</span>}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{file.file_path}</p>
                    </div>
                    <span className="text-xs text-gray-500">{new Date(file.created_time * 1000).toLocaleDateString()}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {/* Action Footer */}
          {selectedFiles.size > 0 && (
            <div className="flex justify-between items-center bg-red-50 p-4 rounded-lg border border-red-100">
              <span className="text-red-700 font-medium">{selectedFiles.size} files selected to delete ({formatBytes(spaceToFree)})</span>
              <button onClick={() => setIsModalOpen(true)} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-bold shadow-sm transition-colors">
                Resolve Selected
              </button>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-md animate-fade-in">
            <h3 className="text-xl font-bold text-gray-900 mb-2 text-red-600">Confirm Deletion</h3>
            <p className="text-sm text-gray-600 mb-4">
              You are about to permanently delete <strong>{selectedFiles.size}</strong> duplicate files. 
              This will free up <strong>{formatBytes(spaceToFree)}</strong> of storage. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">Cancel</button>
              <button onClick={executeDeletion} disabled={isDeleting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors">
                {isDeleting ? 'Deleting...' : 'Yes, Delete Files'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}