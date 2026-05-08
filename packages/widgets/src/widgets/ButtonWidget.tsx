/**
 * ButtonWidget - Interactive action button for triggering events and commands
 * 
 * Inspired by wigggle-ui dashboard-05, dashboard-06, productivity-02 patterns
 * 
 * Features:
 * - Customizable button label and styling
 * - Action types: value (simple text/number), data (JSON for VS Code commands)
 * - Event-based communication with other widgets and VS Code
 * - Settings panel for configuration
 * - Size variants (sm/md/lg)
 * - Button variants (default/outline/ghost/secondary/destructive)
 * 
 * Usage examples:
 * 
 * Simple value action:
 * ```widget
 * type: button
 * title: Quick Actions
 * label: Add Task
 * action: add-task
 * value: New Task
 * ```
 * 
 * VS Code command action:
 * ```widget
 * type: button
 * title: VS Code Actions
 * label: Open Settings
 * action: vscode-command
 * data: {"command": "workbench.action.openSettings"}
 * ```
 * 
 * Connect to productivity widget:
 * ```widget
 * type: button
 * title: Add Task Button
 * label: Add New Task
 * action: widget-action
 * targetWidget: productivity
 * data: {"action": "add-task", "text": "New task from button"}
 * ```
 */

import React, { useState, useCallback } from 'react';
import { 
  Widget, WidgetHeader, WidgetContent, WidgetFooter, Label,
  Button, Input, Textarea, SettingsToggle, WidgetSettingsPanel,
  useSettingsContext
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize } from '../ui/Widget';

// =====================
// TYPE DEFINITIONS
// =====================

export type ButtonActionType = 'value' | 'data' | 'vscode-command' | 'widget-action';
export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive';

export interface ButtonWidgetConfig {
  title?: string;
  size?: WidgetSize;
  label?: string;
  action?: string;
  actionType?: ButtonActionType;
  value?: string | number;
  data?: Record<string, any> | string;
  targetWidget?: string;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  showInput?: boolean;
  inputPlaceholder?: string;
  inputLabel?: string;
  design?: 'default' | 'minimal' | 'glass';
}

export interface ButtonWidgetData {
  lastValue?: string | number;
  inputValue?: string;
  lastExecuted?: string;
  executionCount?: number;
}

// =====================
// SETTINGS CONFIGURATION
// =====================

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Button Widget' },
  { key: 'label', label: 'Button Label', type: 'text', placeholder: 'Click Me' },
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
  { 
    key: 'variant', 
    label: 'Button Style', 
    type: 'select', 
    options: [
      { value: 'default', label: 'Default (Primary)' },
      { value: 'outline', label: 'Outline' },
      { value: 'ghost', label: 'Ghost' },
      { value: 'secondary', label: 'Secondary' },
      { value: 'destructive', label: 'Destructive (Red)' },
    ],
    defaultValue: 'default'
  },
  { key: 'action', label: 'Action Name', type: 'text', placeholder: 'my-action' },
  { 
    key: 'actionType', 
    label: 'Action Type', 
    type: 'select', 
    options: [
      { value: 'value', label: 'Simple Value' },
      { value: 'data', label: 'JSON Data' },
      { value: 'vscode-command', label: 'VS Code Command' },
      { value: 'widget-action', label: 'Widget Action' },
    ],
    defaultValue: 'value'
  },
  { key: 'value', label: 'Value (for simple actions)', type: 'text', placeholder: 'Action value' },
  { key: 'targetWidget', label: 'Target Widget Type', type: 'text', placeholder: 'productivity' },
  { key: 'fullWidth', label: 'Full Width Button', type: 'checkbox', defaultValue: true },
  { key: 'showInput', label: 'Show Input Field', type: 'checkbox', defaultValue: false },
  { key: 'inputPlaceholder', label: 'Input Placeholder', type: 'text', placeholder: 'Enter value...' },
  { key: 'inputLabel', label: 'Input Label', type: 'text', placeholder: 'Value' },
  { 
    key: 'design', 
    label: 'Design', 
    type: 'select', 
    options: [
      { value: 'default', label: 'Default' },
      { value: 'minimal', label: 'Minimal' },
      { value: 'glass', label: 'Glass' },
    ],
    defaultValue: 'default'
  },
];

// =====================
// ICON COMPONENTS
// =====================

const PlayIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5,3 19,12 5,21" fill="currentColor" stroke="none" />
  </svg>
);

const CheckIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20,6 9,17 4,12" />
  </svg>
);

const SendIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22,2 15,22 11,13 2,9" />
  </svg>
);

// =====================
// DATA EDITOR COMPONENT (for settings panel)
// =====================

interface DataEditorProps {
  value: Record<string, any> | string | undefined;
  onChange: (value: Record<string, any> | string) => void;
}

/**
 * DataEditor - Custom JSON data editor for settings panel
 * Uses useSettingsContext to properly update values and trigger hasChanges
 */
const DataEditor: React.FC<DataEditorProps> = ({ value, onChange }) => {
  // Use the settings context to update values through the panel's state
  const { onFieldChange, markChanged } = useSettingsContext();
  
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    let parsedValue: Record<string, any> | string;
    try {
      parsedValue = JSON.parse(newValue);
    } catch {
      // Keep as string if invalid JSON
      parsedValue = newValue;
    }
    // Update through context so panel's localValues gets the new value
    // This ensures the value is included when onSave is called
    onFieldChange('data', parsedValue);
    // Also call parent's onChange for immediate local state update
    onChange(parsedValue);

		// Mark as changed so save button enables
    markChanged();
  };
  
  const displayValue = typeof value === 'string' 
    ? value 
    : JSON.stringify(value || {}, null, 2);
  
  return (
    <div style={{ marginTop: '8px' }}>
      <Label variant="muted" size="sm" style={{ marginBottom: '4px', display: 'block' }}>
        Action Data (JSON)
      </Label>
      <Textarea
        value={displayValue}
        onChange={handleChange}
        placeholder='{"command": "workbench.action.openSettings"}'
        rows={4}
        style={{ fontFamily: 'monospace', fontSize: '12px' }}
      />
    </div>
  );
};

// =====================
// WIDGET COMPONENT
// =====================

export const ButtonWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  data, 
  onUpdate
}) => {
  // Cast props to typed interfaces
  const widgetConfig = config as unknown as ButtonWidgetConfig;
  const widgetData = data as ButtonWidgetData | undefined;
  
  // =====================
  // STATE
  // =====================
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<ButtonWidgetConfig>(widgetConfig);
  const [inputValue, setInputValue] = useState(widgetData?.inputValue || '');
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastExecuted, setLastExecuted] = useState(widgetData?.lastExecuted || '');
  const [executionCount, setExecutionCount] = useState(widgetData?.executionCount || 0);
  
  // Config with defaults
  const title = localConfig.title || '';
  const label = localConfig.label || 'Click Me';
  const size = localConfig.size || 'sm';
  const variant = localConfig.variant || 'default';
  const action = localConfig.action || 'button-click';
  const actionType = localConfig.actionType || 'value';
  const value = localConfig.value;
  const fullWidth = localConfig.fullWidth !== false;
  const showInput = localConfig.showInput === true;
  const inputPlaceholder = localConfig.inputPlaceholder || 'Enter value...';
  const inputLabel = localConfig.inputLabel || 'Value';
  const design = localConfig.design || 'default';
  const targetWidget = localConfig.targetWidget;

  // Parse data from config (can be JSON string or object)
  const parseData = useCallback((): Record<string, any> | null => {
    const dataConfig = localConfig.data;
    if (!dataConfig) return null;
    
    if (typeof dataConfig === 'string') {
      try {
        return JSON.parse(dataConfig);
      } catch {
        // If it's a string that fails JSON parsing, try to treat it as a command name
        // This allows simple command strings like "workbench.action.openSettings"
        if (dataConfig.includes('.') || dataConfig.match(/^[a-zA-Z]/)) {
          return { command: dataConfig };
        }
        return { raw: dataConfig };
      }
    }
    return dataConfig;
  }, [localConfig.data]);

  // =====================
  // EVENT HANDLERS
  // =====================
  
  // Emit update event (triggers save to code block)
  const emitUpdate = useCallback((
    updatedData: ButtonWidgetData, 
    updatedConfig?: ButtonWidgetConfig
  ) => {
    const payload = {
      data: updatedData,
      config: updatedConfig || localConfig,
    };
  
    // Call onUpdate to notify parent/renderer
    if (onUpdate) {
      onUpdate({ ...payload.data, _config: payload.config });
    }
  
    // Dispatch custom event for WidgetRenderer to catch
    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'data-change',
        ...payload,
        widgetId: (config as any).id,
      },
    });
    document.dispatchEvent(customEvent);
  }, [onUpdate, localConfig, config]);

  // Execute button action
  const handleButtonClick = useCallback(async () => {
    setIsExecuting(true);
    const now = new Date().toISOString();
    const newCount = executionCount + 1;
    
    try {
      const parsedData = parseData();
      const effectiveValue = showInput ? inputValue : value;
      
      // Build the action payload
      const actionPayload = {
        action,
        actionType,
        value: effectiveValue,
        data: parsedData,
        targetWidget,
        inputValue: showInput ? inputValue : undefined,
        timestamp: now,
        widgetId: (config as any).id,
      };
      
      console.log('[ButtonWidget] Executing action:', actionPayload);
      
      // Dispatch the button action event
      const actionEvent = new CustomEvent('button-action', {
        bubbles: true,
        detail: actionPayload,
      });
      document.dispatchEvent(actionEvent);
      
      // For VS Code commands, also send to extension host
      if (actionType === 'vscode-command' && parsedData?.command) {
        const vscode = (window as any).vscode;
        if (vscode && typeof vscode.postMessage === 'function') {
          vscode.postMessage({
            command: 'widget-action',
            type: 'vscode-command',
            vscodeCommand: parsedData.command,
            args: parsedData.args || [],
            widgetId: (config as any).id,
          });
          console.log('[ButtonWidget] Sent VS Code command:', parsedData.command);
        }
      }
      
      // For widget actions, dispatch a targeted event
      if (actionType === 'widget-action' && targetWidget) {
        const widgetActionEvent = new CustomEvent('widget-to-widget-action', {
          bubbles: true,
          detail: {
            sourceWidget: 'button',
            targetWidget,
            action: parsedData?.action || action,
            data: parsedData,
            value: effectiveValue,
            timestamp: now,
          },
        });
        document.dispatchEvent(widgetActionEvent);
        console.log('[ButtonWidget] Sent widget-to-widget action:', targetWidget);
      }
      
      // Update local state
      setLastExecuted(now);
      setExecutionCount(newCount);
      
      // Persist the execution data
      emitUpdate({
        lastValue: effectiveValue,
        inputValue: showInput ? inputValue : undefined,
        lastExecuted: now,
        executionCount: newCount,
      });
      
      // Visual feedback
      setTimeout(() => setIsExecuting(false), 300);
      
    } catch (error) {
      console.error('[ButtonWidget] Action failed:', error);
      setIsExecuting(false);
    }
  }, [
    action, actionType, value, inputValue, showInput, targetWidget,
    parseData, executionCount, config, emitUpdate
  ]);

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
  }, []);

  // Handle input submit (Enter key)
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleButtonClick();
    }
  }, [handleButtonClick]);

  // Handle settings save
  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = { ...localConfig, ...newConfig } as ButtonWidgetConfig;
    setLocalConfig(updatedConfig);
    emitUpdate({
      lastValue: widgetData?.lastValue,
      inputValue,
      lastExecuted,
      executionCount,
    }, updatedConfig);
  }, [localConfig, inputValue, lastExecuted, executionCount, widgetData, emitUpdate]);

  // =====================
  // RENDER HELPERS
  // =====================
  
  const getButtonIcon = () => {
    if (isExecuting) return <CheckIcon size={16} />;
    if (actionType === 'vscode-command') return <PlayIcon size={16} />;
    if (showInput) return <SendIcon size={16} />;
    return null;
  };

  // =====================
  // RENDER
  // =====================
  
  return (
    <Widget size={size} design={design} style={{ position: 'relative' }}>
      {/* Header - only show if title is provided */}
      {title && (
        <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Label variant="default" size="md">{title}</Label>
          <SettingsToggle 
            isOpen={isSettingsOpen} 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)} 
          />
        </WidgetHeader>
      )}
      
      {/* Settings Toggle in minimal mode (no header) */}
      {!title && (
        <div style={{ position: 'absolute', top: '4px', right: '4px', zIndex: 10 }}>
          <SettingsToggle 
            isOpen={isSettingsOpen} 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)} 
          />
        </div>
      )}

      {/* Settings Panel */}
      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Button Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
          onChildChange={(key, value) => {
            // Update localConfig when children change values
            setLocalConfig(prev => ({ ...prev, [key]: value }));
          }}
        >
          {/* Custom data editor - use onChildChange to notify parent of changes */}
          <DataEditor 
            value={localConfig.data}
            onChange={(newData) => {
              setLocalConfig(prev => ({ ...prev, data: newData }));
            }}
          />
        </WidgetSettingsPanel>
      )}

      <WidgetContent style={{ flexDirection: 'column', gap: '12px', padding: showInput ? '8px' : '4px' }}>
        {/* Optional Input Field */}
        {showInput && (
          <div style={{ width: '100%' }}>
            {inputLabel && (
              <Label variant="muted" size="sm" style={{ marginBottom: '4px', display: 'block' }}>
                {inputLabel}
              </Label>
            )}
            <Input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              placeholder={inputPlaceholder}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {/* Main Action Button */}
        <Button
          variant={variant}
          size={size === 'lg' ? 'lg' : size === 'md' ? 'md' : 'sm'}
          onClick={handleButtonClick}
          disabled={isExecuting}
          style={{
            width: fullWidth ? '100%' : 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
            opacity: isExecuting ? 0.8 : 1,
          }}
        >
          {getButtonIcon()}
          {label}
        </Button>
      </WidgetContent>

      {/* Footer with execution info */}
      {executionCount > 0 && (
        <WidgetFooter style={{ justifyContent: 'space-between', padding: '4px 8px' }}>
          <Label variant="muted" size="sm">
            Executed: {executionCount}x
          </Label>
          {lastExecuted && (
            <Label variant="muted" size="sm">
              {new Date(lastExecuted).toLocaleTimeString()}
            </Label>
          )}
        </WidgetFooter>
      )}
    </Widget>
  );
};
