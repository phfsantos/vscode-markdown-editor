/**
 * ProductivityWidget - Interactive Task list / Todo widget
 * 
 * Inspired by wigggle-ui productivity widget
 * Features:
 * - Add/remove/toggle tasks
 * - Persistent data via code block
 * - Settings panel for customization
 * - Size variants (sm/md/lg)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Widget, WidgetHeader, WidgetContent, WidgetFooter, WidgetTitle, Label,
  Button, Input, SettingsToggle, WidgetSettingsPanel
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize } from '../ui/Widget';

export interface Task {
  id: string;
  text: string;
  completed: boolean;
  createdAt?: string;
}

export interface ProductivityWidgetConfig {
  title?: string;
  size?: WidgetSize;
  showAddButton?: boolean;
  showDeleteButton?: boolean;
  showProgress?: boolean;
  maxTasks?: number;
}

export interface ProductivityWidgetData {
  tasks: Task[];
}

// Event type for widget updates
export interface ProductivityWidgetEvent {
  type: 'task-toggle' | 'task-add' | 'task-delete' | 'settings-change';
  data: ProductivityWidgetData;
  config?: ProductivityWidgetConfig;
}

// Settings fields for the widget
const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Tasks' },
  { 
    key: 'size', 
    label: 'Size', 
    type: 'select', 
    options: [
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Medium' },
      { value: 'lg', label: 'Large' },
    ],
    defaultValue: 'sm'
  },
  { key: 'showAddButton', label: 'Show Add Button', type: 'checkbox', defaultValue: true },
  { key: 'showDeleteButton', label: 'Show Delete Button', type: 'checkbox', defaultValue: true },
  { key: 'showProgress', label: 'Show Progress', type: 'checkbox', defaultValue: true },
  { key: 'maxTasks', label: 'Max Tasks', type: 'number', min: 1, max: 100, defaultValue: 20 },
];

export const ProductivityWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  data, 
  onUpdate
}) => {
  const widgetConfig = config as unknown as ProductivityWidgetConfig;
  const widgetData = data as ProductivityWidgetData | undefined;
  
  // Initialize tasks from data or config
  const initialTasks: Task[] = widgetData?.tasks || [
    { id: '1', text: 'Review code', completed: true },
    { id: '2', text: 'Write tests', completed: false },
    { id: '3', text: 'Update docs', completed: false },
  ];
  
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [newTaskText, setNewTaskText] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<ProductivityWidgetConfig>(widgetConfig);
  
  // Config with defaults
  const title = localConfig.title || 'Tasks';
  const size = localConfig.size || 'sm';
  const showAddButton = localConfig.showAddButton !== false;
  const showDeleteButton = localConfig.showDeleteButton !== false;
  const showProgress = localConfig.showProgress !== false;
  const maxTasks = localConfig.maxTasks || 20;

  // Sync with external data changes
  useEffect(() => {
    if (widgetData?.tasks) {
      setTasks(widgetData.tasks);
    }
  }, [widgetData?.tasks]);

  // Generate unique ID
  const generateId = useCallback(() => {
    return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Emit update event (triggers save to code block)
  const emitUpdate = useCallback((
    type: ProductivityWidgetEvent['type'], 
    updatedTasks: Task[], 
    updatedConfig?: ProductivityWidgetConfig
  ) => {
    const event: ProductivityWidgetEvent = {
      type,
      data: { tasks: updatedTasks },
      config: updatedConfig || localConfig,
    };
    
    // Call onUpdate to notify parent/renderer - combine data and config
    if (onUpdate) {
      onUpdate({ ...event.data, _config: event.config });
    }
    
    // Dispatch custom event for WidgetRenderer to catch
    // Include widgetId from config so handler can find the right container
    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        ...event,
        widgetId: (config as any).id,
      },
    });
    document.dispatchEvent(customEvent);
  }, [onUpdate, localConfig, config]);

  // Handle task toggle
  const handleToggle = useCallback((id: string) => {
    const updatedTasks = tasks.map(task => 
      task.id === id ? { ...task, completed: !task.completed } : task
    );
    setTasks(updatedTasks);
    emitUpdate('task-toggle', updatedTasks);
  }, [tasks, emitUpdate]);

  // Handle task add
  const handleAddTask = useCallback(() => {
    if (!newTaskText.trim() || tasks.length >= maxTasks) return;
    
    const newTask: Task = {
      id: generateId(),
      text: newTaskText.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    };
    
    const updatedTasks = [...tasks, newTask];
    setTasks(updatedTasks);
    setNewTaskText('');
    emitUpdate('task-add', updatedTasks);
  }, [newTaskText, tasks, maxTasks, generateId, emitUpdate]);

  // Handle task delete
  const handleDeleteTask = useCallback((id: string) => {
    const updatedTasks = tasks.filter(task => task.id !== id);
    setTasks(updatedTasks);
    emitUpdate('task-delete', updatedTasks);
  }, [tasks, emitUpdate]);

  // Handle settings save
  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = { ...localConfig, ...newConfig } as ProductivityWidgetConfig;
    setLocalConfig(updatedConfig);
    emitUpdate('settings-change', tasks, updatedConfig);
  }, [localConfig, tasks, emitUpdate]);

  // Handle enter key for adding tasks
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newTaskText.trim()) {
      e.preventDefault();
      handleAddTask();
    }
  }, [newTaskText, handleAddTask]);

  const completedCount = tasks.filter(t => t.completed).length;
  const progressPercent = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <Widget size={size} design="default" style={{ position: 'relative', minHeight: size === 'lg' ? '360px' : '200px' }}>
      <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <WidgetTitle>{title}</WidgetTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {showProgress && (
            <Label variant="muted" size="sm">{completedCount}/{tasks.length}</Label>
          )}
          <SettingsToggle 
            isOpen={isSettingsOpen} 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)} 
          />
        </div>
      </WidgetHeader>

      {/* Settings Panel */}
      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Task Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* Progress Bar */}
      {showProgress && tasks.length > 0 && (
        <div style={{ 
          height: '4px', 
          background: 'var(--vscode-progressBar-background, #3c3c3c)',
          borderRadius: '2px',
          marginBottom: '8px',
          overflow: 'hidden',
        }}>
          <div style={{ 
            height: '100%', 
            width: `${progressPercent}%`,
            background: 'var(--vscode-testing-iconPassed, #4caf50)',
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      <WidgetContent style={{ 
        flexDirection: 'column', 
        alignItems: 'stretch',
        gap: '4px',
        overflow: 'auto',
        flex: 1,
      }}>
        {tasks.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '20px',
            color: 'var(--vscode-descriptionForeground)',
          }}>
            No tasks yet. Add one below!
          </div>
        ) : (
          tasks.map(task => (
            <div
              key={task.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                borderRadius: '6px',
                background: task.completed 
                  ? 'rgba(76, 175, 80, 0.1)' 
                  : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              <button
                onClick={() => handleToggle(task.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '24px',
                  height: '24px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: '16px',
                  color: task.completed 
                    ? 'var(--vscode-testing-iconPassed, #4caf50)' 
                    : 'var(--vscode-descriptionForeground)',
                  transition: 'transform 0.15s',
                }}
                title={task.completed ? 'Mark incomplete' : 'Mark complete'}
              >
                {task.completed ? '✓' : '○'}
              </button>
              
              <Label 
                variant={task.completed ? 'muted' : 'default'}
                style={{ 
                  textDecoration: task.completed ? 'line-through' : 'none',
                  flex: 1,
                  opacity: task.completed ? 0.7 : 1,
                }}
              >
                {task.text}
              </Label>
              
              {showDeleteButton && (
                <button
                  onClick={() => handleDeleteTask(task.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: 'var(--vscode-testing-iconFailed, #f44336)',
                    opacity: 0.5,
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '0.5'}
                  title="Delete task"
                >
                  ✕
                </button>
              )}
            </div>
          ))
        )}
      </WidgetContent>

      {/* Add Task Section */}
      {showAddButton && tasks.length < maxTasks && (
        <WidgetFooter style={{ gap: '8px', marginTop: '8px' }}>
          <Input
            type="text"
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a task..."
            style={{ flex: 1 }}
          />
          <Button 
            size="sm" 
            onClick={handleAddTask}
            disabled={!newTaskText.trim()}
          >
            Add
          </Button>
        </WidgetFooter>
      )}

      {tasks.length >= maxTasks && (
        <div style={{ 
          fontSize: '11px', 
          color: 'var(--vscode-descriptionForeground)',
          textAlign: 'center',
          marginTop: '4px',
        }}>
          Maximum tasks reached ({maxTasks})
        </div>
      )}
    </Widget>
  );
};
