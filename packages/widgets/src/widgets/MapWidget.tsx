/**
 * MapWidget - Interactive map with markers
 * 
 * Features: markers, popups, zoom controls, custom styling
 * Note: Uses simple canvas-based rendering instead of external mapping library
 */

import React, { useRef, useEffect, useState } from 'react';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface MapWidgetConfig {
  markers?: MapMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: number;
  enableZoom?: boolean;
  enablePan?: boolean;
  mapStyle?: 'default' | 'dark' | 'light';
}

export const MapWidget: React.FC<ReactWidgetProps> = ({ config, data }) => {
  const widgetConfig = config as any as MapWidgetConfig;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Initialize markers from config or data
  const markers: MapMarker[] = data?.markers || widgetConfig.markers || [];
  
  // Default to world center if no center specified
  const [center, setCenter] = useState(
    widgetConfig.center || { lat: 0, lng: 0 }
  );
  const [zoom, setZoom] = useState(widgetConfig.zoom || 2);
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  
  const height = widgetConfig.height || 400;
  const enableZoom = widgetConfig.enableZoom !== false;
  const enablePan = widgetConfig.enablePan !== false;
  const mapStyle = widgetConfig.mapStyle || 'default';
  
  // Convert lat/lng to pixel coordinates
  const latLngToPixel = (lat: number, lng: number, width: number, height: number) => {
    const scale = Math.pow(2, zoom);
    const worldWidth = width * scale;
    const worldHeight = height * scale;
    
    // Mercator projection
    const x = (lng + 180) * (worldWidth / 360);
    const latRad = (lat * Math.PI) / 180;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const y = worldHeight / 2 - (worldWidth * mercN) / (2 * Math.PI);
    
    // Offset by center
    const centerX = (center.lng + 180) * (worldWidth / 360);
    const centerLatRad = (center.lat * Math.PI) / 180;
    const centerMercN = Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2));
    const centerY = worldHeight / 2 - (worldWidth * centerMercN) / (2 * Math.PI);
    
    return {
      x: x - centerX + width / 2,
      y: y - centerY + height / 2
    };
  };
  
  // Draw the map
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background based on style
    if (mapStyle === 'dark') {
      ctx.fillStyle = '#1a1a1a';
    } else if (mapStyle === 'light') {
      ctx.fillStyle = '#f5f5f5';
    } else {
      ctx.fillStyle = '#e0e0e0';
    }
    ctx.fillRect(0, 0, width, height);
    
    // Draw grid
    ctx.strokeStyle = mapStyle === 'dark' ? '#333' : '#ccc';
    ctx.lineWidth = 1;
    
    const gridSize = 50 * Math.pow(2, zoom - 2);
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    
    // Draw markers
    markers.forEach(marker => {
      const pos = latLngToPixel(marker.lat, marker.lng, width, height);
      
      // Skip if marker is off-screen
      if (pos.x < -20 || pos.x > width + 20 || pos.y < -20 || pos.y > height + 20) {
        return;
      }
      
      // Draw marker pin
      ctx.fillStyle = marker.color || 'var(--widget-primary)';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      
      // Pin shape
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      // Pin stem
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x, pos.y + 15);
      ctx.strokeStyle = marker.color || 'var(--widget-primary)';
      ctx.lineWidth = 3;
      ctx.stroke();
      
      // Draw icon if provided
      if (marker.icon) {
        ctx.fillStyle = '#fff';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(marker.icon, pos.x, pos.y);
      }
      
      // Highlight selected marker
      if (selectedMarker?.id === marker.id) {
        ctx.strokeStyle = '#ffeb3b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    
  }, [markers, center, zoom, selectedMarker, mapStyle]);
  
  // Handle marker click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Check if click is near any marker
    for (const marker of markers) {
      const pos = latLngToPixel(marker.lat, marker.lng, canvas.width, canvas.height);
      const distance = Math.sqrt(
        Math.pow(clickX - pos.x, 2) + Math.pow(clickY - pos.y, 2)
      );
      
      if (distance < 15) {
        setSelectedMarker(marker);
        return;
      }
    }
    
    // Click on empty space deselects
    setSelectedMarker(null);
  };
  
  // Handle zoom
  const handleZoom = (delta: number) => {
    if (!enableZoom) return;
    setZoom(prev => Math.max(1, Math.min(10, prev + delta)));
  };
  
  // Handle pan
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!enablePan) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };
  
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !dragStart || !enablePan) return;
    
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    
    // Convert pixel movement to lat/lng movement
    const scale = Math.pow(2, zoom);
    const lngDelta = -dx / (canvasRef.current!.width * scale) * 360;
    const latDelta = dy / (canvasRef.current!.height * scale) * 180;
    
    setCenter(prev => ({
      lat: Math.max(-85, Math.min(85, prev.lat + latDelta)),
      lng: ((prev.lng + lngDelta + 180) % 360) - 180
    }));
    
    setDragStart({ x: e.clientX, y: e.clientY });
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStart(null);
  };
  
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!enableZoom) return;
    e.preventDefault();
    handleZoom(e.deltaY > 0 ? -0.5 : 0.5);
  };
  
  return (
    <div className="widget-container map-widget">
      <h3>{config.title || 'Map'}</h3>
      
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={600}
          height={height}
          onClick={handleCanvasClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{
            width: '100%',
            cursor: isDragging ? 'grabbing' : 'grab',
            border: '1px solid var(--widget-border)',
            borderRadius: '4px'
          }}
        />
        
        {/* Zoom controls */}
        {enableZoom && (
          <div style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <button
              className="widget-button"
              onClick={() => handleZoom(1)}
              style={{ padding: '4px 8px' }}
            >
              +
            </button>
            <div style={{
              padding: '4px 8px',
              backgroundColor: 'var(--widget-card-bg)',
              border: '1px solid var(--widget-border)',
              borderRadius: '4px',
              fontSize: '12px',
              textAlign: 'center'
            }}>
              {zoom.toFixed(1)}
            </div>
            <button
              className="widget-button"
              onClick={() => handleZoom(-1)}
              style={{ padding: '4px 8px' }}
            >
              −
            </button>
          </div>
        )}
        
        {/* Selected marker popup */}
        {selectedMarker && (
          <div className="widget-card" style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            right: '10px',
            maxWidth: '300px',
            padding: '12px',
            zIndex: 1000
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                  {selectedMarker.title || `Marker ${selectedMarker.id}`}
                </div>
                {selectedMarker.description && (
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--widget-text-secondary)',
                    marginBottom: '4px'
                  }}>
                    {selectedMarker.description}
                  </div>
                )}
                <div style={{ fontSize: '11px', color: 'var(--widget-text-muted)' }}>
                  {selectedMarker.lat.toFixed(4)}, {selectedMarker.lng.toFixed(4)}
                </div>
              </div>
              <button
                onClick={() => setSelectedMarker(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--widget-text-muted)',
                  cursor: 'pointer',
                  fontSize: '16px',
                  padding: '0 4px'
                }}
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Map info */}
      <div style={{
        marginTop: '8px',
        fontSize: '11px',
        color: 'var(--widget-text-muted)',
        display: 'flex',
        justifyContent: 'space-between'
      }}>
        <span>Center: {center.lat.toFixed(2)}°, {center.lng.toFixed(2)}°</span>
        <span>{markers.length} marker{markers.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
};
