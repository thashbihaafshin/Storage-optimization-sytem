import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { FileText, Image as ImageIcon, ArrowLeft, AlertCircle, Search } from 'lucide-react';
import SearchBar from '../components/SearchBar';

import { useHoverPreview, FileHoverPreview } from '../components/FileHoverPreview';

export default function SearchResults() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { hoverState, handleMouseEnter, handleMouseMove, handleMouseLeave } = useHoverPreview(200);

  useEffect(() => {
    if (!query) return;

    const fetchSearchResults = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch('http://localhost:5000/api/search/semantic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, top_k: 20, file_type: 'all' })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch results');
        
        setResults(data.results || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSearchResults();
  }, [query]);

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      {/* 3. RENDER THE FLOATING PREVIEW CARD */}
      <FileHoverPreview {...hoverState} />
      
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header & Local Search Bar */}
        <div className="flex flex-col md:flex-row items-center gap-6 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          {/* Client-side routing Link prevents hard reload */}
          <Link to="/" className="flex items-center text-gray-500 hover:text-blue-600 transition-colors font-medium whitespace-nowrap">
            <ArrowLeft className="w-5 h-5 mr-2" /> Back to Files
          </Link>
          <div className="flex-1 w-full">
            <SearchBar />
          </div>
        </div>

        {/* Results Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Showing results for: <span className="text-blue-600">"{query}"</span>
          </h1>
          <p className="text-gray-500 mt-1">Found {results.length} matching files</p>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-center gap-3">
            <AlertCircle className="text-red-500 w-6 h-6" />
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 animate-pulse h-48 flex flex-col justify-between">
                <div className="w-full h-24 bg-gray-200 rounded-lg mb-4"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && results.length === 0 && (
          <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-200">
            <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-700">No matching files found</h3>
            <p className="text-gray-500 mt-2">Try adjusting your search terms or using broader keywords.</p>
          </div>
        )}

        {/* Results Grid */}
        {!loading && results.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {results.map((result) => {
              const { metadata, similarity, type } = result;
              const isImage = type === 'image';
              const matchPercentage = (similarity * 100).toFixed(1);

              return (
                <div 
                  key={result.file_id} 
                  className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow group cursor-pointer flex flex-col"
                  // ATTACH HOVER EVENTS HERE
                  onMouseEnter={(e) => handleMouseEnter(metadata, e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                >
                  
                  <div className="h-36 bg-gray-100 flex items-center justify-center relative overflow-hidden">
                    {isImage ? (
                      <ImageIcon className="w-12 h-12 text-gray-400 group-hover:scale-110 transition-transform" />
                    ) : (
                      <FileText className="w-12 h-12 text-blue-400 group-hover:scale-110 transition-transform" />
                    )}
                    <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-white text-xs font-bold px-2 py-1 rounded-md">
                      {matchPercentage}% Match
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 truncate" title={metadata.file_name}>{metadata.file_name}</h3>
                      <p className="text-xs text-gray-500 truncate mt-1" title={metadata.file_path}>{metadata.file_path}</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-1 rounded uppercase">{metadata.extension.replace('.', '')}</span>
                      <span className="text-xs text-gray-400">{metadata.category}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}