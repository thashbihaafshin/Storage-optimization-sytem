import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import SearchResults from './pages/SearchResults';
import InactiveFiles from './pages/InactiveFiles'; // <-- 1. IMPORT THE NEW PAGE

export default function App() {
  // Lifted state to persist data across route navigation
  const [folderPath, setFolderPath] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  return (
    <Router>
      {/* Global Header */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex-shrink-0 flex items-center cursor-pointer">
              <span className="text-xl font-extrabold text-blue-600 tracking-tight">SmartFile AI</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* Routes */}
      <Routes>
        <Route 
          path="/" 
          element={
            <Home 
              folderPath={folderPath} 
              setFolderPath={setFolderPath}
              isScanning={isScanning}
              setIsScanning={setIsScanning}
              scanResult={scanResult}
              setScanResult={setScanResult}
            />
          } 
        />
        <Route path="/search" element={<SearchResults />} />
        
        {/* 2. ADD THE NEW ROUTE HERE */}
        <Route 
          path="/inactive-files" 
          element={
            <InactiveFiles 
              scanResult={scanResult} 
              setScanResult={setScanResult} 
            />
          } 
        />
      </Routes>
    </Router>
  );
}