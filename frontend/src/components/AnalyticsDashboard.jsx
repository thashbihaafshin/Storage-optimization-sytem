import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Clock, Archive, ChevronRight } from 'lucide-react';
import { formatBytes } from '../utils/formatters';

const COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#6366F1'];
const INACTIVE_THRESHOLD_DAYS = 180;

export default function AnalyticsDashboard({ files, duplicateCount }) {
  // 1. Calculate Chart Data, Total Storage, and Inactive Files
  const { chartData, totalStorageBytes, inactiveCount, inactiveStorageBytes } = useMemo(() => {
    if (!files || files.length === 0) {
      return { chartData: [], totalStorageBytes: 0, inactiveCount: 0, inactiveStorageBytes: 0 };
    }

    const extensionCounts = {};
    let storage = 0;
    let iCount = 0;
    let iStorage = 0;
    
    const now = Date.now();
    const thresholdMs = INACTIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

    files.forEach(file => {
      // Aggregate Extensions
      const ext = (file.extension || 'unknown').replace('.', '').toUpperCase() || 'OTHER';
      extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
      
      // Aggregate Storage
      const fileBytes = file.size_bytes || (file.file_size_mb * 1024 * 1024) || 0;
      storage += fileBytes;

      // Calculate Inactive Files (Using modified_time as activity proxy)
      const fileDate = new Date(file.modified_time || file.created_time).getTime();
      if (now - fileDate > thresholdMs) {
        iCount++;
        iStorage += fileBytes;
      }
    });

    const chartData = Object.entries(extensionCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return { chartData, totalStorageBytes: storage, inactiveCount: iCount, inactiveStorageBytes: iStorage };
  }, [files]);

  // 2. Custom Tooltip for the Pie Chart
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const percentage = ((data.value / files.length) * 100).toFixed(1);
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg">
          <p className="font-bold text-gray-800">{data.name} Files</p>
          <p className="text-sm text-gray-600">Count: <span className="font-semibold text-blue-600">{data.value}</span></p>
          <p className="text-sm text-gray-600">Share: <span className="font-semibold text-green-600">{percentage}%</span></p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 border-l-4 border-l-blue-500">
          <p className="text-xs text-gray-500 font-semibold uppercase">Total Files</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{files?.length || 0}</p>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 border-l-4 border-l-purple-500">
          <p className="text-xs text-gray-500 font-semibold uppercase">Storage Used</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{formatBytes(totalStorageBytes)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 border-l-4 border-l-green-500">
          <p className="text-xs text-gray-500 font-semibold uppercase">Categories</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{chartData.length}</p>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 border-l-4 border-l-red-500">
          <p className="text-xs text-gray-500 font-semibold uppercase">Duplicates Found</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{duplicateCount || 0}</p>
        </div>
      </div>

      {/* CHARTS & INSIGHTS WIDGETS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left: File Type Distribution Chart (Spans 2 columns) */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col">
          <h2 className="text-lg font-bold text-gray-800 mb-4">File Type Distribution</h2>
          <div className="flex-1 min-h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chartData} cx="50%" cy="50%" innerRadius={75} outerRadius={105} paddingAngle={2} dataKey="value">
                  {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Inactive Files Widget (Spans 1 column) */}
        <div className="bg-gradient-to-br from-slate-50 to-gray-100 p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-between relative overflow-hidden">
          {/* Decorative background icon */}
          <Archive className="absolute -bottom-4 -right-4 w-32 h-32 text-gray-200/50 pointer-events-none" />
          
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold text-gray-800">Inactive Files</h2>
            </div>
            <p className="text-xs text-gray-500 font-medium mb-6">
              Not modified in {INACTIVE_THRESHOLD_DAYS}+ days
            </p>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Dormant Files</p>
                <p className="text-3xl font-extrabold text-gray-900">{inactiveCount}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-600">Reclaimable Storage</p>
                <p className="text-3xl font-extrabold text-amber-600">{formatBytes(inactiveStorageBytes)}</p>
              </div>
            </div>
          </div>

          <div className="mt-8 z-10">
            <Link 
              to="/inactive-files" 
              className="w-full bg-white border border-gray-300 hover:border-blue-500 hover:text-blue-600 text-gray-700 font-semibold py-2.5 px-4 rounded-lg flex items-center justify-between transition-all shadow-sm group"
            >
              <span>Review Inactive Files</span>
              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" />
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}