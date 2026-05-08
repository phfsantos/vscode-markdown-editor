/**
 * TableWidget - Sortable, filterable data table
 * Inspired by wigggle-ui dashboard-03.tsx pattern
 * 
 * Features: sorting, filtering, pagination, column customization, row selection
 */

import React, { useState, useMemo } from 'react';
import { 
  Widget, WidgetHeader, WidgetTitle, WidgetContent, WidgetFooter,
  Button, Input, Label, Checkbox
} from '../ui';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

export interface TableColumn {
  key: string;
  header: string;
  sortable?: boolean;
  filterable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (value: any, row: any) => React.ReactNode;
}

export interface TableWidgetConfig {
  columns?: TableColumn[];
  pageSize?: number;
  enableSort?: boolean;
  enableFilter?: boolean;
  enablePagination?: boolean;
  selectable?: boolean;
  size?: 'sm' | 'md' | 'lg';
  compact?: boolean;
}

// Status badge component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusColors: Record<string, { bg: string; text: string }> = {
    active: { bg: 'rgba(75, 192, 192, 0.2)', text: 'rgba(75, 192, 192, 1)' },
    inactive: { bg: 'rgba(156, 163, 175, 0.2)', text: 'rgba(156, 163, 175, 1)' },
    pending: { bg: 'rgba(255, 206, 86, 0.2)', text: 'rgba(255, 206, 86, 1)' },
    completed: { bg: 'rgba(54, 162, 235, 0.2)', text: 'rgba(54, 162, 235, 1)' },
    error: { bg: 'rgba(255, 99, 132, 0.2)', text: 'rgba(255, 99, 132, 1)' },
  };
  
  const colors = statusColors[status.toLowerCase()] || statusColors.inactive;
  
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: '9999px',
      fontSize: '11px',
      fontWeight: 500,
      backgroundColor: colors.bg,
      color: colors.text,
    }}>
      {status}
    </span>
  );
};

export const TableWidget: React.FC<ReactWidgetProps> = ({ config, data, onUpdate }) => {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterText, setFilterText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  
  const widgetConfig = config as any as TableWidgetConfig;
  const pageSize = widgetConfig.pageSize || 10;
  const enableSort = widgetConfig.enableSort !== false;
  const enableFilter = widgetConfig.enableFilter !== false;
  const enablePagination = widgetConfig.enablePagination !== false;
  const selectable = widgetConfig.selectable || false;
  const size = widgetConfig.size || 'md';
  const compact = widgetConfig.compact || false;
  
  // Cell padding based on size
  const cellPadding = compact ? '6px 8px' : size === 'sm' ? '8px 10px' : '10px 12px';
  const fontSize = size === 'sm' ? '12px' : '13px';
  
  // Parse data
  const tableData = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.rows) return data.rows;
    return [];
  }, [data]);
  
  // Auto-generate columns from data
  const columns = useMemo<TableColumn[]>(() => {
    if (widgetConfig.columns) return widgetConfig.columns;
    
    if (tableData.length === 0) return [];
    
    const firstRow = tableData[0];
    return Object.keys(firstRow).map(key => ({
      key,
      header: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
      sortable: true,
      filterable: true
    }));
  }, [tableData, widgetConfig.columns]);
  
  // Filter data
  const filteredData = useMemo(() => {
    if (!enableFilter || !filterText) return tableData;
    
    const lowerFilter = filterText.toLowerCase();
    return tableData.filter((row: any) =>
      columns.some(col =>
        String(row[col.key] || '').toLowerCase().includes(lowerFilter)
      )
    );
  }, [tableData, filterText, columns, enableFilter]);
  
  // Sort data
  const sortedData = useMemo(() => {
    if (!sortColumn) return filteredData;
    
    return [...filteredData].sort((a: any, b: any) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      
      if (aVal === bVal) return 0;
      
      const comparison = aVal < bVal ? -1 : 1;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, sortColumn, sortDirection]);
  
  // Paginate data
  const paginatedData = useMemo(() => {
    if (!enablePagination) return sortedData;
    
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return sortedData.slice(start, end);
  }, [sortedData, currentPage, pageSize, enablePagination]);
  
  const totalPages = Math.ceil(sortedData.length / pageSize);
  
  const handleSort = (columnKey: string) => {
    if (!enableSort) return;
    
    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };
  
  const handleRowSelect = (index: number) => {
    if (!selectable) return;
    
    const newSelected = new Set(selectedRows);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedRows(newSelected);
    
    onUpdate?.({
      selectedRows: Array.from(newSelected),
      selectedData: Array.from(newSelected).map(i => sortedData[i])
    });
  };
  
  const handleSelectAll = () => {
    if (!selectable) return;
    
    if (selectedRows.size === paginatedData.length) {
      setSelectedRows(new Set());
      onUpdate?.({ selectedRows: [], selectedData: [] });
    } else {
      const allIndices = paginatedData.map((_: any, i: number) => i);
      setSelectedRows(new Set(allIndices));
      onUpdate?.({ selectedRows: allIndices, selectedData: paginatedData });
    }
  };
  
  // Render cell value with special handling for status
  const renderCellValue = (col: TableColumn, value: any, row: any) => {
    if (col.render) {
      return col.render(value, row);
    }
    
    // Auto-detect status fields and render as badge
    if (col.key.toLowerCase().includes('status') && typeof value === 'string') {
      return <StatusBadge status={value} />;
    }
    
    // Handle boolean values
    if (typeof value === 'boolean') {
      return value ? '✓' : '—';
    }
    
    // Handle numbers
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    
    return String(value || '—');
  };
  
  return (
    <Widget size={size} design="default" style={{ width: size === 'lg' ? '100%' : undefined }}>
      <WidgetHeader style={{ padding: '10px 12px', justifyContent: 'space-between' }}>
        <WidgetTitle>{config.title || 'Data Table'}</WidgetTitle>
        {selectedRows.size > 0 && (
          <Label size="sm" variant="muted">
            {selectedRows.size} selected
          </Label>
        )}
      </WidgetHeader>
      
      {enableFilter && (
        <div style={{ padding: '0 12px 8px' }}>
          <Input
            type="text"
            placeholder="🔍 Search..."
            value={filterText}
            onChange={(e) => {
              setFilterText(e.target.value);
              setCurrentPage(1);
            }}
            style={{ width: '100%' }}
          />
        </div>
      )}
      
      <WidgetContent style={{ 
        alignItems: 'stretch', 
        padding: 0,
        overflow: 'auto',
      }}>
        <table style={{ 
          width: '100%', 
          borderCollapse: 'collapse',
          fontSize,
        }}>
          <thead>
            <tr style={{ 
              borderBottom: '1px solid var(--vscode-panel-border, #3c3c3c)',
              backgroundColor: 'var(--vscode-sideBar-background, #1e1e1e)',
            }}>
              {selectable && (
                <th style={{ padding: cellPadding, width: '40px' }}>
                  <Checkbox
                    checked={selectedRows.size === paginatedData.length && paginatedData.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    padding: cellPadding,
                    textAlign: col.align || 'left',
                    width: col.width,
                    cursor: col.sortable && enableSort ? 'pointer' : 'default',
                    userSelect: 'none',
                    fontWeight: 600,
                    color: 'var(--vscode-descriptionForeground)',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {col.header}
                    {sortColumn === col.key && (
                      <span style={{ opacity: 0.7 }}>
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td 
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  style={{ 
                    padding: '24px', 
                    textAlign: 'center',
                    color: 'var(--vscode-descriptionForeground)',
                  }}
                >
                  No data available
                </td>
              </tr>
            ) : (
              paginatedData.map((row: any, rowIndex: number) => (
                <tr
                  key={rowIndex}
                  style={{
                    borderBottom: '1px solid var(--vscode-panel-border, #3c3c3c)',
                    backgroundColor: selectedRows.has(rowIndex) 
                      ? 'var(--vscode-list-activeSelectionBackground, rgba(54, 162, 235, 0.15))' 
                      : 'transparent',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!selectedRows.has(rowIndex)) {
                      e.currentTarget.style.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.05))';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!selectedRows.has(rowIndex)) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  {selectable && (
                    <td style={{ padding: cellPadding }}>
                      <Checkbox
                        checked={selectedRows.has(rowIndex)}
                        onChange={() => handleRowSelect(rowIndex)}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        padding: cellPadding,
                        textAlign: col.align || 'left',
                        color: 'var(--vscode-editor-foreground)',
                      }}
                    >
                      {renderCellValue(col, row[col.key], row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </WidgetContent>
      
      {enablePagination && totalPages > 1 && (
        <WidgetFooter style={{ 
          padding: '8px 12px', 
          justifyContent: 'space-between',
          borderTop: '1px solid var(--vscode-panel-border, #3c3c3c)',
        }}>
          <Label size="sm" variant="muted">
            {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length}
          </Label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              ⟨⟨
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              ⟨
            </Button>
            <Label size="sm" style={{ padding: '0 8px' }}>
              {currentPage} / {totalPages}
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
            >
              ⟩
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              ⟩⟩
            </Button>
          </div>
        </WidgetFooter>
      )}
    </Widget>
  );
};
