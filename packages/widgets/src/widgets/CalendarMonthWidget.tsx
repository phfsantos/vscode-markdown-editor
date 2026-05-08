/**
 * CalendarMonthWidget - Full month calendar view with navigation
 * Based on wigggle-ui calendar-03.tsx and calendar-04.tsx patterns
 * 
 * Features:
 * - Full month grid display (7 columns for days of week)
 * - Current day highlighting with badge
 * - Month/year navigation with prev/next buttons
 * - Configurable week start day (Sunday/Monday)
 * - Locale support for internationalization
 * - Settings panel for customization
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { 
  Widget, 
  WidgetContent, 
  WidgetHeader, 
  WidgetTitle
} from '../ui';
import { Button } from '../ui/Button';
import { WidgetSettingsPanel, SettingsToggle } from '../ui/WidgetSettingsPanel';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize, WidgetDesign } from '../ui/Widget';

// =====================
// SVG ICONS
// =====================

const ChevronLeftIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const ChevronRightIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M9 18l6-6-6-6" />
  </svg>
);

// =====================
// TYPE DEFINITIONS
// =====================

export interface CalendarMonthWidgetConfig {
  title?: string;
  size?: WidgetSize;
  design?: WidgetDesign;
  locale?: string;
  weekStartsOnMonday?: boolean;
  showNavigation?: boolean;
  showWeekdays?: boolean;
}

export interface CalendarMonthWidgetData {
  selectedYear?: number;
  selectedMonth?: number; // 0-11
}

// =====================
// BADGE COMPONENT
// =====================

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
}

const Badge: React.FC<BadgeProps> = ({ style, children, ...props }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '22px',
      height: '22px',
      borderRadius: '50%',
      background: 'var(--vscode-button-background, #0e639c)',
      color: 'var(--vscode-button-foreground, #ffffff)',
      fontSize: '11px',
      fontWeight: 600,
      ...style,
    }}
    {...props}
  >
    {children}
  </span>
);

// =====================
// SEPARATOR COMPONENT
// =====================

const Separator: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, ...props }) => (
  <div
    style={{
      height: '2px',
      width: '100%',
      borderRadius: '9999px',
      background: 'var(--vscode-panel-border, #3c3c3c)',
      margin: '4px 0',
      ...style,
    }}
    {...props}
  />
);

// =====================
// DEFAULT CONFIG
// =====================

const defaultConfig: CalendarMonthWidgetConfig = {
  title: '',
  size: 'sm',
  design: 'default',
  locale: 'en-US',
  weekStartsOnMonday: false,
  showNavigation: true,
  showWeekdays: true,
};

// =====================
// SETTINGS FIELDS
// =====================

const settingsFields: SettingsField[] = [
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
    key: 'design',
    label: 'Design',
    type: 'select',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'minimal', label: 'Minimal' },
      { value: 'glass', label: 'Glass' },
    ],
    defaultValue: 'default',
  },
  {
    key: 'locale',
    label: 'Language/Locale',
    type: 'select',
    options: [
      { value: 'en-US', label: 'English (US)' },
      { value: 'en-GB', label: 'English (UK)' },
      { value: 'pt-BR', label: 'Portuguese (Brazil)' },
      { value: 'es-ES', label: 'Spanish' },
      { value: 'fr-FR', label: 'French' },
      { value: 'de-DE', label: 'German' },
      { value: 'ja-JP', label: 'Japanese' },
      { value: 'zh-CN', label: 'Chinese (Simplified)' },
    ],
    defaultValue: 'en-US',
  },
  {
    key: 'weekStartsOnMonday',
    label: 'Week Starts on Monday',
    type: 'checkbox',
    defaultValue: false,
  },
  {
    key: 'showNavigation',
    label: 'Show Month Navigation',
    type: 'checkbox',
    defaultValue: true,
  },
  {
    key: 'showWeekdays',
    label: 'Show Weekday Headers',
    type: 'checkbox',
    defaultValue: true,
  },
];

// =====================
// WIDGET COMPONENT
// =====================

export const CalendarMonthWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  data,
  onUpdate 
}) => {
  const rawConfig = config as Record<string, any>;
  const widgetData = data as CalendarMonthWidgetData | undefined;
  
  // =====================
  // STATE
  // =====================
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // Local config state for immediate UI updates
  const [localConfig, setLocalConfig] = useState<CalendarMonthWidgetConfig>(() => ({
    title: rawConfig.title ?? defaultConfig.title,
    size: rawConfig.size ?? defaultConfig.size,
    design: rawConfig.design ?? defaultConfig.design,
    locale: rawConfig.locale ?? defaultConfig.locale,
    weekStartsOnMonday: rawConfig.weekStartsOnMonday ?? defaultConfig.weekStartsOnMonday,
    showNavigation: rawConfig.showNavigation ?? defaultConfig.showNavigation,
    showWeekdays: rawConfig.showWeekdays ?? defaultConfig.showWeekdays,
  }));

  // Current displayed date (for navigation)
  const now = new Date();
  const [displayDate, setDisplayDate] = useState(() => {
    const year = widgetData?.selectedYear ?? now.getFullYear();
    const month = widgetData?.selectedMonth ?? now.getMonth();
    return new Date(year, month, 1);
  });

  // =====================
  // SYNC EFFECTS
  // =====================

  // Sync with external config changes
  useEffect(() => {
    setLocalConfig({
      title: rawConfig.title ?? defaultConfig.title,
      size: rawConfig.size ?? defaultConfig.size,
      design: rawConfig.design ?? defaultConfig.design,
      locale: rawConfig.locale ?? defaultConfig.locale,
      weekStartsOnMonday: rawConfig.weekStartsOnMonday ?? defaultConfig.weekStartsOnMonday,
      showNavigation: rawConfig.showNavigation ?? defaultConfig.showNavigation,
      showWeekdays: rawConfig.showWeekdays ?? defaultConfig.showWeekdays,
    });
  }, [
    rawConfig.title, rawConfig.size, rawConfig.design, rawConfig.locale,
    rawConfig.weekStartsOnMonday, rawConfig.showNavigation, rawConfig.showWeekdays
  ]);

  // Sync with external data changes
  useEffect(() => {
    if (widgetData?.selectedYear !== undefined && widgetData?.selectedMonth !== undefined) {
      setDisplayDate(new Date(widgetData.selectedYear, widgetData.selectedMonth, 1));
    }
  }, [widgetData?.selectedYear, widgetData?.selectedMonth]);

  // =====================
  // COMPUTED VALUES
  // =====================

  const { size, design, locale, weekStartsOnMonday, showNavigation, showWeekdays } = localConfig;

  const year = displayDate.getFullYear();
  const month = displayDate.getMonth();

  // Calculate calendar days with filler days for proper grid alignment
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Adjust for week starting on Monday
    let startOffset = weekStartsOnMonday 
      ? (firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1)
      : firstDayOfMonth;
    
    const fillerDays = Array(startOffset).fill(null);
    const monthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    
    return [...fillerDays, ...monthDays];
  }, [year, month, weekStartsOnMonday]);

  // Get weekday labels
  const weekdayLabels = useMemo(() => {
    // Use a fixed date set (a week with known days)
    // Jan 4, 2025 is a Saturday
    const baseDate = weekStartsOnMonday ? new Date(2025, 0, 6) : new Date(2025, 0, 5); // Mon vs Sun
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() + i);
      return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)[0];
    });
  }, [locale, weekStartsOnMonday]);

  // Get month name
  const monthName = useMemo(() => {
    return new Intl.DateTimeFormat(locale, { month: 'short' }).format(displayDate);
  }, [locale, displayDate]);

  // Check if a day is today
  const isToday = useCallback((day: number | null): boolean => {
    if (day === null) return false;
    const today = new Date();
    return (
      year === today.getFullYear() &&
      month === today.getMonth() &&
      day === today.getDate()
    );
  }, [year, month]);

  // =====================
  // EVENT HANDLERS
  // =====================

  // Navigate months
  const changeMonth = useCallback((step: number) => {
    setDisplayDate(prev => {
      const newDate = new Date(prev.getFullYear(), prev.getMonth() + step, 1);
      
      // Emit update event to persist navigation state
      const newData: CalendarMonthWidgetData = {
        selectedYear: newDate.getFullYear(),
        selectedMonth: newDate.getMonth(),
      };
      
      if (onUpdate) {
        onUpdate({ ...newData, _config: localConfig });
      }
      
      const customEvent = new CustomEvent('widget-update', {
        bubbles: true,
        detail: {
          type: 'data-change',
          data: newData,
          config: { type: rawConfig.type, ...localConfig },
          widgetId: rawConfig.id,
        },
      });
      document.dispatchEvent(customEvent);
      
      return newDate;
    });
  }, [onUpdate, localConfig, rawConfig]);

  // Handle settings save
  const handleSettingsSave = useCallback((values: Record<string, any>) => {
    const newConfig: CalendarMonthWidgetConfig = {
      title: values.title ?? localConfig.title,
      size: values.size ?? localConfig.size,
      design: values.design ?? localConfig.design,
      locale: values.locale ?? localConfig.locale,
      weekStartsOnMonday: values.weekStartsOnMonday ?? localConfig.weekStartsOnMonday,
      showNavigation: values.showNavigation ?? localConfig.showNavigation,
      showWeekdays: values.showWeekdays ?? localConfig.showWeekdays,
    };
    setLocalConfig(newConfig);

    const updatedConfig = {
      type: rawConfig.type,
      ...newConfig,
    };

    if (onUpdate) {
      onUpdate({ config: updatedConfig });
    }

    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'settings-change',
        config: updatedConfig,
        data: { selectedYear: year, selectedMonth: month },
        widgetId: rawConfig.id,
      },
    });
    document.dispatchEvent(customEvent);

    setIsSettingsOpen(false);
  }, [onUpdate, rawConfig, localConfig, year, month]);

  // =====================
  // SIZE-BASED STYLES
  // =====================

  const sizeStyles = useMemo(() => {
    switch (size) {
      case 'lg':
        return {
          cellSize: '32px',
          fontSize: '14px',
          headerFontSize: '16px',
          gap: '4px',
        };
      case 'md':
        return {
          cellSize: '26px',
          fontSize: '12px',
          headerFontSize: '14px',
          gap: '3px',
        };
      case 'sm':
      default:
        return {
          cellSize: '20px',
          fontSize: '11px',
          headerFontSize: '13px',
          gap: '2px',
        };
    }
  }, [size]);

  // =====================
  // RENDER
  // =====================

  return (
    <Widget size={size} design={design} style={{ position: 'relative' }}>
      {/* Header with Navigation */}
      <WidgetHeader style={{ alignItems: 'center', gap: '4px' }}>
        {showNavigation && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => changeMonth(-1)}
            title="Previous month"
            style={{ 
              width: '20px', 
              height: '20px', 
              padding: 0,
              minWidth: 'unset',
            }}
          >
            <ChevronLeftIcon size={14} />
          </Button>
        )}
        
        <WidgetTitle style={{ 
          flex: 1, 
          textAlign: 'center',
          fontSize: sizeStyles.headerFontSize,
        }}>
          {monthName} {year}
        </WidgetTitle>
        
        {showNavigation && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => changeMonth(1)}
            title="Next month"
            style={{ 
              width: '20px', 
              height: '20px', 
              padding: 0,
              minWidth: 'unset',
            }}
          >
            <ChevronRightIcon size={14} />
          </Button>
        )}
        
        <SettingsToggle
          isOpen={isSettingsOpen}
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
        />
      </WidgetHeader>

      <Separator />

      {/* Calendar Grid */}
      <WidgetContent style={{ 
        flexDirection: 'column',
        padding: '4px',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
      }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: sizeStyles.gap,
            width: '100%',
            textAlign: 'center',
          }}
        >
          {/* Weekday headers */}
          {showWeekdays && weekdayLabels.map((day, i) => (
            <div
              key={`weekday-${i}-${day}`}
              style={{
                fontSize: sizeStyles.fontSize,
                fontWeight: 600,
                color: 'var(--vscode-editor-foreground, #cccccc)',
                padding: '2px 0',
              }}
            >
              {day}
            </div>
          ))}

          {/* Calendar days */}
          {calendarDays.map((day, i) => (
            <div
              key={`day-${i}`}
              style={{
                fontSize: sizeStyles.fontSize,
                color: day === null 
                  ? 'transparent' 
                  : 'var(--vscode-descriptionForeground, #8b8b8b)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: sizeStyles.cellSize,
              }}
            >
              {day !== null && (
                isToday(day) ? (
                  <Badge style={{ 
                    width: sizeStyles.cellSize, 
                    height: sizeStyles.cellSize,
                    fontSize: sizeStyles.fontSize,
                  }}>
                    {day}
                  </Badge>
                ) : (
                  day
                )
              )}
            </div>
          ))}
        </div>
      </WidgetContent>

      {/* Settings Panel */}
      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Calendar Month Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </Widget>
  );
};
