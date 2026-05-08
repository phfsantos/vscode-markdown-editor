/**
 * StopwatchWidget - Elapsed time tracker with lap times
 * 
 * Based on wigggle-ui clock-12.tsx stopwatch widget
 * Features:
 * - Start/pause/reset stopwatch functionality
 * - Millisecond precision display
 * - Lap time tracking (optional)
 * - Circular analog visualization (optional)
 * - Settings panel for customization
 * - Size variants (sm/md/lg)
 * - State persistence via code block
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Widget, WidgetHeader, WidgetContent, WidgetFooter, WidgetTitle, Label,
  Button, SettingsToggle, WidgetSettingsPanel
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize } from '../ui/Widget';

// =====================
// TYPE DEFINITIONS
// =====================

export interface LapTime {
  id: string;
  time: number; // milliseconds
  lap: number;
}

export interface StopwatchWidgetConfig {
  title?: string;
  size?: WidgetSize;
  showAnalog?: boolean;
  showLaps?: boolean;
  maxLaps?: number;
  design?: 'default' | 'minimal' | 'glass';
}

export interface StopwatchWidgetData {
  elapsedTime: number; // milliseconds
  isRunning: boolean;
  laps: LapTime[];
}

// =====================
// SETTINGS CONFIGURATION
// =====================

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Stopwatch' },
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
    key: 'showAnalog', 
    label: 'Show Analog Clock', 
    type: 'checkbox', 
    defaultValue: true 
  },
  { 
    key: 'showLaps', 
    label: 'Show Lap Times', 
    type: 'checkbox', 
    defaultValue: true 
  },
  { 
    key: 'maxLaps', 
    label: 'Max Laps', 
    type: 'number', 
    min: 1, 
    max: 50, 
    defaultValue: 10 
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

const LapIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

// =====================
// HELPER FUNCTIONS
// =====================

function formatTime(ms: number): { minutes: string; seconds: string; milliseconds: string } {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor((ms % 1000) / 10);

  return {
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
    milliseconds: String(milliseconds).padStart(2, '0'),
  };
}

function formatLapTime(ms: number): string {
  const { minutes, seconds, milliseconds } = formatTime(ms);
  return `${minutes}:${seconds}.${milliseconds}`;
}

function generateLapId(): string {
  return `lap-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// =====================
// WIDGET COMPONENT
// =====================

export const StopwatchWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  data, 
  onUpdate
}) => {
  // Cast props to typed interfaces
  const widgetConfig = config as unknown as StopwatchWidgetConfig;
  const widgetData = data as StopwatchWidgetData | undefined;
  
  // =====================
  // STATE
  // =====================
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<StopwatchWidgetConfig>(widgetConfig);
  
  // Stopwatch-specific state
  const [elapsedTime, setElapsedTime] = useState(widgetData?.elapsedTime ?? 0);
  const [isRunning, setIsRunning] = useState(widgetData?.isRunning ?? false);
  const [laps, setLaps] = useState<LapTime[]>(widgetData?.laps ?? []);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  
  // Config with defaults
  const title = localConfig.title || 'Stopwatch';
  const size = localConfig.size || 'sm';
  const showAnalog = localConfig.showAnalog !== false;
  const showLaps = localConfig.showLaps !== false;
  const maxLaps = localConfig.maxLaps || 10;
  const design = localConfig.design || 'default';

  // Computed display values
  const { minutes, seconds, milliseconds } = formatTime(elapsedTime);
  
  // Analog clock calculations
  const totalSeconds = Math.floor(elapsedTime / 1000);
  const totalMilliseconds = elapsedTime % 1000;
  const secondHandRotation = ((totalSeconds % 60) + totalMilliseconds / 1000) * 6;

  // =====================
  // EFFECTS
  // =====================
  
  // Sync with external data changes
  useEffect(() => {
    if (widgetData) {
      if (typeof widgetData.elapsedTime === 'number') {
        setElapsedTime(widgetData.elapsedTime);
      }
      if (typeof widgetData.isRunning === 'boolean') {
        setIsRunning(widgetData.isRunning);
      }
      if (Array.isArray(widgetData.laps)) {
        setLaps(widgetData.laps);
      }
    }
  }, [widgetData]);

  // Stopwatch interval effect
  useEffect(() => {
    if (isRunning && !intervalRef.current) {
      startTimeRef.current = Date.now() - elapsedTime;
      intervalRef.current = setInterval(() => {
        setElapsedTime(Date.now() - startTimeRef.current);
      }, 10);
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
  }, [isRunning]);

  // =====================
  // EVENT HANDLERS
  // =====================
  
  // Emit update event (triggers save to code block)
  const emitUpdate = useCallback((
    updatedData: StopwatchWidgetData, 
    updatedConfig?: StopwatchWidgetConfig
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

  // Toggle stopwatch (start/pause)
  const handleToggle = useCallback(() => {
    const newIsRunning = !isRunning;
    setIsRunning(newIsRunning);
    
    // Only save state when pausing
    if (!newIsRunning) {
      emitUpdate({ elapsedTime, isRunning: newIsRunning, laps });
    }
  }, [isRunning, elapsedTime, laps, emitUpdate]);

  // Reset stopwatch
  const handleReset = useCallback(() => {
    setIsRunning(false);
    setElapsedTime(0);
    setLaps([]);
    emitUpdate({ elapsedTime: 0, isRunning: false, laps: [] });
  }, [emitUpdate]);

  // Record lap time
  const handleLap = useCallback(() => {
    if (!isRunning || !showLaps) return;
    
    const newLap: LapTime = {
      id: generateLapId(),
      time: elapsedTime,
      lap: laps.length + 1,
    };
    
    const updatedLaps = [...laps, newLap].slice(-maxLaps);
    setLaps(updatedLaps);
    emitUpdate({ elapsedTime, isRunning, laps: updatedLaps });
  }, [isRunning, showLaps, elapsedTime, laps, maxLaps, emitUpdate]);

  // Handle settings save
  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = { ...localConfig, ...newConfig } as StopwatchWidgetConfig;
    setLocalConfig(updatedConfig);
    emitUpdate({ elapsedTime, isRunning, laps }, updatedConfig);
  }, [localConfig, elapsedTime, isRunning, laps, emitUpdate]);

  // =====================
  // SIZE-BASED STYLING
  // =====================
  
  const sizeConfig = {
    sm: { time: '3xl' as const, label: 'sm' as const, iconSize: 14, clockSize: 120 },
    md: { time: '4xl' as const, label: 'md' as const, iconSize: 18, clockSize: 140 },
    lg: { time: '5xl' as const, label: 'lg' as const, iconSize: 22, clockSize: 180 },
  };
  const sizeStyles = sizeConfig[size];

  // =====================
  // RENDER
  // =====================
  
  return (
    <Widget size={size} design={design} style={{ position: 'relative' }}>
      <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <WidgetTitle>{title}</WidgetTitle>
        <SettingsToggle 
          isOpen={isSettingsOpen} 
          onClick={() => setIsSettingsOpen(!isSettingsOpen)} 
        />
      </WidgetHeader>

      {/* Settings Panel */}
      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Stopwatch Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      <WidgetContent style={{ flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
        {/* Analog Clock Face */}
        {showAnalog && (
          <div style={{
            position: 'relative',
            width: `${sizeStyles.clockSize}px`,
            height: `${sizeStyles.clockSize}px`,
            borderRadius: '50%',
            border: '2px solid var(--vscode-foreground, #ccc)',
            background: 'var(--vscode-editor-background, transparent)',
          }}>
            {/* Center dot */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '8px',
              height: '8px',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              border: '2px solid #ef4444',
              zIndex: 20,
            }} />

            {/* 60 second tick marks */}
            {[...Array(60)].map((_, i) => (
              <div
                key={`tick-${i}`}
                style={{
                  position: 'absolute',
                  height: '100%',
                  width: '100%',
                  transform: `rotate(${i * 6}deg)`,
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  height: i % 5 === 0 ? '8px' : '4px',
                  width: i % 5 === 0 ? '2px' : '1px',
                  transform: 'translateX(-50%)',
                  background: i % 5 === 0 
                    ? 'var(--vscode-foreground, #888)' 
                    : 'var(--vscode-descriptionForeground, #666)',
                  opacity: i % 5 === 0 ? 0.7 : 0.4,
                }} />
              </div>
            ))}

            {/* Numbers 5, 10, 15... 60 */}
            {[...Array(12)].map((_, i) => {
              const number = i === 0 ? 60 : i * 5;
              const angle = (i * 30 - 90) * (Math.PI / 180);
              const radius = sizeStyles.clockSize / 2 - 18;
              const x = Math.cos(angle) * radius;
              const y = Math.sin(angle) * radius;

              return (
                <span
                  key={`num-${i}`}
                  style={{
                    position: 'absolute',
                    left: `calc(50% + ${x}px)`,
                    top: `calc(50% + ${y}px)`,
                    transform: 'translate(-50%, -50%)',
                    fontSize: '10px',
                    fontWeight: 600,
                    color: 'var(--vscode-descriptionForeground, #888)',
                  }}
                >
                  {number}
                </span>
              );
            })}

            {/* Second hand (red) */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '2px',
              height: `${sizeStyles.clockSize / 2 - 10}px`,
              background: '#ef4444',
              borderRadius: '1px',
              transformOrigin: 'bottom center',
              transform: `translate(-50%, -100%) rotate(${secondHandRotation}deg)`,
              zIndex: 10,
            }} />

            {/* Digital time overlay */}
            <div style={{
              position: 'absolute',
              bottom: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              textAlign: 'center',
              zIndex: 5,
            }}>
              <span style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--vscode-foreground, #fff)',
              }}>
                {seconds}.{milliseconds}
              </span>
            </div>
          </div>
        )}

        {/* Digital Time Display */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'baseline', 
          justifyContent: 'center',
          gap: '2px',
        }}>
          <Label 
            size={sizeStyles.time} 
            style={{ 
              letterSpacing: '1px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {minutes}:{seconds}
          </Label>
          <Label 
            variant="muted" 
            size={sizeStyles.label}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            .{milliseconds}
          </Label>
        </div>

        {/* Lap Times */}
        {showLaps && laps.length > 0 && (
          <div style={{
            width: '100%',
            maxHeight: '80px',
            overflowY: 'auto',
            borderTop: '1px solid var(--vscode-panel-border, #444)',
            paddingTop: '8px',
          }}>
            {[...laps].reverse().map((lap) => (
              <div 
                key={lap.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '2px 8px',
                  fontSize: '11px',
                  color: 'var(--vscode-descriptionForeground, #888)',
                }}
              >
                <span>Lap {lap.lap}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatLapTime(lap.time)}
                </span>
              </div>
            ))}
          </div>
        )}
      </WidgetContent>

      {/* Control Buttons */}
      <WidgetFooter style={{ justifyContent: 'center', gap: '8px' }}>
        <Button
          aria-label="Reset stopwatch"
          onClick={handleReset}
          variant="outline"
          size="icon"
          style={{ borderRadius: '50%', width: '32px', height: '32px' }}
        >
          <ResetIcon size={sizeStyles.iconSize} />
        </Button>
        
        {showLaps && (
          <Button
            aria-label="Record lap time"
            onClick={handleLap}
            variant="outline"
            size="icon"
            disabled={!isRunning}
            style={{ 
              borderRadius: '50%', 
              width: '32px', 
              height: '32px',
              opacity: isRunning ? 1 : 0.5,
            }}
          >
            <LapIcon size={sizeStyles.iconSize} />
          </Button>
        )}
        
        <Button
          aria-label={isRunning ? 'Pause stopwatch' : 'Start stopwatch'}
          onClick={handleToggle}
          variant="outline"
          size="icon"
          style={{ 
            borderRadius: '50%', 
            width: '32px', 
            height: '32px',
            background: isRunning 
              ? 'rgba(244, 67, 54, 0.1)' 
              : 'rgba(76, 175, 80, 0.1)',
            borderColor: isRunning 
              ? 'var(--vscode-testing-iconFailed, #f44336)' 
              : 'var(--vscode-testing-iconPassed, #4caf50)',
          }}
        >
          {isRunning ? (
            <PauseIcon size={sizeStyles.iconSize} />
          ) : (
            <PlayIcon size={sizeStyles.iconSize} />
          )}
        </Button>
      </WidgetFooter>
    </Widget>
  );
};
