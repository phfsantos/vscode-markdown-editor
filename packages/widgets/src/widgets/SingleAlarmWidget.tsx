/**
 * SingleAlarmWidget - Set a single alarm with wheel picker interface
 * 
 * Based on wigggle-ui clock-13.tsx wheel picker alarm pattern
 * Features:
 * - Wheel picker style time selection (hours, minutes, AM/PM)
 * - Single alarm focus for simplicity
 * - Sound notification when alarm triggers
 * - VS Code notification when alarm goes off
 * - Settings panel for customization
 * - Size variants (sm/md/lg)
 * - Persistent alarm state via code block
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { playSuccess } from 'simple-notification-sounds';
import { 
  Widget, WidgetHeader, WidgetContent, WidgetFooter, Label,
  Button, SettingsToggle, WidgetSettingsPanel
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize } from '../ui/Widget';

// =====================
// TYPE DEFINITIONS
// =====================

export interface SingleAlarmWidgetConfig {
  title?: string;
  size?: WidgetSize;
  design?: 'default' | 'minimal' | 'glass';
  use24Hour?: boolean;
}

export interface SingleAlarmWidgetData {
  hour: number;      // 1-12 for 12h mode, 0-23 for 24h mode
  minute: number;    // 0-59
  meridiem: 'AM' | 'PM';
  enabled: boolean;
  triggered?: boolean;
}

// =====================
// SETTINGS CONFIGURATION
// =====================

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Alarm' },
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
    key: 'use24Hour', 
    label: 'Use 24-Hour Format', 
    type: 'checkbox', 
    defaultValue: false 
  },
];

// =====================
// ICON COMPONENTS (SVG)
// =====================

const CheckIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ChevronUpIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

const ChevronDownIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const BellIcon: React.FC<{ size?: number; ringing?: boolean }> = ({ size = 20, ringing }) => (
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
// WHEEL PICKER COMPONENT
// =====================

interface WheelPickerProps {
  options: { label: string; value: string | number }[];
  value: string | number;
  onChange: (value: string | number) => void;
  infinite?: boolean;
  size: 'sm' | 'md' | 'lg';
}

const WheelPicker: React.FC<WheelPickerProps> = ({ options, value, onChange, infinite = false, size }) => {
  const currentIndex = options.findIndex(opt => opt.value === value || opt.value === String(value));
  
  const handleUp = () => {
    let newIndex = currentIndex - 1;
    if (newIndex < 0) {
      newIndex = infinite ? options.length - 1 : 0;
    }
    onChange(options[newIndex].value);
  };
  
  const handleDown = () => {
    let newIndex = currentIndex + 1;
    if (newIndex >= options.length) {
      newIndex = infinite ? 0 : options.length - 1;
    }
    onChange(options[newIndex].value);
  };
  
  const sizeConfig = {
    sm: { fontSize: '24px', buttonSize: 20, width: '48px' },
    md: { fontSize: '32px', buttonSize: 24, width: '56px' },
    lg: { fontSize: '40px', buttonSize: 28, width: '64px' },
  };
  const styles = sizeConfig[size];
  
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        minWidth: styles.width,
      }}
    >
      <button
        onClick={handleUp}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          color: 'var(--vscode-descriptionForeground, #808080)',
          opacity: 0.7,
          transition: 'opacity 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
        onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
        aria-label="Increase"
      >
        <ChevronUpIcon size={styles.buttonSize} />
      </button>
      
      <div
        style={{
          fontSize: styles.fontSize,
          fontWeight: 600,
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
          color: 'var(--vscode-foreground)',
          textAlign: 'center',
          lineHeight: 1,
          userSelect: 'none',
        }}
      >
        {options[currentIndex]?.label ?? '--'}
      </div>
      
      <button
        onClick={handleDown}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          color: 'var(--vscode-descriptionForeground, #808080)',
          opacity: 0.7,
          transition: 'opacity 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
        onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
        aria-label="Decrease"
      >
        <ChevronDownIcon size={styles.buttonSize} />
      </button>
    </div>
  );
};

// =====================
// UTILITY FUNCTIONS
// =====================

const createHourOptions = (use24Hour: boolean): { label: string; value: number }[] => {
  if (use24Hour) {
    return Array.from({ length: 24 }, (_, i) => ({
      label: i.toString().padStart(2, '0'),
      value: i,
    }));
  }
  return Array.from({ length: 12 }, (_, i) => ({
    label: (i + 1).toString().padStart(2, '0'),
    value: i + 1,
  }));
};

const createMinuteOptions = (): { label: string; value: number }[] =>
  Array.from({ length: 60 }, (_, i) => ({
    label: i.toString().padStart(2, '0'),
    value: i,
  }));

const meridiemOptions: { label: string; value: 'AM' | 'PM' }[] = [
  { label: 'AM', value: 'AM' },
  { label: 'PM', value: 'PM' },
];

function getAlarmTime24h(hour: number, minute: number, meridiem: 'AM' | 'PM', use24Hour: boolean): string {
  let h = hour;
  if (!use24Hour) {
    // Convert 12h to 24h
    if (meridiem === 'PM' && hour !== 12) {
      h = hour + 12;
    } else if (meridiem === 'AM' && hour === 12) {
      h = 0;
    }
  }
  return `${h.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function getCurrentTime24h(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

function formatDisplayTime(hour: number, minute: number, meridiem: 'AM' | 'PM', use24Hour: boolean): string {
  if (use24Hour) {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  return `${hour}:${minute.toString().padStart(2, '0')} ${meridiem}`;
}

// =====================
// WIDGET COMPONENT
// =====================

export const SingleAlarmWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  data, 
  onUpdate
}) => {
  // Cast props to typed interfaces
  const widgetConfig = config as unknown as SingleAlarmWidgetConfig;
  const widgetData = data as SingleAlarmWidgetData | undefined;
  
  // =====================
  // STATE
  // =====================
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<SingleAlarmWidgetConfig>(widgetConfig);
  const [isRinging, setIsRinging] = useState(false);
  
  // Alarm state with defaults
  const defaultData: SingleAlarmWidgetData = {
    hour: 9,
    minute: 0,
    meridiem: 'AM',
    enabled: false,
    triggered: false,
  };
  
  const [alarmData, setAlarmData] = useState<SingleAlarmWidgetData>(widgetData || defaultData);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCheckedMinute = useRef<string>('');
  
  // Config with defaults
  const title = localConfig.title || 'Alarm';
  const size = localConfig.size || 'sm';
  const design = localConfig.design || 'default';
  const use24Hour = localConfig.use24Hour ?? false;

  // =====================
  // EFFECTS
  // =====================
  
  // Sync with external data changes
  useEffect(() => {
    if (widgetData) {
      setAlarmData(widgetData);
    }
  }, [widgetData]);

  // Alarm check effect - runs every 10 seconds
  useEffect(() => {
    const checkAlarm = () => {
      if (!alarmData.enabled || alarmData.triggered) return;
      
      const currentTime = getCurrentTime24h();
      
      // Only check once per minute
      if (currentTime === lastCheckedMinute.current) return;
      lastCheckedMinute.current = currentTime;
      
      const alarmTime = getAlarmTime24h(alarmData.hour, alarmData.minute, alarmData.meridiem, use24Hour);
      
      if (alarmTime === currentTime) {
        triggerAlarm();
      }
    };
    
    // Check immediately and then every 10 seconds
    checkAlarm();
    checkIntervalRef.current = setInterval(checkAlarm, 10000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [alarmData, use24Hour]);
  
  // Reset triggered state at midnight
  useEffect(() => {
    const checkMidnight = () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        const newData = { ...alarmData, triggered: false };
        setAlarmData(newData);
        emitUpdate(newData);
      }
    };
    
    const midnightInterval = setInterval(checkMidnight, 60000);
    return () => clearInterval(midnightInterval);
  }, [alarmData]);

  // =====================
  // EVENT HANDLERS
  // =====================
  
  // Trigger alarm - play sound and send notification
  const triggerAlarm = useCallback(() => {
    // Mark as triggered
    const newData = { ...alarmData, triggered: true };
    setAlarmData(newData);
    emitUpdate(newData);
    
    // Set ringing state for visual feedback
    setIsRinging(true);
    setTimeout(() => setIsRinging(false), 5000);
    
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
        time: formatDisplayTime(alarmData.hour, alarmData.minute, alarmData.meridiem, use24Hour),
        label: title,
        title: title,
      },
    });
    document.dispatchEvent(alarmTriggeredEvent);
  }, [alarmData, config, title, use24Hour]);
  
  // Emit update event (triggers save to code block)
  const emitUpdate = useCallback((
    updatedData: SingleAlarmWidgetData, 
    updatedConfig?: SingleAlarmWidgetConfig
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

  // Handle time change
  const handleHourChange = useCallback((value: string | number) => {
    const newData = { ...alarmData, hour: Number(value), triggered: false };
    setAlarmData(newData);
    emitUpdate(newData);
  }, [alarmData, emitUpdate]);

  const handleMinuteChange = useCallback((value: string | number) => {
    const newData = { ...alarmData, minute: Number(value), triggered: false };
    setAlarmData(newData);
    emitUpdate(newData);
  }, [alarmData, emitUpdate]);

  const handleMeridiemChange = useCallback((value: string | number) => {
    const newData = { ...alarmData, meridiem: value as 'AM' | 'PM', triggered: false };
    setAlarmData(newData);
    emitUpdate(newData);
  }, [alarmData, emitUpdate]);

  // Enable/disable alarm (confirm button)
  const handleConfirm = useCallback(() => {
    const newData = { ...alarmData, enabled: true, triggered: false };
    setAlarmData(newData);
    emitUpdate(newData);
  }, [alarmData, emitUpdate]);

  // Cancel/disable alarm
  const handleCancel = useCallback(() => {
    const newData = { ...alarmData, enabled: false, triggered: false };
    setAlarmData(newData);
    emitUpdate(newData);
  }, [alarmData, emitUpdate]);

  // Handle settings save
  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = { ...localConfig, ...newConfig } as SingleAlarmWidgetConfig;
    setLocalConfig(updatedConfig);
    emitUpdate(alarmData, updatedConfig);
  }, [localConfig, alarmData, emitUpdate]);

  // =====================
  // OPTIONS
  // =====================
  
  const hourOptions = createHourOptions(use24Hour);
  const minuteOptions = createMinuteOptions();

  // =====================
  // RENDER
  // =====================
  
  return (
    <Widget size={size} design={design} style={{ position: 'relative' }}>
      {/* Header */}
      <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BellIcon size={size === 'lg' ? 24 : size === 'md' ? 20 : 16} ringing={isRinging} />
          <Label size={size === 'lg' ? 'xl' : size === 'md' ? 'lg' : 'md'} style={{ fontWeight: 600 }}>
            {title}
          </Label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {alarmData.enabled && (
            <Label 
              variant="productive" 
              size="sm" 
              style={{ 
                padding: '2px 8px', 
                borderRadius: '12px',
                backgroundColor: 'var(--vscode-testing-iconPassed, #4caf50)',
                color: 'white',
              }}
            >
              ON
            </Label>
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
          title="Alarm Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* Wheel Picker Content */}
      <WidgetContent 
        style={{ 
          flexDirection: 'column', 
          alignItems: 'center',
          gap: size === 'lg' ? '16px' : '12px',
          padding: size === 'lg' ? '20px' : '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: size === 'lg' ? '8px' : '4px',
            padding: size === 'lg' ? '16px 24px' : '12px 16px',
            borderRadius: '12px',
            border: '2px solid var(--vscode-panel-border, #454545)',
            backgroundColor: 'var(--vscode-input-background, #3c3c3c)',
          }}
        >
          {/* Hours */}
          <WheelPicker
            options={hourOptions}
            value={alarmData.hour}
            onChange={handleHourChange}
            infinite
            size={size}
          />
          
          {/* Separator */}
          <span 
            style={{ 
              fontSize: size === 'lg' ? '40px' : size === 'md' ? '32px' : '24px',
              fontWeight: 600,
              color: 'var(--vscode-foreground)',
              opacity: 0.6,
              padding: '0 4px',
            }}
          >
            :
          </span>
          
          {/* Minutes */}
          <WheelPicker
            options={minuteOptions}
            value={alarmData.minute}
            onChange={handleMinuteChange}
            infinite
            size={size}
          />
          
          {/* AM/PM (only in 12h mode) */}
          {!use24Hour && (
            <WheelPicker
              options={meridiemOptions}
              value={alarmData.meridiem}
              onChange={handleMeridiemChange}
              size={size}
            />
          )}
        </div>
        
        {/* Status message */}
        {alarmData.triggered && (
          <Label variant="muted" size="sm" style={{ fontStyle: 'italic' }}>
            Alarm triggered today
          </Label>
        )}
      </WidgetContent>

      {/* Footer with Confirm/Cancel buttons */}
      <WidgetFooter style={{ justifyContent: 'center', gap: '12px' }}>
        <Button
          onClick={handleCancel}
          variant="outline"
          size="icon"
          style={{
            width: size === 'lg' ? '40px' : '32px',
            height: size === 'lg' ? '40px' : '32px',
            borderRadius: '50%',
          }}
          aria-label="Cancel alarm"
        >
          <XIcon size={size === 'lg' ? 18 : 14} />
        </Button>
        <Button
          onClick={handleConfirm}
          variant="outline"
          size="icon"
          style={{
            width: size === 'lg' ? '40px' : '32px',
            height: size === 'lg' ? '40px' : '32px',
            borderRadius: '50%',
          }}
          aria-label="Set alarm"
        >
          <CheckIcon size={size === 'lg' ? 18 : 14} />
        </Button>
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
