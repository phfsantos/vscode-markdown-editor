/**
 * ClockWidget - Digital and Analog clocks with multiple face styles
 * Inspired by wigggle-ui clock widgets
 * 
 * Supports:
 * - Digital clock with day of week option
 * - Analog clock (plain, with numbers, with roman numerals)
 * - Multi-timezone clocks (2-zone list, 4-zone list, 4-zone grid)
 * - Settings panel for configuration
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Widget, WidgetHeader, WidgetContent, WidgetFooter, WidgetTitle, Label,
  SettingsToggle, WidgetSettingsPanel, Input
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

// Clock face types
export type ClockFace = 
  | 'digital' 
  | 'analog' 
  | 'analog-numbers' 
  | 'analog-roman' 
  | 'multizone-2' 
  | 'multizone-4-list' 
  | 'multizone-4-grid';

// Timezone configuration for multi-zone clocks
export interface TimezoneConfig {
  label: string;
  timezone: string; // IANA timezone string (e.g., 'America/New_York')
}

export interface ClockWidgetConfig {
  face?: ClockFace;
  format?: '12h' | '24h';
  showSeconds?: boolean;
  showDate?: boolean;
  showDayOfWeek?: boolean;
  timezone?: string;
  size?: 'sm' | 'md' | 'lg';
  // Multi-zone configuration
  timezones?: TimezoneConfig[];
}

// Settings fields for digital/analog clock faces
const baseSettingsFields: SettingsField[] = [
  {
    key: 'face',
    label: 'Clock Face',
    type: 'select',
    options: [
      { value: 'digital', label: 'Digital' },
      { value: 'analog', label: 'Analog (Plain)' },
      { value: 'analog-numbers', label: 'Analog + Numbers' },
      { value: 'analog-roman', label: 'Analog + Roman' },
      { value: 'multizone-2', label: 'Multi-Zone (2)' },
      { value: 'multizone-4-list', label: 'Multi-Zone (4 List)' },
      { value: 'multizone-4-grid', label: 'Multi-Zone (4 Grid)' },
    ],
    defaultValue: 'digital',
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
    defaultValue: 'sm',
  },
  {
    key: 'format',
    label: 'Time Format',
    type: 'select',
    options: [
      { value: '12h', label: '12 Hour (AM/PM)' },
      { value: '24h', label: '24 Hour' },
    ],
    defaultValue: '12h',
  },
];

// Additional fields for digital clock
const digitalSettingsFields: SettingsField[] = [
  { key: 'showSeconds', label: 'Show Seconds', type: 'checkbox', defaultValue: false },
  { key: 'showDate', label: 'Show Date', type: 'checkbox', defaultValue: true },
  { key: 'showDayOfWeek', label: 'Show Day of Week', type: 'checkbox', defaultValue: false },
];

// Default timezone configurations
const DEFAULT_TIMEZONES_2: TimezoneConfig[] = [
  { label: 'New York', timezone: 'America/New_York' },
  { label: 'London', timezone: 'Europe/London' },
];

const DEFAULT_TIMEZONES_4: TimezoneConfig[] = [
  { label: 'New York', timezone: 'America/New_York' },
  { label: 'London', timezone: 'Europe/London' },
  { label: 'Tokyo', timezone: 'Asia/Tokyo' },
  { label: 'Sydney', timezone: 'Australia/Sydney' },
];

// Helper to get time in a specific timezone
const getTimeInTimezone = (timezone: string): Date => {
  try {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    };
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
    const get = (type: string) => parts.find(p => p.type === type)?.value || '0';
    return new Date(
      parseInt(get('year')),
      parseInt(get('month')) - 1,
      parseInt(get('day')),
      parseInt(get('hour')),
      parseInt(get('minute')),
      parseInt(get('second'))
    );
  } catch {
    return new Date();
  }
};

// Check if it's daytime (6 AM - 6 PM)
const isDaytime = (date: Date): boolean => {
  const hours = date.getHours();
  return hours >= 6 && hours < 18;
};

// Sun icon component
const SunIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2"/>
    <path d="M12 20v2"/>
    <path d="m4.93 4.93 1.41 1.41"/>
    <path d="m17.66 17.66 1.41 1.41"/>
    <path d="M2 12h2"/>
    <path d="M20 12h2"/>
    <path d="m6.34 17.66-1.41 1.41"/>
    <path d="m19.07 4.93-1.41 1.41"/>
  </svg>
);

// Moon icon component
const MoonIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
  </svg>
);

// Separator component for multizone clocks
const Separator: React.FC = () => (
  <div style={{
    width: '100%',
    height: '1px',
    background: 'var(--vscode-panel-border, #3c3c3c)',
  }} />
);

// =====================
// Analog Clock Face Component
// =====================
interface AnalogClockFaceProps {
  time: Date;
  showNumbers?: boolean;
  romanNumerals?: boolean;
  size: 'sm' | 'md' | 'lg';
}

const AnalogClockFace: React.FC<AnalogClockFaceProps> = ({ 
  time, 
  showNumbers = false, 
  romanNumerals = false,
  size 
}) => {
  const hours = time.getHours() % 12;
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();

  // Calculate rotation angles
  const hoursDegrees = ((hours + minutes / 60) / 12) * 360;
  const minutesDegrees = ((minutes + seconds / 60) / 60) * 360;
  const secondsDegrees = (seconds / 60) * 360;

  // Size configuration
  const sizeConfig = {
    sm: { clockSize: 88, radius: 35, handH: 24, handM: 30, handS: 30, fontSize: 10, centerSize: 8 },
    md: { clockSize: 120, radius: 50, handH: 32, handM: 42, handS: 42, fontSize: 12, centerSize: 10 },
    lg: { clockSize: 160, radius: 65, handH: 44, handM: 56, handS: 56, fontSize: 14, centerSize: 12 },
  };
  const cfg = sizeConfig[size];

  // Number labels
  const romanNumeralLabels = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  const arabicNumerals = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  const labels = romanNumerals ? romanNumeralLabels : arabicNumerals;

  return (
    <div style={{
      position: 'relative',
      width: cfg.clockSize,
      height: cfg.clockSize,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Number markers */}
      {showNumbers && labels.map((label, i) => {
        const angle = (i / 12) * 360;
        const radians = (angle * Math.PI) / 180;
        const x = Math.sin(radians) * cfg.radius;
        const y = -Math.cos(radians) * cfg.radius;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              fontSize: cfg.fontSize,
              fontWeight: 600,
              color: 'var(--vscode-editor-foreground, #cccccc)',
              transform: `translate(${x}px, ${y}px)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {label}
          </div>
        );
      })}

      {/* Clock hands container */}
      <div style={{
        position: 'relative',
        width: cfg.clockSize * 0.6,
        height: cfg.clockSize * 0.6,
      }}>
        {/* Hour hand */}
        <div
          style={{
            position: 'absolute',
            bottom: '50%',
            left: '50%',
            height: cfg.handH,
            width: 4,
            transformOrigin: 'bottom center',
            transform: `translateX(-50%) rotate(${hoursDegrees}deg)`,
            borderRadius: 4,
            background: 'var(--vscode-editor-foreground, #cccccc)',
          }}
        />
        {/* Minute hand */}
        <div
          style={{
            position: 'absolute',
            bottom: '50%',
            left: '50%',
            height: cfg.handM,
            width: 4,
            transformOrigin: 'bottom center',
            transform: `translateX(-50%) rotate(${minutesDegrees}deg)`,
            borderRadius: 4,
            background: 'var(--vscode-descriptionForeground, #8b8b8b)',
          }}
        />
        {/* Second hand */}
        <div
          style={{
            position: 'absolute',
            bottom: '50%',
            left: '50%',
            height: cfg.handS,
            width: 2,
            transformOrigin: 'bottom center',
            transform: `translateX(-50%) rotate(${secondsDegrees}deg)`,
            borderRadius: 2,
            background: 'var(--vscode-testing-iconFailed, #f44336)',
          }}
        />
        {/* Center dot */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: cfg.centerSize,
            height: cfg.centerSize,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: 'var(--vscode-editor-foreground, #cccccc)',
          }}
        />
      </div>
    </div>
  );
};

// =====================
// Digital Clock Face Component
// =====================
interface DigitalClockFaceProps {
  time: Date;
  format: '12h' | '24h';
  showSeconds: boolean;
  showDate: boolean;
  showDayOfWeek: boolean;
  size: 'sm' | 'md' | 'lg';
}

const DigitalClockFace: React.FC<DigitalClockFaceProps> = ({
  time,
  format,
  showSeconds,
  showDate,
  showDayOfWeek,
  size,
}) => {
  const formatTime = (num: number) => String(num).padStart(2, '0');

  const hours = format === '24h' 
    ? formatTime(time.getHours()) 
    : String(time.getHours() % 12 || 12);
  const minutes = formatTime(time.getMinutes());
  const seconds = formatTime(time.getSeconds());
  const period = format === '12h' ? (time.getHours() >= 12 ? 'PM' : 'AM') : '';

  const dayOfWeek = time.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = time.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  });

  // Size-based label sizes
  const sizeConfig = {
    sm: { time: '4xl' as const, seconds: 'lg' as const, period: 'lg' as const, date: 'md' as const, day: 'md' as const },
    md: { time: '5xl' as const, seconds: 'xl' as const, period: 'xl' as const, date: 'lg' as const, day: 'lg' as const },
    lg: { time: '6xl' as const, seconds: '2xl' as const, period: '2xl' as const, date: 'xl' as const, day: 'xl' as const },
  };
  const labelSizes = sizeConfig[size];

  return (
    <>
      <WidgetContent style={{ flexDirection: 'column', gap: '8px' }}>
        {showDayOfWeek && (
          <Label size={labelSizes.day} variant="muted">{dayOfWeek}</Label>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <Label size={labelSizes.time} style={{ letterSpacing: '2px' }}>
            {hours}:{minutes}
          </Label>
          {showSeconds && (
            <Label size={labelSizes.seconds} variant="muted">:{seconds}</Label>
          )}
          {period && (
            <Label size={labelSizes.period} variant="muted">{period}</Label>
          )}
        </div>
      </WidgetContent>
      {showDate && (
        <WidgetFooter style={{ justifyContent: 'center' }}>
          <Label size={labelSizes.date} variant="muted">{dateStr}</Label>
        </WidgetFooter>
      )}
    </>
  );
};

// =====================
// Multi-Zone Clock Item
// =====================
interface TimezoneClockItemProps {
  config: TimezoneConfig;
  format: '12h' | '24h';
  showIcon?: boolean;
  layout?: 'horizontal' | 'vertical';
}

const TimezoneClockItem: React.FC<TimezoneClockItemProps> = ({ 
  config, 
  format,
  showIcon = true,
  layout = 'horizontal'
}) => {
  const [time, setTime] = useState(() => getTimeInTimezone(config.timezone));

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(getTimeInTimezone(config.timezone));
    }, 1000);
    return () => clearInterval(timer);
  }, [config.timezone]);

  const formatTime = (num: number) => String(num).padStart(2, '0');
  const hours = format === '24h' 
    ? formatTime(time.getHours()) 
    : String(time.getHours() % 12 || 12);
  const minutes = formatTime(time.getMinutes());
  const period = format === '12h' ? (time.getHours() >= 12 ? ' PM' : ' AM') : '';
  const timeStr = `${hours}:${minutes}${period}`;

  if (layout === 'vertical') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
      }}>
        <Label size="sm" variant="muted">{config.label}</Label>
        <WidgetTitle style={{ fontSize: '16px' }}>{timeStr}</WidgetTitle>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      width: '100%',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Label size="md">{config.label}</Label>
        {showIcon && (
          isDaytime(time) ? <SunIcon size={18} /> : <MoonIcon size={18} />
        )}
      </div>
      <WidgetTitle style={{ fontSize: '18px' }}>{timeStr}</WidgetTitle>
    </div>
  );
};

// =====================
// MultiZone Clock Faces
// =====================
interface MultiZoneClockProps {
  timezones: TimezoneConfig[];
  format: '12h' | '24h';
  layout: 'list-2' | 'list-4' | 'grid-4';
}

const MultiZoneClock: React.FC<MultiZoneClockProps> = ({ timezones, format, layout }) => {
  if (layout === 'list-2') {
    const zones = timezones.slice(0, 2);
    return (
      <WidgetContent style={{ flexDirection: 'column', justifyContent: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          <TimezoneClockItem config={zones[0] || DEFAULT_TIMEZONES_2[0]} format={format} showIcon />
        </div>
        <Separator />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          <TimezoneClockItem config={zones[1] || DEFAULT_TIMEZONES_2[1]} format={format} showIcon />
        </div>
      </WidgetContent>
    );
  }

  if (layout === 'list-4') {
    const zones = timezones.slice(0, 4);
    while (zones.length < 4) {
      zones.push(DEFAULT_TIMEZONES_4[zones.length]);
    }
    return (
      <WidgetContent style={{ flexDirection: 'column', justifyContent: 'center', gap: '4px' }}>
        {zones.map((zone, i) => (
          <TimezoneClockItem key={i} config={zone} format={format} showIcon={false} />
        ))}
      </WidgetContent>
    );
  }

  // grid-4 layout
  const zones = timezones.slice(0, 4);
  while (zones.length < 4) {
    zones.push(DEFAULT_TIMEZONES_4[zones.length]);
  }
  return (
    <WidgetContent>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '16px',
        width: '100%',
        alignItems: 'center',
      }}>
        {zones.map((zone, i) => (
          <TimezoneClockItem key={i} config={zone} format={format} showIcon={false} layout="vertical" />
        ))}
      </div>
    </WidgetContent>
  );
};

// =====================
// Timezone Editor Component (for multizone settings)
// =====================
interface TimezoneEditorProps {
  timezones: TimezoneConfig[];
  onChange: (timezones: TimezoneConfig[]) => void;
  maxZones: number;
}

const TimezoneEditor: React.FC<TimezoneEditorProps> = ({ timezones, onChange, maxZones }) => {
  const zones = [...timezones];
  while (zones.length < maxZones) {
    zones.push(maxZones <= 2 ? DEFAULT_TIMEZONES_2[zones.length] || { label: '', timezone: '' } : DEFAULT_TIMEZONES_4[zones.length] || { label: '', timezone: '' });
  }

  const updateZone = (index: number, field: 'label' | 'timezone', value: string) => {
    const updated = [...zones];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated.slice(0, maxZones));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--vscode-editor-foreground)' }}>
        Timezones
      </label>
      {zones.slice(0, maxZones).map((zone, i) => (
        <div key={i} style={{ display: 'flex', gap: '8px' }}>
          <Input
            type="text"
            value={zone.label}
            placeholder="Label"
            onChange={(e) => updateZone(i, 'label', e.target.value)}
            style={{ flex: 1 }}
          />
          <Input
            type="text"
            value={zone.timezone}
            placeholder="Timezone (e.g., America/New_York)"
            onChange={(e) => updateZone(i, 'timezone', e.target.value)}
            style={{ flex: 2 }}
          />
        </div>
      ))}
      <small style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>
        Use IANA timezone identifiers (e.g., America/New_York, Europe/London, Asia/Tokyo)
      </small>
    </div>
  );
};

// =====================
// Main ClockWidget Component
// =====================
export const ClockWidget: React.FC<ReactWidgetProps> = ({ config, onUpdate }) => {
  const [time, setTime] = useState(new Date());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const widgetConfig = config as unknown as ClockWidgetConfig;
  const [localConfig, setLocalConfig] = useState<ClockWidgetConfig>(widgetConfig);
  
  const face = localConfig.face || 'digital';
  const format = localConfig.format || '12h';
  const showSeconds = localConfig.showSeconds ?? false;
  const showDate = localConfig.showDate ?? true;
  const showDayOfWeek = localConfig.showDayOfWeek ?? false;
  const size = localConfig.size || 'sm';
  const timezones = localConfig.timezones || [];

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Build settings fields dynamically based on current face type
  const settingsFields = useMemo(() => {
    const fields = [...baseSettingsFields];
    
    // Add digital-specific fields when in digital mode
    if (face === 'digital') {
      fields.push(...digitalSettingsFields);
    }
    
    return fields;
  }, [face]);

  // Handle settings save
  const handleSettingsSave = useCallback((values: Record<string, unknown>) => {
    const newConfig: ClockWidgetConfig = {
      ...localConfig,
      face: values.face as ClockFace,
      size: values.size as 'sm' | 'md' | 'lg',
      format: values.format as '12h' | '24h',
      showSeconds: values.showSeconds as boolean,
      showDate: values.showDate as boolean,
      showDayOfWeek: values.showDayOfWeek as boolean,
      timezones: values.timezones as TimezoneConfig[] | undefined,
    };
    
    setLocalConfig(newConfig);
    
    // Emit update event to save to code block
    if (onUpdate) {
      onUpdate({ _config: newConfig });
    }
    
    // Dispatch custom event for WidgetRenderer
    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'settings-change',
        config: newConfig,
        widgetId: (config as unknown as Record<string, unknown>).id,
      },
    });
    document.dispatchEvent(customEvent);
  }, [localConfig, onUpdate, config]);

  // Handle timezone changes (for multizone settings panel children)
  const handleTimezoneChange = useCallback((newTimezones: TimezoneConfig[]) => {
    setLocalConfig(prev => ({ ...prev, timezones: newTimezones }));
  }, []);

  // Memoize timezone defaults
  const resolvedTimezones = useMemo(() => {
    if (timezones.length > 0) return timezones;
    if (face === 'multizone-2') return DEFAULT_TIMEZONES_2;
    return DEFAULT_TIMEZONES_4;
  }, [timezones, face]);

  // Get max zones for current face type
  const maxZones = face === 'multizone-2' ? 2 : 4;

  // Render based on clock face type
  const renderClockFace = () => {
    switch (face) {
      case 'analog':
        return (
          <WidgetContent>
            <AnalogClockFace time={time} size={size} />
          </WidgetContent>
        );

      case 'analog-numbers':
        return (
          <WidgetContent>
            <AnalogClockFace time={time} showNumbers size={size} />
          </WidgetContent>
        );

      case 'analog-roman':
        return (
          <WidgetContent>
            <AnalogClockFace time={time} showNumbers romanNumerals size={size} />
          </WidgetContent>
        );

      case 'multizone-2':
        return <MultiZoneClock timezones={resolvedTimezones} format={format} layout="list-2" />;

      case 'multizone-4-list':
        return <MultiZoneClock timezones={resolvedTimezones} format={format} layout="list-4" />;

      case 'multizone-4-grid':
        return <MultiZoneClock timezones={resolvedTimezones} format={format} layout="grid-4" />;

      case 'digital':
      default:
        return (
          <DigitalClockFace
            time={time}
            format={format}
            showSeconds={showSeconds}
            showDate={showDate}
            showDayOfWeek={showDayOfWeek}
            size={size}
          />
        );
    }
  };

  // Check if current face is multizone (needs timezone editor)
  const isMultizone = face.startsWith('multizone');

  return (
    <Widget size={size} design="default">
      {/* Settings toggle in top-right corner */}
      <WidgetHeader style={{ position: 'absolute', top: '8px', right: '8px', margin: 0 }}>
        <SettingsToggle
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          isOpen={isSettingsOpen}
        />
      </WidgetHeader>

      {renderClockFace()}

      {/* Settings Panel */}
      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Clock Settings"
          fields={settingsFields}
          values={{
            face,
            size,
            format,
            showSeconds,
            showDate,
            showDayOfWeek,
            timezones: resolvedTimezones,
          }}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        >
          {/* Timezone editor for multizone faces */}
          {isMultizone && (
            <TimezoneEditor
              timezones={resolvedTimezones}
              onChange={handleTimezoneChange}
              maxZones={maxZones}
            />
          )}
        </WidgetSettingsPanel>
      )}
    </Widget>
  );
};
