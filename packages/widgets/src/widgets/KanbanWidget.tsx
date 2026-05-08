/**
 * KanbanWidget - Drag-and-drop Kanban board
 * 
 * Features: multiple columns, drag-drop cards, card actions
 */

import React, { useState } from 'react';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  assignee?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
  color?: string;
  limit?: number;
}

export interface KanbanWidgetConfig {
  columns?: KanbanColumn[];
  enableDragDrop?: boolean;
  enableCardActions?: boolean;
}

export const KanbanWidget: React.FC<ReactWidgetProps> = ({ config, data, onUpdate }) => {
  const widgetConfig = config as any as KanbanWidgetConfig;
  
  // Initialize columns from config or data
  const initialColumns: KanbanColumn[] = useMemo(() => {
    if (data && Array.isArray(data)) return data;
    if (data && data.columns) return data.columns;
    if (widgetConfig.columns) return widgetConfig.columns;
    
    return [
      { id: 'todo', title: 'To Do', cards: [] },
      { id: 'in-progress', title: 'In Progress', cards: [] },
      { id: 'done', title: 'Done', cards: [] }
    ];
  }, [data, widgetConfig.columns]);
  
  const [columns, setColumns] = useState<KanbanColumn[]>(initialColumns);
  const [draggedCard, setDraggedCard] = useState<{ card: KanbanCard; fromColumnId: string } | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  
  const enableDragDrop = widgetConfig.enableDragDrop !== false;
  const enableCardActions = widgetConfig.enableCardActions !== false;
  
  const handleDragStart = (card: KanbanCard, columnId: string) => {
    if (!enableDragDrop) return;
    setDraggedCard({ card, fromColumnId: columnId });
  };
  
  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    if (!enableDragDrop) return;
    e.preventDefault();
    setDragOverColumnId(columnId);
  };
  
  const handleDragLeave = () => {
    setDragOverColumnId(null);
  };
  
  const handleDrop = (e: React.DragEvent, toColumnId: string) => {
    if (!enableDragDrop || !draggedCard) return;
    
    e.preventDefault();
    
    const { card, fromColumnId } = draggedCard;
    
    if (fromColumnId === toColumnId) {
      setDraggedCard(null);
      setDragOverColumnId(null);
      return;
    }
    
    // Remove card from source column
    const newColumns = columns.map(col => {
      if (col.id === fromColumnId) {
        return {
          ...col,
          cards: col.cards.filter(c => c.id !== card.id)
        };
      }
      if (col.id === toColumnId) {
        return {
          ...col,
          cards: [...col.cards, card]
        };
      }
      return col;
    });
    
    setColumns(newColumns);
    setDraggedCard(null);
    setDragOverColumnId(null);
    
    onUpdate?.({ columns: newColumns });
  };
  
  const handleAddCard = (columnId: string) => {
    const newCard: KanbanCard = {
      id: `card-${Date.now()}`,
      title: 'New Card',
      description: 'Add description...'
    };
    
    const newColumns = columns.map(col => {
      if (col.id === columnId) {
        return {
          ...col,
          cards: [...col.cards, newCard]
        };
      }
      return col;
    });
    
    setColumns(newColumns);
    onUpdate?.({ columns: newColumns });
  };
  
  const handleDeleteCard = (columnId: string, cardId: string) => {
    const newColumns = columns.map(col => {
      if (col.id === columnId) {
        return {
          ...col,
          cards: col.cards.filter(c => c.id !== cardId)
        };
      }
      return col;
    });
    
    setColumns(newColumns);
    onUpdate?.({ columns: newColumns });
  };
  
  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high': return 'var(--widget-error)';
      case 'medium': return 'var(--widget-warning)';
      case 'low': return 'var(--widget-success)';
      default: return 'var(--widget-text-muted)';
    }
  };
  
  return (
    <div className="widget-container kanban-widget">
      <h3>{config.title || 'Kanban Board'}</h3>
      
      <div className="kanban-board" style={{
        display: 'flex',
        gap: '16px',
        padding: '16px',
        overflowX: 'auto'
      }}>
        {columns.map(column => (
          <div
            key={column.id}
            className="kanban-column"
            style={{
              minWidth: '280px',
              backgroundColor: 'var(--widget-card-bg)',
              borderRadius: '4px',
              padding: '8px',
              border: dragOverColumnId === column.id ? '2px solid var(--widget-primary)' : '1px solid var(--widget-border)'
            }}
            onDragOver={(e) => handleDragOver(e, column.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, column.id)}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
              padding: '8px',
              borderBottom: '2px solid var(--widget-border)'
            }}>
              <h4 style={{ margin: 0, color: column.color }}>
                {column.title}
                <span style={{
                  marginLeft: '8px',
                  fontSize: '12px',
                  color: 'var(--widget-text-muted)'
                }}>
                  ({column.cards.length}{column.limit ? `/${column.limit}` : ''})
                </span>
              </h4>
              {enableCardActions && (
                <button
                  className="widget-button"
                  onClick={() => handleAddCard(column.id)}
                  style={{ fontSize: '18px', padding: '2px 8px' }}
                >
                  +
                </button>
              )}
            </div>
            
            <div className="kanban-cards" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {column.cards.map(card => (
                <div
                  key={card.id}
                  className="kanban-card widget-card"
                  draggable={enableDragDrop}
                  onDragStart={() => handleDragStart(card, column.id)}
                  style={{
                    padding: '12px',
                    cursor: enableDragDrop ? 'grab' : 'default',
                    opacity: draggedCard?.card.id === card.id ? 0.5 : 1
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                        {card.title}
                      </div>
                      {card.description && (
                        <div style={{
                          fontSize: '12px',
                          color: 'var(--widget-text-muted)',
                          marginBottom: '8px'
                        }}>
                          {card.description}
                        </div>
                      )}
                      
                      {card.tags && card.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {card.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: '10px',
                                padding: '2px 6px',
                                backgroundColor: 'var(--widget-selection)',
                                borderRadius: '3px'
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '8px',
                        fontSize: '11px'
                      }}>
                        {card.priority && (
                          <span style={{ color: getPriorityColor(card.priority) }}>
                            ● {card.priority}
                          </span>
                        )}
                        {card.assignee && (
                          <span style={{ color: 'var(--widget-text-secondary)' }}>
                            @{card.assignee}
                          </span>
                        )}
                        {card.dueDate && (
                          <span style={{ color: 'var(--widget-text-muted)' }}>
                            {card.dueDate}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {enableCardActions && (
                      <button
                        onClick={() => handleDeleteCard(column.id, card.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--widget-error)',
                          cursor: 'pointer',
                          fontSize: '16px',
                          padding: '0 4px'
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Add useMemo import
function useMemo<T>(factory: () => T, deps: React.DependencyList): T {
  const ref = React.useRef<{ value: T; deps: React.DependencyList }>();
  
  if (!ref.current || !deps.every((dep, i) => Object.is(dep, ref.current!.deps[i]))) {
    ref.current = { value: factory(), deps };
  }
  
  return ref.current.value;
}
