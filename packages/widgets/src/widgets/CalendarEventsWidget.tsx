/**
 * CalendarEventsWidget - Display calendar events for a specific day
 * Based on wigggle-ui calendar-05.tsx, calendar-06.tsx, and calendar-02.tsx patterns
 * 
 * Features:
 * - Display today's date with weekday, day number, and month
 * - Show list of events with time, title, and color-coded borders
 * - Add event button for creating new events
 * - Receive events via custom DOM events (for Google/Outlook integration)
 * - Size variants: sm (compact), md (with mini calendar), lg (full featured)
 * - Settings panel for customization
 * - Video/action buttons for events with actions
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { 
  Widget, 
  WidgetContent, 
  WidgetHeader, 
  WidgetTitle,
  WidgetFooter,
  Label
} from '../ui';
import { Button } from '../ui/Button';
import { WidgetSettingsPanel, SettingsToggle } from '../ui/WidgetSettingsPanel';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize, WidgetDesign } from '../ui/Widget';

// =====================
// GLOBAL STYLES (inject spin keyframe if not present)
// =====================
if (typeof document !== 'undefined') {
  const styleId = 'calendar-widget-keyframes';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

// =====================
// SVG ICONS
// =====================

const PlusIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
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
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const VideoIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
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
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

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

const ExternalLinkIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
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
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const RefreshIcon: React.FC<{ size?: number; spinning?: boolean }> = ({ size = 16, spinning }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}
  >
    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
  </svg>
);

const OutlookIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="currentColor"
  >
    <path d="M7.88 12.04c0 1.54-.11 2.8-.34 3.78-.23.97-.55 1.76-.98 2.36-.43.6-.96 1.04-1.56 1.32-.6.29-1.29.43-2.06.43-.91 0-1.7-.17-2.35-.51-.65-.34-1.18-.81-1.59-1.42-.41-.6-.72-1.32-.91-2.15-.19-.84-.29-1.76-.29-2.77 0-1.59.13-2.92.39-3.99.27-1.07.64-1.94 1.11-2.62.47-.68 1.03-1.17 1.67-1.48.64-.31 1.34-.47 2.09-.47.73 0 1.39.11 1.97.34.58.23 1.07.55 1.47.98.39.42.69.93.9 1.52.21.59.31 1.26.31 2 0 .34-.04.67-.13 1h-5.05c.06.47.17.88.32 1.24.15.37.37.65.65.86.28.21.62.31 1.02.31.43 0 .78-.11 1.06-.32.27-.22.48-.52.63-.92.15-.4.22-.88.22-1.44zm-1.54-1.3c-.01-.37-.07-.7-.18-1-.11-.29-.28-.52-.5-.68-.23-.17-.52-.25-.87-.25-.32 0-.6.08-.85.23-.25.15-.45.37-.61.66-.16.28-.27.61-.33.99h3.34zM24 12.04c0 1.54-.11 2.8-.34 3.78-.23.97-.55 1.76-.98 2.36-.43.6-.96 1.04-1.56 1.32-.6.29-1.29.43-2.06.43-.91 0-1.7-.17-2.35-.51-.65-.34-1.18-.81-1.59-1.42-.41-.6-.72-1.32-.91-2.15-.19-.84-.29-1.76-.29-2.77 0-1.59.13-2.92.39-3.99.27-1.07.64-1.94 1.11-2.62.47-.68 1.03-1.17 1.67-1.48.64-.31 1.34-.47 2.09-.47.73 0 1.39.11 1.97.34.58.23 1.07.55 1.47.98.39.42.69.93.9 1.52.21.59.31 1.26.31 2 0 .34-.04.67-.13 1h-5.05c.06.47.17.88.32 1.24.15.37.37.65.65.86.28.21.62.31 1.02.31.43 0 .78-.11 1.06-.32.27-.22.48-.52.63-.92.15-.4.22-.88.22-1.44zm-1.54-1.3c-.01-.37-.07-.7-.18-1-.11-.29-.28-.52-.5-.68-.23-.17-.52-.25-.87-.25-.32 0-.6.08-.85.23-.25.15-.45.37-.61.66-.16.28-.27.61-.33.99h3.34zM12 2L4 5v7c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3z" />
  </svg>
);

const GoogleIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="currentColor"
  >
    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
  </svg>
);

// =====================
// TYPE DEFINITIONS
// =====================

/** Calendar event structure */
export interface CalendarEvent {
  /** Unique event identifier */
  id: string;
  /** Event title */
  title: string;
  /** Time display string (e.g., "9 AM", "9:00 - 10:30 AM") */
  time: string;
  /** Start time as ISO string or Date (for sorting) */
  startTime?: string;
  /** End time as ISO string or Date */
  endTime?: string;
  /** Color for the event border (CSS color or preset) */
  color?: string;
  /** Whether event has a video/meeting link */
  hasVideo?: boolean;
  /** External link URL (for opening in browser) */
  link?: string;
  /** Event description */
  description?: string;
  /** Calendar source (google, outlook, local) */
  source?: 'google' | 'outlook' | 'local';
  /** Whether the event is all-day */
  allDay?: boolean;
  /** Event location */
  location?: string;
}

/** Widget configuration */
export interface CalendarEventsWidgetConfig {
  /** Widget title */
  title?: string;
  /** Widget size variant */
  size?: WidgetSize;
  /** Widget design variant */
  design?: WidgetDesign;
  /** Locale for date formatting */
  locale?: string;
  /** Show the add event button */
  showAddButton?: boolean;
  /** Show mini calendar in md/lg sizes */
  showMiniCalendar?: boolean;
  /** Show event count badge */
  showEventCount?: boolean;
  /** Max events to display (0 = unlimited) */
  maxEvents?: number;
  /** Custom event ID for receiving events */
  eventChannel?: string;
  /** Calendar provider to use: 'outlook', 'google', or 'all' */
  provider?: 'outlook' | 'google' | 'all';
  /** Auto-fetch events on date change */
  autoFetch?: boolean;
}

/** Widget persistent data */
export interface CalendarEventsWidgetData {
  /** Selected date (ISO string) */
  selectedDate?: string;
  /** Stored events */
  events?: CalendarEvent[];
  /** Auth state for each provider */
  authState?: Record<string, { authenticated: boolean; email?: string }>;
}

// =====================
// PRESET COLORS
// =====================

const EVENT_COLORS: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  teal: '#14b8a6',
  // Default fallback
  default: 'var(--vscode-button-background, #0e639c)',
};

function getEventColor(color?: string): string {
  if (!color) return EVENT_COLORS.default;
  // Check if it's a preset name
  if (EVENT_COLORS[color.toLowerCase()]) {
    return EVENT_COLORS[color.toLowerCase()];
  }
  // Otherwise use the color directly (CSS color value)
  return color;
}

// =====================
// BADGE COMPONENT
// =====================

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline';
  children?: React.ReactNode;
}

const Badge: React.FC<BadgeProps> = ({ 
  variant = 'secondary', 
  style, 
  children, 
  ...props 
}) => {
  const variantStyles: Record<string, React.CSSProperties> = {
    default: {
      background: 'var(--vscode-button-background, #0e639c)',
      color: 'var(--vscode-button-foreground, #ffffff)',
    },
    secondary: {
      background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
      color: 'var(--vscode-button-secondaryForeground, #cccccc)',
    },
    outline: {
      background: 'transparent',
      border: '1px solid var(--vscode-panel-border, #454545)',
      color: 'var(--vscode-editor-foreground, #cccccc)',
    },
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '11px',
        fontWeight: 500,
        gap: '4px',
        ...variantStyles[variant],
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
};

// =====================
// MINI CALENDAR COMPONENT (for md/lg sizes)
// =====================

interface MiniCalendarProps {
  date: Date;
  locale: string;
  onDateChange: (date: Date) => void;
  eventDates?: Set<number>; // Days of month that have events
}

const MiniCalendar: React.FC<MiniCalendarProps> = ({ 
  date, 
  locale, 
  onDateChange,
  eventDates 
}) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = new Date();

  const monthName = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
  
  const weekdayLabels = useMemo(() => {
    const baseDate = new Date(2025, 0, 5); // A Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() + i);
      return new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(d);
    });
  }, [locale]);

  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const fillerDays = Array(firstDayOfMonth).fill(null);
    const monthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    return [...fillerDays, ...monthDays];
  }, [year, month]);

  const isToday = (day: number | null): boolean => {
    if (day === null) return false;
    return (
      year === today.getFullYear() &&
      month === today.getMonth() &&
      day === today.getDate()
    );
  };

  const isSelected = (day: number | null): boolean => {
    if (day === null) return false;
    return day === date.getDate();
  };

  const hasEvent = (day: number | null): boolean => {
    if (day === null || !eventDates) return false;
    return eventDates.has(day);
  };

  const changeMonth = (step: number) => {
    const newDate = new Date(year, month + step, 1);
    onDateChange(newDate);
  };

  const selectDay = (day: number) => {
    const newDate = new Date(year, month, day);
    onDateChange(newDate);
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '4px',
      padding: '8px',
      background: 'var(--vscode-editor-background, #1e1e1e)',
      borderRadius: '6px',
      border: '1px solid var(--vscode-panel-border, #3c3c3c)',
    }}>
      {/* Header with navigation */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        marginBottom: '4px',
      }}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => changeMonth(-1)}
          style={{ width: '20px', height: '20px', padding: 0 }}
        >
          <ChevronLeftIcon size={12} />
        </Button>
        <Label size="sm" style={{ fontWeight: 600 }}>
          {monthName} {year}
        </Label>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => changeMonth(1)}
          style={{ width: '20px', height: '20px', padding: 0 }}
        >
          <ChevronRightIcon size={12} />
        </Button>
      </div>

      {/* Calendar grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '2px',
        textAlign: 'center',
      }}>
        {/* Weekday headers */}
        {weekdayLabels.map((day, i) => (
          <div
            key={`weekday-${i}`}
            style={{
              fontSize: '9px',
              fontWeight: 600,
              color: 'var(--vscode-descriptionForeground, #8b8b8b)',
              padding: '2px',
            }}
          >
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {calendarDays.map((day, i) => (
          <div
            key={`day-${i}`}
            onClick={() => day !== null && selectDay(day)}
            style={{
              fontSize: '10px',
              padding: '3px',
              borderRadius: '50%',
              cursor: day !== null ? 'pointer' : 'default',
              background: isSelected(day) 
                ? 'var(--vscode-button-background, #0e639c)'
                : isToday(day)
                  ? 'var(--vscode-button-secondaryBackground, #3a3d41)'
                  : 'transparent',
              color: isSelected(day)
                ? 'var(--vscode-button-foreground, #ffffff)'
                : day === null 
                  ? 'transparent' 
                  : 'var(--vscode-editor-foreground, #cccccc)',
              fontWeight: isToday(day) ? 600 : 400,
              position: 'relative',
              transition: 'background 0.15s ease',
            }}
          >
            {day}
            {/* Event indicator dot */}
            {hasEvent(day) && !isSelected(day) && (
              <div style={{
                position: 'absolute',
                bottom: '1px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '3px',
                height: '3px',
                borderRadius: '50%',
                background: 'var(--vscode-button-background, #0e639c)',
              }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// =====================
// EVENT ITEM COMPONENT
// =====================

interface EventItemProps {
  event: CalendarEvent;
  compact?: boolean;
  onEventClick?: (event: CalendarEvent) => void;
}

const EventItem: React.FC<EventItemProps> = ({ event, compact, onEventClick }) => {
  const borderColor = getEventColor(event.color);

  const handleClick = () => {
    if (event.link) {
      // Dispatch event to open link in browser
      window.dispatchEvent(new CustomEvent('calendar-event-action', {
        detail: { type: 'open-link', event }
      }));
    }
    onEventClick?.(event);
  };

  const handleVideoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('calendar-event-action', {
      detail: { type: 'join-video', event }
    }));
  };

  if (compact) {
    // Compact style for sm size (like calendar-05)
    return (
      <Badge
        variant="secondary"
        style={{
          display: 'flex',
          width: 'calc(100% - 23px)',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: '4px',
          cursor: event.link ? 'pointer' : 'default',
        }}
        onClick={handleClick}
      >
        <span style={{ fontWeight: 500 }}>{event.title}</span>
        <span style={{ 
          color: 'var(--vscode-descriptionForeground, #8b8b8b)',
          fontSize: '10px',
        }}>
          {event.time}
        </span>
      </Badge>
    );
  }

  // Full style for md/lg sizes (like calendar-06)
  return (
    <div 
      style={{ 
        display: 'flex', 
        width: '100%', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        cursor: event.link ? 'pointer' : 'default',
      }}
      onClick={handleClick}
    >
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{
          width: '3px',
          minHeight: '32px',
          borderRadius: '2px',
          background: borderColor,
        }} />
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          paddingLeft: '8px',
          gap: '2px',
        }}>
          <Label 
            size="sm" 
            variant="muted"
            style={{ fontSize: '10px' }}
          >
            {event.time}
          </Label>
          <Label size="sm" style={{ fontWeight: 400 }}>
            {event.title}
          </Label>
          {event.location && (
            <Label 
              size="sm" 
              variant="muted"
              style={{ fontSize: '10px' }}
            >
              📍 {event.location}
            </Label>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {event.hasVideo && (
          <Button 
            variant="outline" 
            size="icon"
            onClick={handleVideoClick}
            title="Join video call"
            style={{ width: '24px', height: '24px', padding: 0 }}
          >
            <VideoIcon size={12} />
          </Button>
        )}
        {event.link && !event.hasVideo && (
          <Button 
            variant="outline" 
            size="icon"
            onClick={handleClick}
            title="Open event"
            style={{ width: '24px', height: '24px', padding: 0 }}
          >
            <ExternalLinkIcon size={12} />
          </Button>
        )}
      </div>
    </div>
  );
};

// =====================
// DEFAULT CONFIG
// =====================

const defaultConfig: CalendarEventsWidgetConfig = {
  title: '',
  size: 'sm',
  design: 'default',
  locale: 'en-US',
  showAddButton: true,
  showMiniCalendar: true,
  showEventCount: true,
  maxEvents: 0,
  eventChannel: 'calendar-events',
  provider: 'outlook',
  autoFetch: true,
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
      { value: 'sm', label: 'Small (Events only)' },
      { value: 'md', label: 'Medium (With mini calendar)' },
      { value: 'lg', label: 'Large (Full featured)' },
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
    key: 'provider',
    label: 'Calendar Provider',
    type: 'select',
    options: [
      { value: 'outlook', label: 'Microsoft Outlook' },
      { value: 'google', label: 'Google Calendar' },
      { value: 'all', label: 'All Connected' },
    ],
    defaultValue: 'outlook',
  },
  {
    key: 'autoFetch',
    label: 'Auto-fetch events on date change',
    type: 'checkbox',
    defaultValue: true,
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
    key: 'showAddButton',
    label: 'Show Add Event Button',
    type: 'checkbox',
    defaultValue: true,
  },
  {
    key: 'showMiniCalendar',
    label: 'Show Mini Calendar (md/lg)',
    type: 'checkbox',
    defaultValue: true,
  },
  {
    key: 'showEventCount',
    label: 'Show Event Count Badge',
    type: 'checkbox',
    defaultValue: true,
  },
  {
    key: 'maxEvents',
    label: 'Max Events to Show (0 = all)',
    type: 'number',
    defaultValue: 0,
  },
  {
    key: 'eventChannel',
    label: 'Event Channel ID',
    type: 'text',
    placeholder: 'calendar-events',
  },
];

// =====================
// WIDGET COMPONENT
// =====================

export const CalendarEventsWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  data,
  onUpdate 
}) => {
  const rawConfig = config as Record<string, any>;
  const widgetData = data as CalendarEventsWidgetData | undefined;
  const widgetRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  // Track pending requests so we only handle responses for our own requests
  const pendingRequestIds = useRef<Set<number>>(new Set());
  
  // Ref to hold the persist function so it can be called from event handlers without re-registering
  const persistEventsRef = useRef<((newEvents: CalendarEvent[]) => void) | null>(null);
  
  // DEBUG: Log widget mount/initialization
  console.log(`[CalendarWidget] INITIALIZED with id=${rawConfig.id}, type=${rawConfig.type}, dataEvents=${widgetData?.events?.length || 0}`);
  
  // =====================
  // STATE
  // =====================
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<Record<string, { authenticated: boolean; email?: string }>>(() => 
    widgetData?.authState || {}
  );
  
  // Local config state
  const [localConfig, setLocalConfig] = useState<CalendarEventsWidgetConfig>(() => ({
    title: rawConfig.title ?? defaultConfig.title,
    size: rawConfig.size ?? defaultConfig.size,
    design: rawConfig.design ?? defaultConfig.design,
    locale: rawConfig.locale ?? defaultConfig.locale,
    showAddButton: rawConfig.showAddButton ?? defaultConfig.showAddButton,
    showMiniCalendar: rawConfig.showMiniCalendar ?? defaultConfig.showMiniCalendar,
    showEventCount: rawConfig.showEventCount ?? defaultConfig.showEventCount,
    maxEvents: rawConfig.maxEvents ?? defaultConfig.maxEvents,
    eventChannel: rawConfig.eventChannel ?? defaultConfig.eventChannel,
    provider: rawConfig.provider ?? defaultConfig.provider,
    autoFetch: rawConfig.autoFetch ?? defaultConfig.autoFetch,
  }));

  // Selected date for viewing events
  // For small widgets, always default to today so the widget shows current events
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    // Small widgets should always start with today's date for immediate relevance
    if (rawConfig.size === 'sm') {
      return new Date();
    }
    // For other sizes, use stored date if available
    if (widgetData?.selectedDate) {
      return new Date(widgetData.selectedDate);
    }
    return new Date();
  });

  // Events list (can be updated via custom events)
  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    return widgetData?.events || [];
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
      showAddButton: rawConfig.showAddButton ?? defaultConfig.showAddButton,
      showMiniCalendar: rawConfig.showMiniCalendar ?? defaultConfig.showMiniCalendar,
      showEventCount: rawConfig.showEventCount ?? defaultConfig.showEventCount,
      maxEvents: rawConfig.maxEvents ?? defaultConfig.maxEvents,
      eventChannel: rawConfig.eventChannel ?? defaultConfig.eventChannel,
      provider: rawConfig.provider ?? defaultConfig.provider,
      autoFetch: rawConfig.autoFetch ?? defaultConfig.autoFetch,
    });
  }, [
    rawConfig.title, rawConfig.size, rawConfig.design, rawConfig.locale,
    rawConfig.showAddButton, rawConfig.showMiniCalendar, rawConfig.showEventCount,
    rawConfig.maxEvents, rawConfig.eventChannel, rawConfig.provider, rawConfig.autoFetch
  ]);

  // Sync with external data changes
  useEffect(() => {
    console.log(`[CalendarWidget ${rawConfig.id}] Sync effect triggered:`, {
      widgetId: rawConfig.id,
      hasWidgetData: !!widgetData,
      widgetDataEvents: widgetData?.events?.length || 0,
      widgetDataSelectedDate: widgetData?.selectedDate
    });
    
    if (widgetData?.selectedDate) {
      setSelectedDate(new Date(widgetData.selectedDate));
    }
    if (widgetData?.events) {
      setEvents(widgetData.events);
    }
    if (widgetData?.authState) {
      setAuthState(widgetData.authState);
    }
  }, [widgetData?.selectedDate, widgetData?.events, widgetData?.authState, rawConfig.id]);

  // Listen for calendar events from extension (via main.ts bridge)
  useEffect(() => {
    const handleCalendarEventsFromExtension = (e: Event) => {
      const customEvent = e as CustomEvent<{
        requestId?: number;
        provider?: string;
        date?: string;
        events?: CalendarEvent[];
      }>;
      
      const { requestId, events: newEvents } = customEvent.detail;
      
      // DEBUG: Log all event receptions with widget ID
      console.log(`[CalendarWidget ${rawConfig.id}] Received calendar-events:`, {
        requestId,
        myPendingIds: [...pendingRequestIds.current],
        willProcess: requestId !== undefined && pendingRequestIds.current.has(requestId),
        eventCount: newEvents?.length || 0
      });
      
      // Only handle responses for our own requests (strict isolation)
      // If no requestId, or requestId doesn't match our pending requests, ignore
      if (requestId === undefined || !pendingRequestIds.current.has(requestId)) {
        console.log(`[CalendarWidget ${rawConfig.id}] IGNORING - not our request`);
        return; // Not our request, ignore
      }
      
      // Clear the pending request
      pendingRequestIds.current.delete(requestId);
      
      console.log(`[CalendarWidget ${rawConfig.id}] PROCESSING events:`, newEvents?.length || 0, 'events');
      
      if (newEvents) {
        setEvents(newEvents);
        setIsLoading(false);
        setError(null);
        
        // CRITICAL: Persist events to code block so they survive widget re-renders
        // This is necessary because dashboard widgets get re-created after code block updates
        if (persistEventsRef.current) {
          persistEventsRef.current(newEvents);
        }
      }
    };

    const handleCalendarLoading = (e: Event) => {
      const customEvent = e as CustomEvent<{ requestId?: number; loading?: boolean }>;
      const { requestId, loading } = customEvent.detail;
      
      // Only handle responses for our own requests (strict isolation)
      if (requestId === undefined || !pendingRequestIds.current.has(requestId)) {
        return;
      }
      
      if (loading) {
        setIsLoading(true);
        setError(null);
      }
    };

    const handleCalendarError = (e: Event) => {
      const customEvent = e as CustomEvent<{ requestId?: number; error?: string }>;
      const { requestId, error: errMsg } = customEvent.detail;
      
      // Only handle responses for our own requests (strict isolation)
      if (requestId === undefined || !pendingRequestIds.current.has(requestId)) {
        return;
      }
      
      // Clear the pending request
      pendingRequestIds.current.delete(requestId);
      
      setIsLoading(false);
      setError(errMsg || 'Failed to fetch events');
    };

    const handleCalendarAuthResult = (e: Event) => {
      const customEvent = e as CustomEvent<{
        requestId?: number;
        provider?: string;
        success?: boolean;
        error?: string;
      }>;
      
      const { requestId, provider, success, error: authError } = customEvent.detail;
      
      // Only handle responses for our own requests (strict isolation)
      if (requestId === undefined || !pendingRequestIds.current.has(requestId)) {
        return;
      }
      
      // Don't clear the pending request here - we'll receive calendar-events with the same requestId
      // Only clear if auth failed
      if (!success) {
        pendingRequestIds.current.delete(requestId);
      }
      
      if (provider) {
        setAuthState(prev => ({
          ...prev,
          [provider]: { authenticated: success || false }
        }));
      }
      
      if (!success && authError) {
        setError(authError);
        setIsLoading(false);
      }
      // Don't set isLoading to false on success - wait for events to arrive
    };

    const handleCalendarSignOutResult = (e: Event) => {
      const customEvent = e as CustomEvent<{
        requestId?: number;
        provider?: string;
        success?: boolean;
      }>;
      
      const { requestId, provider, success } = customEvent.detail;
      
      // Only handle responses for our own requests (strict isolation)
      if (requestId === undefined || !pendingRequestIds.current.has(requestId)) {
        return;
      }
      
      // Clear the pending request
      pendingRequestIds.current.delete(requestId);
      
      if (provider && success) {
        setAuthState(prev => ({
          ...prev,
          [provider]: { authenticated: false }
        }));
        // Clear events when signing out
        setEvents([]);
      }
    };

    // Listen for events from extension
    window.addEventListener('calendar-events', handleCalendarEventsFromExtension);
    window.addEventListener('calendar-loading', handleCalendarLoading);
    window.addEventListener('calendar-error', handleCalendarError);
    window.addEventListener('calendar-auth-result', handleCalendarAuthResult);
    window.addEventListener('calendar-signout-result', handleCalendarSignOutResult);

    return () => {
      window.removeEventListener('calendar-events', handleCalendarEventsFromExtension);
      window.removeEventListener('calendar-loading', handleCalendarLoading);
      window.removeEventListener('calendar-error', handleCalendarError);
      window.removeEventListener('calendar-auth-result', handleCalendarAuthResult);
      window.removeEventListener('calendar-signout-result', handleCalendarSignOutResult);
    };
  }, []);

  // Listen for external calendar events via custom DOM events (legacy channel)
  useEffect(() => {
    const eventChannel = localConfig.eventChannel || 'calendar-events';
    
    const handleCalendarEvents = (e: Event) => {
      const customEvent = e as CustomEvent<{
        events?: CalendarEvent[];
        action?: 'set' | 'add' | 'remove' | 'clear';
        eventId?: string;
        requestId?: number; // Extension events have requestId
      }>;
      
      const { events: newEvents, action, eventId, requestId } = customEvent.detail;
      
      // CRITICAL: If the event has a requestId, it's from the extension and should be
      // handled by the dedicated handler (handleCalendarEventsFromExtension) which 
      // properly filters by requestId for widget isolation. Skip here to avoid duplicate processing.
      if (requestId !== undefined) {
        return;
      }
      
      // Legacy channel events use 'action' field - default to 'set' only if no requestId
      const eventAction = action || 'set';
      
      switch (eventAction) {
        case 'set':
          if (newEvents) {
            setEvents(newEvents);
          }
          break;
        case 'add':
          if (newEvents) {
            setEvents(prev => [...prev, ...newEvents]);
          }
          break;
        case 'remove':
          if (eventId) {
            setEvents(prev => prev.filter(e => e.id !== eventId));
          }
          break;
        case 'clear':
          setEvents([]);
          break;
      }
    };

    // Listen on both window and document for flexibility
    window.addEventListener(eventChannel, handleCalendarEvents);
    document.addEventListener(eventChannel, handleCalendarEvents);

    return () => {
      window.removeEventListener(eventChannel, handleCalendarEvents);
      document.removeEventListener(eventChannel, handleCalendarEvents);
    };
  }, [localConfig.eventChannel]);

  // =====================
  // COMPUTED VALUES
  // =====================

  const { size, design, locale, showAddButton, showMiniCalendar, showEventCount, maxEvents } = localConfig;

  // Format date strings
  const day = useMemo(() => 
    selectedDate.toLocaleDateString(locale, { weekday: 'long' }), 
    [selectedDate, locale]
  );
  
  const dateNumber = selectedDate.getDate().toString().padStart(2, '0');
  
  const month = useMemo(() => 
    selectedDate.toLocaleDateString(locale, { month: 'long' }), 
    [selectedDate, locale]
  );

  // Filter and sort events for display
  const displayEvents = useMemo(() => {
    let filtered = [...events];
    
    // Sort by start time if available
    filtered.sort((a, b) => {
      if (a.startTime && b.startTime) {
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      }
      return 0;
    });
    
    // Limit if maxEvents is set
    if (maxEvents && maxEvents > 0) {
      filtered = filtered.slice(0, maxEvents);
    }
    
    return filtered;
  }, [events, maxEvents]);

  // Get days that have events (for mini calendar dots)
  const eventDates = useMemo(() => {
    const dates = new Set<number>();
    events.forEach(event => {
      if (event.startTime) {
        const eventDate = new Date(event.startTime);
        if (eventDate.getMonth() === selectedDate.getMonth() && 
            eventDate.getFullYear() === selectedDate.getFullYear()) {
          dates.add(eventDate.getDate());
        }
      }
    });
    return dates;
  }, [events, selectedDate]);

  // =====================
  // EVENT HANDLERS
  // =====================

  const emitUpdate = useCallback((
    updatedData: CalendarEventsWidgetData, 
    updatedConfig?: CalendarEventsWidgetConfig
  ) => {
    // DEBUG: Log every emitUpdate call with widget ID
    console.log(`[CalendarWidget ${rawConfig.id}] emitUpdate called:`, {
      widgetId: rawConfig.id,
      eventsCount: updatedData.events?.length || 0,
      selectedDate: updatedData.selectedDate,
      hasConfig: !!updatedConfig
    });
    console.trace(`[CalendarWidget ${rawConfig.id}] emitUpdate call stack`);
    
    if (onUpdate) {
      onUpdate({ ...updatedData, _config: updatedConfig || localConfig });
    }

    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'data-change',
        data: updatedData,
        config: { type: rawConfig.type, ...updatedConfig || localConfig },
        widgetId: rawConfig.id,
      },
    });
    document.dispatchEvent(customEvent);
  }, [onUpdate, localConfig, rawConfig]);

  // Update the persist ref so event handlers can access the current emitUpdate
  // This allows us to persist events received from the extension without re-registering event handlers
  persistEventsRef.current = useCallback((newEvents: CalendarEvent[]) => {
    // Dispatch widget-update event to persist to code block
    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'data-change',
        data: { 
          selectedDate: selectedDate.toISOString(), 
          events: newEvents,
          authState 
        },
        config: { type: rawConfig.type, ...localConfig },
        widgetId: rawConfig.id,
      },
    });
    console.log(`[CalendarWidget ${rawConfig.id}] Persisting ${newEvents.length} events to code block`);
    document.dispatchEvent(customEvent);
  }, [selectedDate, authState, localConfig, rawConfig]);

  const handleDateChange = useCallback((newDate: Date) => {
    console.log(`[CalendarWidget ${rawConfig.id}] handleDateChange called:`, {
      widgetId: rawConfig.id,
      newDate: newDate.toISOString(),
      currentEvents: events.length
    });
    
    setSelectedDate(newDate);
    emitUpdate({ 
      selectedDate: newDate.toISOString(), 
      events,
      authState,
    });
    
    // Auto-fetch events if enabled
    if (localConfig.autoFetch && localConfig.provider) {
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      pendingRequestIds.current.add(requestId);
      
      window.dispatchEvent(new CustomEvent('calendar-request', {
        detail: {
          provider: localConfig.provider,
          date: newDate.toISOString().split('T')[0],
          requestId,
        }
      }));
    }
  }, [events, authState, emitUpdate, localConfig.autoFetch, localConfig.provider]);

  const handleFetchEvents = useCallback(() => {
    // Manually trigger event fetch
    if (localConfig.provider) {
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      pendingRequestIds.current.add(requestId);
      setIsLoading(true);
      setError(null);
      
      window.dispatchEvent(new CustomEvent('calendar-request', {
        detail: {
          provider: localConfig.provider,
          date: selectedDate.toISOString().split('T')[0],
          requestId,
        }
      }));
    }
  }, [localConfig.provider, selectedDate]);

  const handleConnect = useCallback((provider: 'outlook' | 'google') => {
    // Request authentication with the specified provider
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    pendingRequestIds.current.add(requestId);
    setIsLoading(true);
    setError(null);
    
    window.dispatchEvent(new CustomEvent('calendar-auth', {
      detail: {
        provider,
        requestId,
      }
    }));
  }, []);

  const handleDisconnect = useCallback((provider: 'outlook' | 'google') => {
    // Request sign out from the specified provider
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    pendingRequestIds.current.add(requestId);
    
    window.dispatchEvent(new CustomEvent('calendar-signout', {
      detail: {
        provider,
        requestId,
      }
    }));
  }, []);

  // Handle retry - check if we need to re-authenticate first
  const handleRetry = useCallback(() => {
    if (!localConfig.provider || localConfig.provider === 'all') return;
    
    // Check if we're authenticated with the configured provider
    const providerAuth = authState[localConfig.provider];
    const isProviderAuthenticated = providerAuth?.authenticated;
    
    if (!isProviderAuthenticated) {
      // Need to authenticate first
      handleConnect(localConfig.provider);
    } else {
      // Already authenticated, just fetch events
      handleFetchEvents();
    }
  }, [localConfig.provider, authState, handleConnect, handleFetchEvents]);

  const handleAddEvent = useCallback(() => {
    // Dispatch event for the editor to handle
    window.dispatchEvent(new CustomEvent('calendar-event-action', {
      detail: { 
        type: 'add-event', 
        date: selectedDate.toISOString(),
        widgetId: rawConfig.id,
      }
    }));
  }, [selectedDate, rawConfig.id]);

  const handleSettingsSave = useCallback((values: Record<string, any>) => {
    const newConfig: CalendarEventsWidgetConfig = {
      title: values.title ?? localConfig.title,
      size: values.size ?? localConfig.size,
      design: values.design ?? localConfig.design,
      locale: values.locale ?? localConfig.locale,
      showAddButton: values.showAddButton ?? localConfig.showAddButton,
      showMiniCalendar: values.showMiniCalendar ?? localConfig.showMiniCalendar,
      showEventCount: values.showEventCount ?? localConfig.showEventCount,
      maxEvents: values.maxEvents ?? localConfig.maxEvents,
      eventChannel: values.eventChannel ?? localConfig.eventChannel,
      provider: values.provider ?? localConfig.provider,
      autoFetch: values.autoFetch ?? localConfig.autoFetch,
    };
    setLocalConfig(newConfig);

    const updatedConfig = {
      type: rawConfig.type,
      ...newConfig,
    };

    emitUpdate({ 
      selectedDate: selectedDate.toISOString(), 
      events,
      authState,
    }, newConfig);

    const configEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'settings-change',
        config: updatedConfig,
        data: { selectedDate: selectedDate.toISOString(), events, authState },
        widgetId: rawConfig.id,
      },
    });
    document.dispatchEvent(configEvent);

    setIsSettingsOpen(false);
  }, [localConfig, selectedDate, events, authState, rawConfig, emitUpdate]);

  // =====================
  // RENDER HELPERS
  // =====================

  // Check if any provider is connected
  const isConnected = useMemo(() => {
    const provider = localConfig.provider || 'outlook';
    if (provider === 'all') {
      return Object.values(authState).some(s => s.authenticated);
    }
    return authState[provider]?.authenticated || false;
  }, [authState, localConfig.provider]);

  // Render connection UI
  const renderConnectUI = () => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      padding: '16px',
      textAlign: 'center',
    }}>
      <Label variant="muted" size="sm">
        Connect your calendar to see events
      </Label>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {(localConfig.provider === 'outlook' || localConfig.provider === 'all') && (
          authState.outlook?.authenticated ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDisconnect('outlook')}
              disabled={isLoading}
              style={{ gap: '6px' }}
            >
              <OutlookIcon size={14} />
              Disconnect Outlook
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleConnect('outlook')}
              disabled={isLoading}
              style={{ gap: '6px' }}
            >
              <OutlookIcon size={14} />
              Microsoft
            </Button>
          )
        )}
        {(localConfig.provider === 'google' || localConfig.provider === 'all') && (
          authState.google?.authenticated ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDisconnect('google')}
              disabled={isLoading}
              style={{ gap: '6px' }}
            >
              <GoogleIcon size={14} />
              Disconnect Google
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleConnect('google')}
              disabled={isLoading}
              style={{ gap: '6px' }}
            >
              <GoogleIcon size={14} />
              Google
            </Button>
          )
        )}
      </div>
    </div>
  );

  // Render loading state
  const renderLoading = () => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      gap: '8px',
    }}>
      <RefreshIcon size={16} spinning />
      <Label variant="muted" size="sm">Loading events...</Label>
    </div>
  );

  // Render error state
  const renderError = () => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      gap: '8px',
      textAlign: 'center',
    }}>
      <Label 
        size="sm" 
        style={{ color: 'var(--vscode-errorForeground, #f48771)' }}
      >
        {error}
      </Label>
      <Button
        variant="outline"
        size="sm"
        onClick={handleRetry}
      >
        Retry
      </Button>
    </div>
  );

  // Render events list (shared between layouts)
  const renderEventsList = (compact?: boolean) => {
    if (isLoading) {
      return renderLoading();
    }
    
    if (error) {
      return renderError();
    }
    
    if (!isConnected && events.length === 0) {
      return renderConnectUI();
    }
    
    if (displayEvents.length === 0) {
      return (
        <Label variant="muted" size="sm" style={{ fontStyle: 'italic' }}>
          No events{compact ? ' today' : ' scheduled'}
        </Label>
      );
    }
    
    return displayEvents.map(event => (
      <EventItem key={event.id} event={event} compact={compact} />
    ));
  };

  // Check if selected date is today
  const isToday = useMemo(() => {
    const today = new Date();
    return (
      selectedDate.getDate() === today.getDate() &&
      selectedDate.getMonth() === today.getMonth() &&
      selectedDate.getFullYear() === today.getFullYear()
    );
  }, [selectedDate]);

  // Navigate to previous/next day
  const goToPreviousDay = useCallback(() => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    handleDateChange(newDate);
  }, [selectedDate, handleDateChange]);

  const goToNextDay = useCallback(() => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    handleDateChange(newDate);
  }, [selectedDate, handleDateChange]);

  const goToToday = useCallback(() => {
    handleDateChange(new Date());
  }, [handleDateChange]);

  const renderSmallLayout = () => (
    // Small layout - like calendar-05 with date navigation in footer
    <WidgetContent style={{ 
      flexDirection: 'column', 
      alignItems: 'flex-start', 
      justifyContent: 'space-between',
      gap: '8px',
      padding: '4px',
      height: '100%',
    }}>
      {/* Header: Date display */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'baseline', 
        gap: '6px',
        width: '100%',
      }}>
        <Label size="3xl" style={{ lineHeight: 1 }}>{dateNumber}</Label>
        <Label variant="muted" size="sm">{month.substring(0, 3)}</Label>
      </div>
      
      {/* Events list */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '4px', 
        width: '100%',
        flex: 1,
        overflow: 'auto',
      }}>
        {renderEventsList(true)}
      </div>
      
      {/* Footer: Navigation buttons */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        gap: '8px',
        width: '100%',
        borderTop: '1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2))',
        paddingTop: '8px',
      }}>
        {/* Previous day button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={goToPreviousDay}
          style={{ padding: '4px', minWidth: 'auto' }}
          title="Previous day"
        >
          <ChevronLeftIcon size={16} />
        </Button>
        
        {/* Today button */}
        <Button
          variant={isToday ? 'outline' : 'ghost'}
          size="sm"
          onClick={goToToday}
          style={{ padding: '4px 8px', fontSize: '11px' }}
          title="Go to today"
          disabled={isToday}
        >
          Today
        </Button>
        
        {/* Next day button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={goToNextDay}
          style={{ padding: '4px', minWidth: 'auto' }}
          title="Next day"
        >
          <ChevronRightIcon size={16} />
        </Button>
      </div>
    </WidgetContent>
  );

  const renderMediumLayout = () => (
    // Medium layout - like calendar-02 (calendar + events side by side)
    <WidgetContent style={{ 
      alignItems: 'stretch',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '4px',
    }}>
      {/* Mini Calendar */}
      {showMiniCalendar && (
        <div style={{ flex: '0 0 auto' }}>
          <MiniCalendar
            date={selectedDate}
            locale={locale || 'en-US'}
            onDateChange={handleDateChange}
            eventDates={eventDates}
          />
        </div>
      )}

      {/* Events Panel */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}>
        {/* Date header */}
        <Label 
          variant="muted" 
          size="sm"
          style={{ color: 'var(--vscode-errorForeground, #f48771)' }}
        >
          {day}
        </Label>
        <Label size="3xl" style={{ lineHeight: 1, margin: '4px 0' }}>
          {dateNumber}
        </Label>

        {/* Events list */}
        <div style={{ 
          marginTop: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          width: '100%',
        }}>
          {renderEventsList(true)}
        </div>
      </div>
    </WidgetContent>
  );

  const renderLargeLayout = () => (
    // Large layout - full featured with all details
    <>
      <WidgetContent style={{ 
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        gap: '16px',
        padding: '8px',
        flexDirection: 'row',
      }}>
        {/* Mini Calendar */}
        {showMiniCalendar && (
          <div style={{ flex: '0 0 auto' }}>
            <MiniCalendar
              date={selectedDate}
              locale={locale || 'en-US'}
              onDateChange={handleDateChange}
              eventDates={eventDates}
            />
          </div>
        )}

        {/* Events Panel */}
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          gap: '8px',
        }}>
          {/* Date header */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            marginBottom: '4px',
          }}>
            <Label size="3xl" style={{ lineHeight: 1 }}>
              {dateNumber}
            </Label>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Label variant="muted" size="sm">{month}</Label>
              <Label variant="muted" size="sm">{day}</Label>
            </div>
          </div>

          {/* Events list */}
          <div style={{ 
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}>
            {renderEventsList(false)}
          </div>
        </div>
      </WidgetContent>

      {/* Footer with event count */}
      {showEventCount && events.length > 0 && (
        <WidgetFooter style={{ 
          justifyContent: 'center',
          borderTop: '1px solid var(--vscode-panel-border, #3c3c3c)',
          paddingTop: '8px',
        }}>
          <Label variant="muted" size="sm">
            {events.length} event{events.length !== 1 ? 's' : ''} total
          </Label>
        </WidgetFooter>
      )}
    </>
  );

  // =====================
  // RENDER
  // =====================

  return (
    <Widget 
      ref={widgetRef}
      size={size} 
      design={design} 
      style={{ position: 'relative' }}
    >
      {/* Header */}
      <WidgetHeader style={{ 
        alignItems: 'center', 
        gap: '4px',
        justifyContent: 'space-between',
      }}>
        {/* Left: Title/Day */}
        {size === 'sm' ? (
          <Label 
            variant="muted" 
            size="sm"
            style={{ color: 'var(--vscode-errorForeground, #f48771)' }}
          >
            {day}
          </Label>
        ) : (
          <WidgetTitle style={{ flex: 1 }}>
            {localConfig.title || 'Today\'s Events'}
          </WidgetTitle>
        )}

        {/* Right: Actions */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {showEventCount && size !== 'lg' && events.length > 0 && (
            <Badge variant="default" style={{ fontSize: '10px', padding: '2px 6px', width: 'calc(100% - 15px)' }}>
              {events.length}
            </Badge>
          )}
          
          {/* Refresh button - only show when connected */}
          {isConnected && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleFetchEvents}
              disabled={isLoading}
              title="Refresh events"
              style={{ width: '24px', height: '24px', padding: 0 }}
            >
              <RefreshIcon size={14} spinning={isLoading} />
            </Button>
          )}
          
          {showAddButton && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleAddEvent}
              title="Add event"
              style={{ width: '24px', height: '24px', padding: 0 }}
            >
              <PlusIcon size={14} />
            </Button>
          )}

          <SettingsToggle
            isOpen={isSettingsOpen}
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          />
        </div>
      </WidgetHeader>

      {/* Layout based on size */}
      {size === 'sm' && renderSmallLayout()}
      {size === 'md' && renderMediumLayout()}
      {size === 'lg' && renderLargeLayout()}

      {/* Settings Panel */}
      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Calendar Events Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </Widget>
  );
};
