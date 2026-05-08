/**
 * TimerWidget - Countdown timer with start/pause/reset controls
 * 
 * Inspired by wigggle-ui clock-11.tsx timer widget
 * Features:
 * - Adjustable time with +/- minute buttons
 * - Start/pause/reset functionality
 * - Persistent state via code block
 * - Settings panel for customization
 * - Size variants (sm/md/lg)
 * - Audio notification on completion
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { playAttention } from 'simple-notification-sounds';
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

export interface TimerWidgetConfig {
  title?: string;
  size?: WidgetSize;
  initialMinutes?: number;
  showMinuteControls?: boolean;
  maxMinutes?: number;
  minMinutes?: number;
  design?: 'default' | 'minimal' | 'glass';
}

export interface TimerWidgetData {
  timeLeft: number; // seconds
  isRunning: boolean;
}

// =====================
// SETTINGS CONFIGURATION
// =====================

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Timer' },
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
    key: 'initialMinutes', 
    label: 'Default Minutes', 
    type: 'number', 
    min: 1, 
    max: 120, 
    defaultValue: 5 
  },
  { 
    key: 'showMinuteControls', 
    label: 'Show +/- Controls', 
    type: 'checkbox', 
    defaultValue: true 
  },
  { 
    key: 'maxMinutes', 
    label: 'Max Minutes', 
    type: 'number', 
    min: 1, 
    max: 120, 
    defaultValue: 60 
  },
  { 
    key: 'minMinutes', 
    label: 'Min Minutes', 
    type: 'number', 
    min: 1, 
    max: 60, 
    defaultValue: 1 
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
];

// =====================
// ICON COMPONENTS (SVG)
// =====================

const MinusIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const PlusIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const PlayIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);

const PauseIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const ResetIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 4v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

// =====================
// WIDGET COMPONENT
// =====================

export const TimerWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  data, 
  onUpdate
}) => {
  // Cast props to typed interfaces
  const widgetConfig = config as unknown as TimerWidgetConfig;
  const widgetData = data as TimerWidgetData | undefined;
  
  // =====================
  // STATE
  // =====================
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<TimerWidgetConfig>(widgetConfig);
  
  // Timer-specific state
  const initialSeconds = (widgetConfig.initialMinutes || 5) * 60;
  const [timeLeft, setTimeLeft] = useState(widgetData?.timeLeft ?? initialSeconds);
  const [isRunning, setIsRunning] = useState(widgetData?.isRunning ?? false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Config with defaults
  const size = localConfig.size || 'sm';
  const showMinuteControls = localConfig.showMinuteControls !== false;
  const maxMinutes = localConfig.maxMinutes || 60;
  const minMinutes = localConfig.minMinutes || 1;
  const design = localConfig.design || 'default';

  // Computed values
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const displayMinutes = String(minutes).padStart(2, '0');
  const displaySeconds = String(seconds).padStart(2, '0');

  // =====================
  // EFFECTS
  // =====================
  
  // Sync with external data changes
  useEffect(() => {
    if (widgetData) {
      if (typeof widgetData.timeLeft === 'number') {
        setTimeLeft(widgetData.timeLeft);
      }
      if (typeof widgetData.isRunning === 'boolean') {
        setIsRunning(widgetData.isRunning);
      }
    }
  }, [widgetData]);

  // Timer countdown effect
  useEffect(() => {
    if (isRunning && !intervalRef.current) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            
            // Play attention sound when timer completes
            try {
              playAttention('long');
            } catch {
              // Silently ignore audio errors (e.g., if audio context is blocked)
            }
            
            // Dispatch timer-completed event when timer ends
            const timerCompletedEvent = new CustomEvent('timer-completed', {
              bubbles: true,
              detail: {
                widgetId: (config as any).id,
                title: localConfig.title || 'Timer',
                initialMinutes: localConfig.initialMinutes || 5,
              },
            });
            document.dispatchEvent(timerCompletedEvent);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    if (!isRunning && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, config, localConfig.title, localConfig.initialMinutes]);

  // =====================
  // EVENT HANDLERS
  // =====================
  
  // Emit update event (triggers save to code block)
  const emitUpdate = useCallback((
    updatedData: TimerWidgetData, 
    updatedConfig?: TimerWidgetConfig
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

  // Add time (1 minute)
  const handleAddTime = useCallback(() => {
    if (isRunning || timeLeft >= maxMinutes * 60) return;
    const newTimeLeft = timeLeft + 60;
    setTimeLeft(newTimeLeft);
    emitUpdate({ timeLeft: newTimeLeft, isRunning });
  }, [isRunning, timeLeft, maxMinutes, emitUpdate]);

  // Subtract time (1 minute)
  const handleSubtractTime = useCallback(() => {
    if (isRunning || timeLeft <= minMinutes * 60) return;
    const newTimeLeft = timeLeft - 60;
    setTimeLeft(newTimeLeft);
    emitUpdate({ timeLeft: newTimeLeft, isRunning });
  }, [isRunning, timeLeft, minMinutes, emitUpdate]);

  // Toggle timer (start/pause)
  const handleToggle = useCallback(() => {
    const newIsRunning = !isRunning;
    setIsRunning(newIsRunning);
    emitUpdate({ timeLeft, isRunning: newIsRunning });
  }, [isRunning, timeLeft, emitUpdate]);

  // Reset timer
  const handleReset = useCallback(() => {
    const newTimeLeft = (localConfig.initialMinutes || 5) * 60;
    setIsRunning(false);
    setTimeLeft(newTimeLeft);
    emitUpdate({ timeLeft: newTimeLeft, isRunning: false });
  }, [localConfig.initialMinutes, emitUpdate]);

  // Handle settings save
  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = { ...localConfig, ...newConfig } as TimerWidgetConfig;
    setLocalConfig(updatedConfig);
    emitUpdate({ timeLeft, isRunning }, updatedConfig);
  }, [localConfig, timeLeft, isRunning, emitUpdate]);

  // =====================
  // SIZE-BASED STYLING
  // =====================
  
  const sizeConfig = {
    sm: { time: '4xl' as const, label: 'md' as const, iconSize: 16 },
    md: { time: '5xl' as const, label: 'lg' as const, iconSize: 20 },
    lg: { time: '6xl' as const, label: 'xl' as const, iconSize: 24 },
  };
  const labelSizes = sizeConfig[size];

  // Timer completed state
  const isCompleted = timeLeft === 0;

  // =====================
  // RENDER
  // =====================
  
  return (
    <Widget size={size} design={design} style={{ position: 'relative' }}>
      {/* Header with minute controls */}
      <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {showMinuteControls && (
            <Button
              aria-label="Subtract one minute"
              disabled={isRunning || timeLeft <= minMinutes * 60}
              onClick={handleSubtractTime}
              variant="ghost"
              size="icon"
              style={{ width: '24px', height: '24px' }}
            >
              <MinusIcon size={labelSizes.iconSize} />
            </Button>
          )}
          
          <Label variant="muted" size={labelSizes.label}>
            {minutes} Min{minutes !== 1 ? 's' : ''}
          </Label>
          
          {showMinuteControls && (
            <Button
              aria-label="Add one minute"
              disabled={isRunning || timeLeft >= maxMinutes * 60}
              onClick={handleAddTime}
              variant="ghost"
              size="icon"
              style={{ width: '24px', height: '24px' }}
            >
              <PlusIcon size={labelSizes.iconSize} />
            </Button>
          )}
        </div>

        <SettingsToggle 
          isOpen={isSettingsOpen} 
          onClick={() => setIsSettingsOpen(!isSettingsOpen)} 
        />
      </WidgetHeader>

      {/* Settings Panel */}
      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Timer Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* Main Timer Display */}
      <WidgetContent style={{ flexDirection: 'column', gap: '8px' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
        }}>
          <Label 
            size={labelSizes.time} 
            style={{ 
              letterSpacing: '2px',
              color: isCompleted 
                ? 'var(--vscode-testing-iconPassed, #4caf50)' 
                : undefined,
              transition: 'color 0.3s ease',
            }}
          >
            {displayMinutes}:{displaySeconds}
          </Label>
        </div>
        
        {isCompleted && (
          <Label 
            variant="productive" 
            size="sm" 
            style={{ textAlign: 'center' }}
          >
            Time's up!
          </Label>
        )}
      </WidgetContent>

      {/* Control Buttons */}
      <WidgetFooter style={{ justifyContent: 'center', gap: '12px' }}>
        <Button
          aria-label="Reset timer"
          onClick={handleReset}
          variant="outline"
          size="icon"
          style={{ borderRadius: '50%', width: '36px', height: '36px' }}
        >
          <ResetIcon size={labelSizes.iconSize} />
        </Button>
        
        <Button
          aria-label={isRunning ? 'Pause timer' : 'Start timer'}
          onClick={handleToggle}
          variant="outline"
          size="icon"
          style={{ 
            borderRadius: '50%', 
            width: '36px', 
            height: '36px',
            background: isRunning 
              ? 'rgba(244, 67, 54, 0.1)' 
              : 'rgba(76, 175, 80, 0.1)',
            borderColor: isRunning 
              ? 'var(--vscode-testing-iconFailed, #f44336)' 
              : 'var(--vscode-testing-iconPassed, #4caf50)',
          }}
        >
          {isRunning ? (
            <PauseIcon size={labelSizes.iconSize} />
          ) : (
            <PlayIcon size={labelSizes.iconSize} />
          )}
        </Button>
      </WidgetFooter>
    </Widget>
  );
};
