import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FileText, Image as ImageIcon, File, Calendar, HardDrive } from 'lucide-react';

// ============================================================================
// CUSTOM HOOK: Manages debounce and cursor tracking
// ============================================================================
export function useHoverPreview(delay = 200) {
  const [hoverState, setHoverState] = useState({ isVisible: false, file: null, x: 0, y: 0 });
  const timeoutRef = useRef(null);

  const handleMouseEnter = useCallback((file, e) => {
    const { clientX, clientY } = e;
    // Clear any existing timeouts
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    // Start the 200ms debounce
    timeoutRef.current = setTimeout(() => {
      setHoverState({ isVisible: true, file, x: clientX, y: clientY });
    }, delay);
  }, [delay]);

  const handleMouseMove = useCallback((e) => {
    // Update coordinates if the preview is currently visible
    if (hoverState.isVisible) {
      setHoverState(prev => ({ ...prev, x: e.clientX, y: e.clientY }));
    }
  }, [hoverState.isVisible]);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setHoverState({ isVisible: false, file: null, x: 0, y: 0 });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { hoverState, handleMouseEnter, handleMouseMove, handleMouseLeave };
}

// ============================================================================
// UI COMPONENT: The Floating Card
// ============================================================================
export function FileHoverPreview({ isVisible, file, x, y }) {
  if (!isVisible || !file) return null;

  // Format file size
  const formatSize = (mb) => {
    if (!mb) return 'Unknown Size';
    if (mb < 1) return `${(mb * 1024).toFixed(1)} KB`;
    return `${mb.toFixed(2)} MB`;
  };

  // Format Date
  const formatDate = (isoString) => {
    if (!isoString) return 'Unknown Date';
    return new Date(isoString).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Calculate smart positioning to prevent overflowing off the screen
  const cardWidth = 320;
  const cardHeight = 220; // Approximate height
  const offset = 15; // Distance from cursor

  let left = x + offset;
  let top = y + offset;

  // Flip to the left if too close to the right edge
  if (window.innerWidth - x < cardWidth + offset * 2) {
    left = x - cardWidth - offset;
  }
  
  // Flip upwards if too close to the bottom edge
  if (window.innerHeight - y < cardHeight + offset * 2) {
    top = y - cardHeight - offset;
  }

  const isImage = file.category === 'image' || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(file.extension?.replace('.', '').toLowerCase());
  const isDocument = file.category === 'document' || ['txt', 'pdf', 'docx', 'md'].includes(file.extension?.replace('.', '').toLowerCase());

  return (
    <div 
      className="fixed z-[100] bg-white/95 backdrop-blur-md border border-gray-200 shadow-2xl rounded-xl overflow-hidden pointer-events-none transition-opacity duration-150 ease-in-out"
      style={{ left: `${left}px`, top: `${top}px`, width: `${cardWidth}px` }}
    >
      {/* Header */}
      <div className="p-3 border-b border-gray-100 bg-gray-50/50 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold text-gray-900 truncate">{file.file_name || 'Unknown File'}</h4>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> {formatSize(file.file_size_mb)}</span>
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatDate(file.modified_time || file.created_time)}</span>
          </div>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-1 rounded">
          {file.extension?.replace('.', '') || 'FILE'}
        </span>
      </div>

      {/* Body / Preview Area */}
      <div className="p-3 h-32 flex flex-col justify-center bg-white">
        
        {/* IMAGE PREVIEW */}
        {isImage && (
          <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
            {/* Note: In a standard browser, local C:\ paths are blocked. 
                If you serve files via Flask, replace src with your API route. 
                Otherwise, this falls back to the icon. */}
            <img 
              src={`http://localhost:5000/api/preview?path=${encodeURIComponent(file.file_path)}`} 
              alt="Preview" 
              className="object-cover w-full h-full"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
            <div className="hidden flex-col items-center justify-center text-gray-400">
              <ImageIcon className="w-10 h-10 mb-2" />
              <span className="text-xs">Image Preview Unavailable</span>
            </div>
          </div>
        )}

        {/* DOCUMENT PREVIEW */}
        {isDocument && !isImage && (
          <div className="w-full h-full text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-200 overflow-hidden relative">
            <FileText className="w-4 h-4 text-blue-500 mb-2" />
            <p className="line-clamp-4 leading-relaxed">
              {file.text ? file.text : 'No text content extracted for this document.'}
            </p>
            {/* Fade out effect at the bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50 to-transparent"></div>
          </div>
        )}

        {/* FALLBACK PREVIEW */}
        {!isImage && !isDocument && (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-gray-200">
            <File className="w-10 h-10 mb-2 text-gray-300" />
            <span className="text-xs font-medium text-gray-500 truncate max-w-[90%]">
              {file.file_path}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}