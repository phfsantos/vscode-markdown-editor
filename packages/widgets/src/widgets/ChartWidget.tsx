/**
 * ChartWidget - Interactive charts with wigggle-ui styling
 * Inspired by dashboard-02.tsx pattern
 * 
 * Supports: line, bar, pie, doughnut, area charts
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Widget, WidgetHeader, WidgetTitle, WidgetContent, WidgetFooter,
  Label, WidgetSettingsPanel, SettingsToggle
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

// Chart.js types (we'll use a lightweight approach without full Chart.js for now)
interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string;
    borderWidth?: number;
    fill?: boolean;
  }[];
}

export interface ChartWidgetConfig {
  chartType: 'line' | 'bar' | 'pie' | 'doughnut' | 'area';
  chartData?: ChartData;
  size?: 'sm' | 'md' | 'lg';
  showLegend?: boolean;
  showGrid?: boolean;
  animated?: boolean;
}

// VS Code theme-aware colors
const themeColors = {
  primary: 'rgba(54, 162, 235, 1)',
  primaryLight: 'rgba(54, 162, 235, 0.3)',
  secondary: 'rgba(255, 99, 132, 1)',
  secondaryLight: 'rgba(255, 99, 132, 0.3)',
  success: 'rgba(75, 192, 192, 1)',
  successLight: 'rgba(75, 192, 192, 0.3)',
  warning: 'rgba(255, 206, 86, 1)',
  warningLight: 'rgba(255, 206, 86, 0.3)',
  purple: 'rgba(153, 102, 255, 1)',
  purpleLight: 'rgba(153, 102, 255, 0.3)',
  orange: 'rgba(255, 159, 64, 1)',
  orangeLight: 'rgba(255, 159, 64, 0.3)',
};

// Chart palette
const chartPalette = [
  themeColors.primary,
  themeColors.secondary,
  themeColors.success,
  themeColors.warning,
  themeColors.purple,
  themeColors.orange,
];

const chartPaletteLight = [
  themeColors.primaryLight,
  themeColors.secondaryLight,
  themeColors.successLight,
  themeColors.warningLight,
  themeColors.purpleLight,
  themeColors.orangeLight,
];

// Settings fields for the widget
const settingsFields: SettingsField[] = [
  { 
    key: 'chartType', 
    label: 'Chart Type', 
    type: 'select', 
    options: [
      { value: 'bar', label: 'Bar Chart' },
      { value: 'line', label: 'Line Chart' },
      { value: 'area', label: 'Area Chart' },
      { value: 'pie', label: 'Pie Chart' },
      { value: 'doughnut', label: 'Doughnut Chart' },
    ],
    defaultValue: 'bar'
  },
  { 
    key: 'size', 
    label: 'Size', 
    type: 'select', 
    options: [
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Medium' },
      { value: 'lg', label: 'Large' },
    ],
    defaultValue: 'md'
  },
  { key: 'showLegend', label: 'Show Legend', type: 'checkbox', defaultValue: true },
  { key: 'showGrid', label: 'Show Grid', type: 'checkbox', defaultValue: true },
];

export const ChartWidget: React.FC<ReactWidgetProps> = ({ config, data, onUpdate }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const [localConfig, setLocalConfig] = useState<ChartWidgetConfig>(config as any as ChartWidgetConfig);
  
  const widgetConfig = localConfig;
  const chartType = widgetConfig.chartType || 'bar';
  const size = widgetConfig.size || 'md';
  const showLegend = widgetConfig.showLegend !== false;
  const showGrid = widgetConfig.showGrid !== false;
  
  // Size configuration
  const sizeConfig = {
    sm: { canvasHeight: 150, legendSize: 10 },
    md: { canvasHeight: 200, legendSize: 11 },
    lg: { canvasHeight: 300, legendSize: 12 },
  };
  const currentSize = sizeConfig[size];
  
  // Process data
  useEffect(() => {
    if (data) {
      // If data is already in Chart.js format
      if (data.labels && data.datasets) {
        setChartData(data);
      }
      // If data is array of objects, convert to chart format
      else if (Array.isArray(data)) {
        const labels = data.map((item: any) => item.label || item.name || item.x || '');
        const values = data.map((item: any) => item.value || item.y || item.count || 0);
        
        setChartData({
          labels,
          datasets: [{
            label: config.title || 'Data',
            data: values,
            backgroundColor: chartPaletteLight,
            borderColor: chartPalette[0],
            borderWidth: 2,
            fill: chartType === 'area'
          }]
        });
      }
    } else if (widgetConfig.chartData) {
      setChartData(widgetConfig.chartData);
    }
  }, [data, widgetConfig.chartData, chartType, config.title]);
  
  // Canvas chart rendering
  useEffect(() => {
    if (!canvasRef.current || !chartData) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Get actual CSS colors from VS Code theme
    const textColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--vscode-editor-foreground')
      .trim() || '#cccccc';
    const gridColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--vscode-panel-border')
      .trim() || '#3c3c3c';
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    try {
      if (chartType === 'bar') {
        renderBarChart(ctx, canvas, chartData, textColor, gridColor, showGrid);
      } else if (chartType === 'line' || chartType === 'area') {
        renderLineChart(ctx, canvas, chartData, chartType === 'area', textColor, gridColor, showGrid);
      } else if (chartType === 'pie' || chartType === 'doughnut') {
        renderPieChart(ctx, canvas, chartData, chartType === 'doughnut', textColor, hoveredSegment);
      } else {
        renderBarChart(ctx, canvas, chartData, textColor, gridColor, showGrid);
      }
    } catch (error) {
      console.error('Chart render error:', error);
    }
  }, [chartData, chartType, showGrid, hoveredSegment]);
  
  // Handle settings save
  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = { ...localConfig, ...newConfig } as ChartWidgetConfig;
    setLocalConfig(updatedConfig);
    
    if (onUpdate) {
      onUpdate({ _config: updatedConfig });
    }
    
    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: { 
        type: 'settings-change', 
        config: updatedConfig,
        widgetId: (config as any).id,
      },
    });
    document.dispatchEvent(customEvent);
  }, [localConfig, onUpdate, config]);
  
  // Calculate totals for pie/doughnut
  const total = chartData?.datasets[0]?.data.reduce((a, b) => a + b, 0) || 0;
  
  return (
    <Widget size={size} design="default">
      <WidgetHeader style={{ justifyContent: 'space-between', padding: '8px 12px' }}>
        <WidgetTitle>{config.title || 'Chart'}</WidgetTitle>
        <SettingsToggle onClick={() => setShowSettings(!showSettings)} isOpen={showSettings} />
      </WidgetHeader>
      
      {showSettings ? (
        <WidgetSettingsPanel 
          title="Chart Settings" 
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setShowSettings(false)}
        />
      ) : (
        <>
          <WidgetContent style={{ 
            padding: '12px', 
            alignItems: 'stretch',
            flexDirection: 'column'
          }}>
            <canvas
              ref={canvasRef}
              width={500}
              height={currentSize.canvasHeight * 1.5}
              style={{ 
                width: '100%', 
                height: `${currentSize.canvasHeight}px`,
              }}
            />
          </WidgetContent>
          
          {showLegend && chartData && (chartType === 'pie' || chartType === 'doughnut') && (
            <WidgetFooter style={{ 
              flexDirection: 'column', 
              alignItems: 'flex-start', 
              gap: '4px',
              padding: '8px 12px',
            }}>
              {chartData.labels.map((label, idx) => {
                const value = chartData.datasets[0]?.data[idx] || 0;
                const percentage = ((value / total) * 100).toFixed(1);
                return (
                  <div 
                    key={idx}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      fontSize: `${currentSize.legendSize}px`,
                      cursor: 'pointer',
                      opacity: hoveredSegment === null || hoveredSegment === idx ? 1 : 0.5,
                    }}
                    onMouseEnter={() => setHoveredSegment(idx)}
                    onMouseLeave={() => setHoveredSegment(null)}
                  >
                    <span 
                      style={{ 
                        width: '12px', 
                        height: '12px', 
                        borderRadius: '2px',
                        backgroundColor: chartPalette[idx % chartPalette.length],
                      }} 
                    />
                    <Label size="sm">{label}</Label>
                    <Label size="sm" variant="muted">{percentage}%</Label>
                  </div>
                );
              })}
            </WidgetFooter>
          )}
          
          {showLegend && chartData && chartType !== 'pie' && chartType !== 'doughnut' && (
            <WidgetFooter style={{ padding: '8px 12px' }}>
              <Label size="sm" variant="muted">
                {chartData.datasets[0]?.label} • {chartData.datasets[0]?.data.length} data points
              </Label>
            </WidgetFooter>
          )}
        </>
      )}
    </Widget>
  );
};

// Bar chart renderer
function renderBarChart(
  ctx: CanvasRenderingContext2D, 
  canvas: HTMLCanvasElement, 
  data: ChartData,
  textColor: string,
  gridColor: string,
  showGrid: boolean
) {
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = canvas.width - padding.left - padding.right;
  const chartHeight = canvas.height - padding.top - padding.bottom;
  
  const dataset = data.datasets[0];
  const values = dataset.data;
  const maxValue = Math.max(...values, 1);
  
  const barWidth = (chartWidth / values.length) * 0.7;
  const barGap = (chartWidth / values.length) * 0.3;
  
  // Draw grid
  if (showGrid) {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(canvas.width - padding.right, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  
  // Draw bars
  values.forEach((value, index) => {
    const barHeight = (value / maxValue) * chartHeight;
    const x = padding.left + index * (barWidth + barGap) + barGap / 2;
    const y = canvas.height - padding.bottom - barHeight;
    
    // Bar with rounded top
    const radius = Math.min(4, barWidth / 4);
    ctx.fillStyle = chartPalette[index % chartPalette.length];
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
    ctx.fill();
    
    // Label
    ctx.fillStyle = textColor;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      truncateLabel(data.labels[index], 8), 
      x + barWidth / 2, 
      canvas.height - padding.bottom + 15
    );
  });
  
  // Y-axis labels
  ctx.fillStyle = textColor;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = Math.round((maxValue / 4) * (4 - i));
    const y = padding.top + (chartHeight / 4) * i;
    ctx.fillText(formatNumber(value), padding.left - 8, y + 4);
  }
}

// Line/Area chart renderer
function renderLineChart(
  ctx: CanvasRenderingContext2D, 
  canvas: HTMLCanvasElement, 
  data: ChartData, 
  fill: boolean,
  textColor: string,
  gridColor: string,
  showGrid: boolean
) {
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = canvas.width - padding.left - padding.right;
  const chartHeight = canvas.height - padding.top - padding.bottom;
  
  const dataset = data.datasets[0];
  const values = dataset.data;
  const maxValue = Math.max(...values, 1);
  
  const stepX = chartWidth / (values.length - 1 || 1);
  
  // Draw grid
  if (showGrid) {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(canvas.width - padding.right, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  
  // Draw area fill
  if (fill) {
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = padding.left + index * stepX;
      const y = canvas.height - padding.bottom - (value / maxValue) * chartHeight;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.lineTo(padding.left + chartWidth, canvas.height - padding.bottom);
    ctx.lineTo(padding.left, canvas.height - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = chartPaletteLight[0];
    ctx.fill();
  }
  
  // Draw line
  ctx.strokeStyle = chartPalette[0];
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  
  values.forEach((value, index) => {
    const x = padding.left + index * stepX;
    const y = canvas.height - padding.bottom - (value / maxValue) * chartHeight;
    
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  
  // Draw points
  values.forEach((value, index) => {
    const x = padding.left + index * stepX;
    const y = canvas.height - padding.bottom - (value / maxValue) * chartHeight;
    
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = chartPalette[0];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Label
    ctx.fillStyle = textColor;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      truncateLabel(data.labels[index], 8), 
      x, 
      canvas.height - padding.bottom + 15
    );
  });
  
  // Y-axis labels
  ctx.fillStyle = textColor;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = Math.round((maxValue / 4) * (4 - i));
    const y = padding.top + (chartHeight / 4) * i;
    ctx.fillText(formatNumber(value), padding.left - 8, y + 4);
  }
}

// Pie/Doughnut chart renderer
function renderPieChart(
  ctx: CanvasRenderingContext2D, 
  canvas: HTMLCanvasElement, 
  data: ChartData, 
  isDoughnut: boolean,
  textColor: string,
  hoveredSegment: number | null
) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(canvas.width, canvas.height) / 2 - 30;
  const innerRadius = isDoughnut ? radius * 0.6 : 0;
  
  const dataset = data.datasets[0];
  const values = dataset.data;
  const total = values.reduce((sum, val) => sum + val, 0);
  
  let currentAngle = -Math.PI / 2;
  
  values.forEach((value, index) => {
    const sliceAngle = (value / total) * Math.PI * 2;
    const isHovered = hoveredSegment === index;
    const scale = isHovered ? 1.05 : 1;
    
    // Draw slice
    ctx.beginPath();
    if (innerRadius > 0) {
      ctx.arc(centerX, centerY, innerRadius * scale, currentAngle, currentAngle + sliceAngle);
      ctx.arc(centerX, centerY, radius * scale, currentAngle + sliceAngle, currentAngle, true);
    } else {
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius * scale, currentAngle, currentAngle + sliceAngle);
    }
    ctx.closePath();
    
    ctx.fillStyle = chartPalette[index % chartPalette.length];
    ctx.fill();
    
    // Segment border
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    currentAngle += sliceAngle;
  });
  
  // Center text for doughnut
  if (isDoughnut && hoveredSegment !== null) {
    const value = values[hoveredSegment];
    const percentage = ((value / total) * 100).toFixed(1);
    
    ctx.fillStyle = textColor;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${percentage}%`, centerX, centerY - 8);
    
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(data.labels[hoveredSegment], centerX, centerY + 12);
  } else if (isDoughnut) {
    ctx.fillStyle = textColor;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatNumber(total), centerX, centerY - 8);
    
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Total', centerX, centerY + 12);
  }
}

// Helper functions
function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) return label;
  return label.substring(0, maxLength - 1) + '…';
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}
