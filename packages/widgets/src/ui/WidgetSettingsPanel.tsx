/**
 * WidgetSettingsPanel - Modal settings panel for widget configuration
 * 
 * Opens as a centered modal overlay to allow users to configure widget settings
 * Uses fixed positioning to escape overflow:hidden containers
 * Emits events when settings change to trigger save to code block
 */

import React, { useState, useCallback, useRef, createContext, useContext, useEffect } from 'react';
import { Button } from './Button';
import { Input, Select, Checkbox } from './Input';

/**
 * Context for settings panel to allow children to signal changes
 */
interface SettingsContextValue {
  markChanged: () => void;
  onFieldChange: (key: string, value: any) => void;
  getFieldValue: (key: string) => any;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Hook for children to access settings context
 * Use this in custom children to trigger change detection and access field values
 */
export const useSettingsContext = (): SettingsContextValue => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettingsContext must be used within WidgetSettingsPanel');
  }
  return context;
};

export interface SettingsField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'color';
  options?: { value: string; label: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: any;
  helpText?: string;
}

export interface WidgetSettingsPanelProps {
  title: string;
  // Fields-based approach
  fields?: SettingsField[];
  values?: Record<string, any>;
  onSave?: (values: Record<string, any>) => void;
  onClose?: () => void;
  // Children-based approach (simpler for custom forms)
  children?: React.ReactNode;
  // Callback when children change values - allows parent to track changes
  onChildChange?: (key: string, value: any) => void;
}

/**
 * Settings Modal Content - the actual modal UI
 */
const SettingsModalContent: React.FC<WidgetSettingsPanelProps & {
  localValues: Record<string, any>;
  hasChanges: boolean;
  onFieldChange: (key: string, value: any) => void;
  onSaveClick: () => void;
  onCancelClick: () => void;
}> = ({
  title,
  fields,
  children,
  localValues,
  hasChanges,
  onFieldChange,
  onSaveClick,
  onCancelClick,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle backdrop click - use native handler to ensure it works
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCancelClick();
  }, [onCancelClick]);

  // Prevent keyboard events from affecting Vditor
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    // Allow Escape to close
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancelClick();
    }
  }, [onCancelClick]);


  const renderField = (field: SettingsField) => {
    const value = localValues[field.key] ?? field.defaultValue ?? '';

    switch (field.type) {
      case 'select':
        return (
          <Select
            value={value}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        );

      case 'checkbox':
        return (
          <Checkbox
            checked={!!value}
            onChange={(e) => onFieldChange(field.key, e.target.checked)}
          />
        );

      case 'number':
        return (
          <Input
            type="number"
            value={value}
            min={field.min}
            max={field.max}
            step={field.step}
            placeholder={field.placeholder}
            onChange={(e) => onFieldChange(field.key, parseFloat(e.target.value) || 0)}
          />
        );

      case 'color':
        return (
          <Input
            type="color"
            value={value}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
            style={{ width: '60px', padding: '2px' }}
          />
        );

      default:
        return (
          <Input
            type="text"
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
          />
        );
    }
  };

  // Handle save button click
  const handleSaveButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSaveClick();
  }, [onSaveClick]);

  // Handle cancel button click
  const handleCancelButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCancelClick();
  }, [onCancelClick]);

  // Handle X button click
  const handleCloseButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCancelClick();
  }, [onCancelClick]);

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 9998,
        }}
        onClick={handleBackdropClick}
      />
      
      {/* Modal */}
      <div
        ref={panelRef}
        className="widget-settings-modal"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '320px',
          maxWidth: '90vw',
          maxHeight: '80vh',
          background: 'var(--vscode-editorWidget-background, #252526)',
          border: '1px solid var(--vscode-panel-border, #454545)',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--vscode-panel-border, #454545)',
            background: 'var(--vscode-sideBar-background, #1e1e1e)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '14px' }}>⚙️ {title}</span>
          <Button variant="ghost" size="icon" onClick={handleCloseButtonClick}>
            ✕
          </Button>
        </div>

        {/* Content */}
        <div
          style={{
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {/* Always render fields first */}
          {fields?.map((field) => (
            <div key={field.key}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--vscode-editor-foreground, #cccccc)',
                }}
              >
                {field.label}
              </label>
              {renderField(field)}
              {field.helpText && (
                <small
                  style={{
                    display: 'block',
                    marginTop: '4px',
                    fontSize: '11px',
                    color: 'var(--vscode-descriptionForeground, #8b8b8b)',
                  }}
                >
                  {field.helpText}
                </small>
              )}
            </div>
          ))}
          {/* Then render any custom children (for specialized inputs) */}
          {children}
        </div>

        {/* Footer - show when using fields OR children */}
        {(fields || children) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              padding: '12px 16px',
              borderTop: '1px solid var(--vscode-panel-border, #454545)',
              background: 'var(--vscode-sideBar-background, #1e1e1e)',
              flexShrink: 0,
            }}
          >
            <Button variant="secondary" size="sm" onClick={handleCancelButtonClick}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveButtonClick} disabled={!hasChanges}>
              Save
            </Button>
          </div>
        )}
      </div>
    </>
  );
};

export const WidgetSettingsPanel: React.FC<WidgetSettingsPanelProps> = ({
  title,
  fields,
  values = {},
  onSave,
  onClose,
  children,
  onChildChange,
}) => {
  const [localValues, setLocalValues] = useState<Record<string, any>>(values);
  const [hasChanges, setHasChanges] = useState(false);
  // Track the initial values to detect truly external changes vs our own updates
  const initialValuesRef = useRef<string>(JSON.stringify(values));

  // Sync localValues when values prop changes from an external source
  // Only reset if the values are genuinely different from what we're tracking
  useEffect(() => {
    const valuesStr = JSON.stringify(values);
    // Only sync if the external values are different from what we last set
    // and different from current localValues (to avoid resetting during our own updates)
    const localValuesStr = JSON.stringify(localValues);
    if (valuesStr !== localValuesStr && valuesStr !== initialValuesRef.current) {
      setLocalValues(values);
      setHasChanges(false);
      initialValuesRef.current = valuesStr;
    }
  }, [values, localValues]);

  const handleChange = useCallback((key: string, value: any) => {
    setLocalValues(prev => {
      const newValues = { ...prev, [key]: value };
      setHasChanges(true);
      // Also notify parent if they want to track changes
      onChildChange?.(key, value);
      return newValues;
    });
  }, [onChildChange]);

  // Mark as changed (for children that manage their own state)
  const markChanged = useCallback(() => {
    setHasChanges(true);
  }, []);

  // Get a field value (for children that need to read values)
  const getFieldValue = useCallback((key: string) => {
    return localValues[key];
  }, [localValues]);

  const handleSave = useCallback(() => {
    onSave?.(localValues);
    setHasChanges(false);
    onClose?.();
  }, [localValues, onSave, onClose]);

  const handleCancel = useCallback(() => {
    setLocalValues(values);
    setHasChanges(false);
    onClose?.();
  }, [values, onClose]);

  // Create context value for children
  const contextValue: SettingsContextValue = {
    markChanged,
    onFieldChange: handleChange,
    getFieldValue,
  };

  // Render directly without portal - use fixed positioning to visually escape containers
  // This keeps React events working within the Shadow DOM
  return (
    <SettingsContext.Provider value={contextValue}>
      <SettingsModalContent
        title={title}
        fields={fields}
        children={children}
        localValues={localValues}
        hasChanges={hasChanges}
        onFieldChange={handleChange}
        onSaveClick={handleSave}
        onCancelClick={handleCancel}
      />
    </SettingsContext.Provider>
  );
};

/**
 * Settings toggle button for widgets
 */
export interface SettingsToggleProps {
  onClick: () => void;
  isOpen: boolean;
}

export const SettingsToggle: React.FC<SettingsToggleProps> = ({ onClick, isOpen }) => {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title="Widget Settings"
      style={{
        opacity: isOpen ? 1 : 0.6,
        transform: isOpen ? 'rotate(90deg)' : 'none',
        transition: 'all 0.2s ease',
      }}
    >
      ⚙️
    </Button>
  );
};
