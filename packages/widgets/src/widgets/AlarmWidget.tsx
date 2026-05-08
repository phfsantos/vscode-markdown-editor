/**
 * AlarmWidget - Manage multiple alarms with sound and VS Code notifications
 * 
 * Based on wigggle-ui clock-10.tsx alarm widget pattern
 * Features:
 * - Multiple configurable alarms with enable/disable toggles
 * - Sound notification when alarm triggers (using simple-notification-sounds)
 * - VS Code notification when alarm goes off
 * - Settings panel for customization
 * - Size variants (sm/md/lg)
 * - Persistent alarm state via code block
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { playSuccess } from 'simple-notification-sounds';
import { 
  Widget, WidgetHeader, WidgetContent, WidgetFooter, Label,
  Button, Input, SettingsToggle, WidgetSettingsPanel
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize } from '../ui/Widget';

// =====================
// TYPE DEFINITIONS
// =====================

export interface Alarm {
  id: string;
  time: string; // HH:MM format (24h)
  label: string;
  enabled: boolean;
  triggered?: boolean; // Track if alarm has triggered today
}

export interface AlarmWidgetConfig {
  title?: string;
  size?: WidgetSize;
  design?: 'default' | 'minimal' | 'glass';
  maxAlarms?: number;
  use24Hour?: boolean;
}

export interface AlarmWidgetData {
  alarms: Alarm[];
}

// =====================
// SETTINGS CONFIGURATION
// =====================

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Alarms' },
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
  { 
    key: 'maxAlarms', 
    label: 'Max Alarms', 
    type: 'number', 
    min: 1, 
    max: 20, 
    defaultValue: 10 
  },
  { 
    key: 'use24Hour', 
    label: 'Use 24-Hour Format', 
    type: 'checkbox', 
    defaultValue: false 
  },
];

// =====================
// ICON COMPONENTS (SVG)
// =====================

const AlarmClockIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2" />
    <path d="M5 3 2 6" />
    <path d="m22 6-3-3" />
    <path d="M6.38 18.7 4 21" />
    <path d="M17.64 18.67 20 21" />
  </svg>
);

const PlusIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

const BellIcon: React.FC<{ size?: number; ringing?: boolean }> = ({ size = 16, ringing }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    style={ringing ? { animation: 'ring 0.5s ease infinite' } : undefined}
  >
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

// =====================
// SWITCH COMPONENT
// =====================

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

const Switch: React.FC<SwitchProps> = ({ checked, onChange, disabled, id }) => {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      style={{
        position: 'relative',
        width: '36px',
        height: '20px',
        borderRadius: '10px',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: checked 
          ? 'var(--vscode-button-background, #0e639c)' 
          : 'var(--vscode-input-background, #3c3c3c)',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.2s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: checked ? '18px' : '2px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          backgroundColor: 'var(--vscode-button-foreground, white)',
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  );
};

// =====================
// UTILITY FUNCTIONS
// =====================

function generateAlarmId(): string {
  return `alarm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function formatTime12h(time24: string): string {
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

function getCurrentTime24h(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

// =====================
// WIDGET COMPONENT
// =====================

export const AlarmWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  data, 
  onUpdate
}) => {
  // Cast props to typed interfaces
  const widgetConfig = config as unknown as AlarmWidgetConfig;
  const widgetData = data as AlarmWidgetData | undefined;
  
  // =====================
  // STATE
  // =====================
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<AlarmWidgetConfig>(widgetConfig);
  const [isAddingAlarm, setIsAddingAlarm] = useState(false);
  const [newAlarmTime, setNewAlarmTime] = useState('');
  const [newAlarmLabel, setNewAlarmLabel] = useState('');
  const [ringingAlarmId, setRingingAlarmId] = useState<string | null>(null);
  
  // Alarm-specific state
  const defaultAlarms: Alarm[] = [
    { id: 'default-1', time: '07:00', label: 'Morning', enabled: true },
    { id: 'default-2', time: '12:30', label: 'Lunch', enabled: false },
    { id: 'default-3', time: '17:30', label: 'End of day', enabled: false },
  ];
  
  const [alarms, setAlarms] = useState<Alarm[]>(widgetData?.alarms ?? defaultAlarms);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCheckedMinute = useRef<string>('');
  
  // Config with defaults
  const title = localConfig.title || 'Alarms';
  const size = localConfig.size || 'sm';
  const design = localConfig.design || 'default';
  const maxAlarms = localConfig.maxAlarms || 10;
  const use24Hour = localConfig.use24Hour ?? false;

  // =====================
  // EFFECTS
  // =====================
  
  // Sync with external data changes
  useEffect(() => {
    if (widgetData?.alarms && Array.isArray(widgetData.alarms)) {
      setAlarms(widgetData.alarms);
    }
  }, [widgetData]);

  // Alarm check effect - runs every minute
  useEffect(() => {
    const checkAlarms = () => {
      const currentTime = getCurrentTime24h();
      
      // Only check once per minute
      if (currentTime === lastCheckedMinute.current) return;
      lastCheckedMinute.current = currentTime;
      
      alarms.forEach((alarm) => {
        if (alarm.enabled && !alarm.triggered && alarm.time === currentTime) {
          // Alarm triggered!
          triggerAlarm(alarm);
        }
      });
    };
    
    // Check immediately and then every 10 seconds
    checkAlarms();
    checkIntervalRef.current = setInterval(checkAlarms, 10000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [alarms]);
  
  // Reset triggered state at midnight
  useEffect(() => {
    const checkMidnight = () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        // Reset all triggered states
        setAlarms(prev => prev.map(a => ({ ...a, triggered: false })));
      }
    };
    
    const midnightInterval = setInterval(checkMidnight, 60000);
    return () => clearInterval(midnightInterval);
  }, []);

  // =====================
  // EVENT HANDLERS
  // =====================
  
  // Trigger alarm - play sound and send notification
  const triggerAlarm = useCallback((alarm: Alarm) => {
    // Mark as triggered
    setAlarms(prev => prev.map(a => 
      a.id === alarm.id ? { ...a, triggered: true } : a
    ));
    
    // Set ringing state for visual feedback
    setRingingAlarmId(alarm.id);
    setTimeout(() => setRingingAlarmId(null), 3000);
    
    // Play sound
    try {
      playSuccess('long');
    } catch {
      // Silently ignore audio errors
    }
    
    // Dispatch alarm-triggered event for VS Code notification
    const alarmTriggeredEvent = new CustomEvent('alarm-triggered', {
      bubbles: true,
      detail: {
        widgetId: (config as any).id,
        alarmId: alarm.id,
        time: alarm.time,
        label: alarm.label || 'Alarm',
        title: localConfig.title || 'Alarms',
      },
    });
    document.dispatchEvent(alarmTriggeredEvent);
  }, [config, localConfig.title]);
  
  // Emit update event (triggers save to code block)
  const emitUpdate = useCallback((
    updatedData: AlarmWidgetData, 
    updatedConfig?: AlarmWidgetConfig
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

  // Toggle alarm enabled state
  const handleToggleAlarm = useCallback((alarmId: string) => {
    const newAlarms = alarms.map(a => 
      a.id === alarmId ? { ...a, enabled: !a.enabled, triggered: false } : a
    );
    setAlarms(newAlarms);
    emitUpdate({ alarms: newAlarms });
  }, [alarms, emitUpdate]);

  // Delete alarm
  const handleDeleteAlarm = useCallback((alarmId: string) => {
    const newAlarms = alarms.filter(a => a.id !== alarmId);
    setAlarms(newAlarms);
    emitUpdate({ alarms: newAlarms });
  }, [alarms, emitUpdate]);

  // Add new alarm
  const handleAddAlarm = useCallback(() => {
    if (!newAlarmTime) return;
    if (alarms.length >= maxAlarms) return;
    
    const newAlarm: Alarm = {
      id: generateAlarmId(),
      time: newAlarmTime,
      label: newAlarmLabel || '',
      enabled: true,
    };
    
    const newAlarms = [...alarms, newAlarm].sort((a, b) => a.time.localeCompare(b.time));
    setAlarms(newAlarms);
    emitUpdate({ alarms: newAlarms });
    
    // Reset form
    setNewAlarmTime('');
    setNewAlarmLabel('');
    setIsAddingAlarm(false);
  }, [newAlarmTime, newAlarmLabel, alarms, maxAlarms, emitUpdate]);

  // Handle settings save
  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = { ...localConfig, ...newConfig } as AlarmWidgetConfig;
    setLocalConfig(updatedConfig);
    emitUpdate({ alarms }, updatedConfig);
  }, [localConfig, alarms, emitUpdate]);

  // =====================
  // SIZE-BASED STYLING
  // =====================
  
  const sizeConfig = {
    sm: { labelSize: 'md' as const, iconSize: 16, gap: '8px' },
    md: { labelSize: 'lg' as const, iconSize: 20, gap: '12px' },
    lg: { labelSize: 'xl' as const, iconSize: 24, gap: '16px' },
  };
  const sizeStyles = sizeConfig[size];

  // =====================
  // RENDER
  // =====================
  
  return (
    <Widget size={size} design={design} style={{ position: 'relative' }}>
      {/* Header */}
      <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Label size={sizeStyles.labelSize} style={{ fontWeight: 600 }}>
            {title}
          </Label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlarmClockIcon size={sizeStyles.iconSize} />
          <SettingsToggle 
            isOpen={isSettingsOpen} 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)} 
          />
        </div>
      </WidgetHeader>

      {/* Settings Panel */}
      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Alarm Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* Alarm List */}
      <WidgetContent style={{ flexDirection: 'column', gap: sizeStyles.gap, marginTop: '8px' }}>
        {alarms.length === 0 ? (
          <Label variant="muted" size="sm" style={{ textAlign: 'center', padding: '16px 0' }}>
            No alarms set. Click + to add one.
          </Label>
        ) : (
          alarms.map((alarm) => (
            <div
              key={alarm.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: '6px',
                backgroundColor: alarm.enabled 
                  ? 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.05))'
                  : 'transparent',
                border: ringingAlarmId === alarm.id
                  ? '2px solid var(--vscode-inputValidation-warningBorder, #ff9800)'
                  : '1px solid transparent',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <BellIcon 
                  size={sizeStyles.iconSize} 
                  ringing={ringingAlarmId === alarm.id}
                />
                <div style={{ display: 'flex', flexDirection: 'column', paddingRight: '8px' }}>
                  <Label 
                    size={sizeStyles.labelSize} 
                    style={{ 
                      fontWeight: 600,
                      color: alarm.enabled 
                        ? 'var(--vscode-foreground)' 
                        : 'var(--vscode-disabledForeground, #808080)',
                      textDecoration: alarm.triggered ? 'line-through' : 'none',
                    }}
                  >
                    {use24Hour ? alarm.time : formatTime12h(alarm.time)}
                  </Label>
                  {alarm.label && (
                    <Label 
                      variant="muted" 
                      size="sm"
                      style={{
                        color: alarm.enabled 
                          ? 'var(--vscode-descriptionForeground)' 
                          : 'var(--vscode-disabledForeground, #808080)',
                      }}
                    >
                      {alarm.label}
                    </Label>
                  )}
                </div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Switch
                  id={`alarm-${alarm.id}`}
                  checked={alarm.enabled}
                  onChange={() => handleToggleAlarm(alarm.id)}
                />
                <Button
                  aria-label="Delete alarm"
                  onClick={() => handleDeleteAlarm(alarm.id)}
                  variant="ghost"
                  size="icon"
                  style={{ width: '24px', height: '24px', opacity: 0.6 }}
                >
                  <TrashIcon size={14} />
                </Button>
              </div>
            </div>
          ))
        )}
        
        {/* Add Alarm Form */}
        {isAddingAlarm ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '12px',
              borderRadius: '6px',
              backgroundColor: 'var(--vscode-input-background, #3c3c3c)',
              border: '1px solid var(--vscode-input-border, #3c3c3c)',
            }}
          >
            <div style={{ display: 'flex', gap: '8px' }}>
              <Input
                type="time"
                value={newAlarmTime}
                onChange={(e) => setNewAlarmTime(e.target.value)}
                style={{ flex: 1 }}
                placeholder="Time"
              />
              <Input
                type="text"
                value={newAlarmLabel}
                onChange={(e) => setNewAlarmLabel(e.target.value)}
                placeholder="Label (optional)"
                style={{ flex: 2 }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAddingAlarm(false);
                  setNewAlarmTime('');
                  setNewAlarmLabel('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleAddAlarm}
                disabled={!newAlarmTime}
              >
                Add Alarm
              </Button>
            </div>
          </div>
        ) : null}
      </WidgetContent>

      {/* Footer with Add Button */}
      <WidgetFooter style={{ justifyContent: 'center' }}>
        {!isAddingAlarm && alarms.length < maxAlarms && (
          <Button
            aria-label="Add alarm"
            onClick={() => setIsAddingAlarm(true)}
            variant="outline"
            size="sm"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '4px',
            }}
          >
            <PlusIcon size={14} />
            Add Alarm
          </Button>
        )}
        {alarms.length >= maxAlarms && (
          <Label variant="muted" size="sm">
            Maximum alarms reached ({maxAlarms})
          </Label>
        )}
      </WidgetFooter>
      
      {/* Keyframe animation for ringing bell */}
      <style>{`
        @keyframes ring {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(15deg); }
          50% { transform: rotate(-15deg); }
          75% { transform: rotate(10deg); }
        }
      `}</style>
    </Widget>
  );
};
