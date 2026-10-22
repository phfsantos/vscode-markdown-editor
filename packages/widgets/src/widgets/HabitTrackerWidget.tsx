/**
 * HabitTrackerWidget - Monthly habit tracker with a daily check-in
 *
 * Based on wigggle-ui productivity-04.tsx (monthly activity grid)
 * Features:
 * - Month grid highlighting the days the habit was completed
 * - Button to mark today complete, with a small undo
 * - Current and best streaks (md/lg)
 * - Persistent data via code block
 * - Settings panel for customization
 * - Size variants (sm/md/lg)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

export interface HabitTrackerWidgetConfig {
  /** Habit name shown as the widget title */
  title?: string;
  /** Widget size */
  size?: WidgetSize;
  /** Show streak stats on md/lg sizes (default: true) */
  showStreak?: boolean;
}

export interface HabitTrackerWidgetData {
  /** Local calendar days the habit was completed on, as sorted YYYY-MM-DD keys */
  completedDates: string[];
}

// =====================
// DATE HELPERS
// =====================

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Format a date as a local YYYY-MM-DD key (never UTC, so late-evening check-ins land on the right day) */
export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function previousDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

/** Keep only well-formed date keys, de-duplicated and sorted */
export function normalizeDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter((key): key is string => typeof key === 'string' && DATE_KEY_PATTERN.test(key));
  return Array.from(new Set(keys)).sort();
}

/** Consecutive completed days ending today, or ending yesterday while today is still open */
export function currentStreak(dates: string[], today: Date): number {
  const completed = new Set(dates);
  let cursor = completed.has(toDateKey(today)) ? today : previousDay(today);
  let streak = 0;
  while (completed.has(toDateKey(cursor))) {
    streak++;
    cursor = previousDay(cursor);
  }
  return streak;
}

/** Longest run of consecutive completed days */
export function longestStreak(dates: string[]): number {
  const sorted = normalizeDates(dates);
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of sorted) {
    const followsPrevious = previous !== null && toDateKey(previousDay(fromDateKey(key))) === previous;
    run = followsPrevious ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return best;
}

/** Calendar weeks for a month, Sunday first; null marks a leading/trailing blank */
export function buildMonthWeeks(year: number, month: number): (Date | null)[][] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array(new Date(year, month, 1).getDay()).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

// =====================
// SVG ICONS
// =====================

const CheckIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const UndoIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

// =====================
// SETTINGS CONFIGURATION
// =====================

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Habit', type: 'text', placeholder: 'Habit' },
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
  { key: 'showStreak', label: 'Show Streak', type: 'checkbox', defaultValue: true },
];

// =====================
// STYLES
// =====================

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const gridMetrics: Record<WidgetSize, { cell: number; gap: number; radius: number; showNumbers: boolean }> = {
  sm: { cell: 12, gap: 4, radius: 3, showNumbers: false },
  md: { cell: 14, gap: 4, radius: 4, showNumbers: false },
  lg: { cell: 32, gap: 8, radius: 8, showNumbers: true },
};

const COMPLETED_COLOR = 'var(--vscode-testing-iconPassed, #4caf50)';
const mutedFill = (percent: number) =>
  `color-mix(in srgb, var(--vscode-descriptionForeground, #8b8b8b) ${percent}%, transparent)`;

// =====================
// WIDGET COMPONENT
// =====================

export const HabitTrackerWidget: React.FC<ReactWidgetProps> = ({
  config,
  data,
  onUpdate
}) => {
  const widgetConfig = config as unknown as HabitTrackerWidgetConfig;
  const widgetData = data as HabitTrackerWidgetData | undefined;

  // =====================
  // STATE
  // =====================

  const [completedDates, setCompletedDates] = useState<string[]>(() => normalizeDates(widgetData?.completedDates));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<HabitTrackerWidgetConfig>(widgetConfig);
  const [todayKey, setTodayKey] = useState(() => toDateKey(new Date()));

  const title = localConfig.title || 'Habit';
  const size = localConfig.size || 'sm';
  const showStreak = localConfig.showStreak !== false;

  // =====================
  // EFFECTS
  // =====================

  // Sync with external data changes
  useEffect(() => {
    if (widgetData?.completedDates) {
      setCompletedDates(normalizeDates(widgetData.completedDates));
    }
  }, [widgetData?.completedDates]);

  // Roll "today" over at midnight when the document stays open
  useEffect(() => {
    const interval = setInterval(() => {
      const key = toDateKey(new Date());
      setTodayKey(current => (current === key ? current : key));
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // =====================
  // DERIVED DATA
  // =====================

  const today = useMemo(() => fromDateKey(todayKey), [todayKey]);
  const isTodayComplete = completedDates.includes(todayKey);
  const completedSet = useMemo(() => new Set(completedDates), [completedDates]);
  const weeks = useMemo(() => buildMonthWeeks(today.getFullYear(), today.getMonth()), [today]);
  const monthPrefix = todayKey.slice(0, 7);
  const monthCount = completedDates.filter(key => key.startsWith(monthPrefix)).length;
  const monthLabel = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const streak = useMemo(() => currentStreak(completedDates, today), [completedDates, today]);
  const bestStreak = useMemo(() => longestStreak(completedDates), [completedDates]);
  const monthCountText = `${monthCount} ${monthCount === 1 ? 'day' : 'days'} this month`;

  // =====================
  // EVENT HANDLERS
  // =====================

  // Emit update event (triggers save to code block)
  const emitUpdate = useCallback((
    updatedDates: string[],
    updatedConfig?: HabitTrackerWidgetConfig
  ) => {
    const payload = {
      data: { completedDates: updatedDates },
      config: updatedConfig || localConfig,
    };

    if (onUpdate) {
      onUpdate({ ...payload.data, _config: payload.config });
    }

    document.dispatchEvent(new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'data-change',
        ...payload,
        widgetId: (config as any).id,
      },
    }));
  }, [onUpdate, localConfig, config]);

  const handleCheckToday = useCallback(() => {
    if (completedDates.includes(todayKey)) return;
    const updatedDates = [...completedDates, todayKey].sort();
    setCompletedDates(updatedDates);
    emitUpdate(updatedDates);
  }, [completedDates, todayKey, emitUpdate]);

  const handleUndoToday = useCallback(() => {
    if (!completedDates.includes(todayKey)) return;
    const updatedDates = completedDates.filter(key => key !== todayKey);
    setCompletedDates(updatedDates);
    emitUpdate(updatedDates);
  }, [completedDates, todayKey, emitUpdate]);

  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = { ...localConfig, ...newConfig } as HabitTrackerWidgetConfig;
    setLocalConfig(updatedConfig);
    emitUpdate(completedDates, updatedConfig);
  }, [localConfig, completedDates, emitUpdate]);

  // =====================
  // RENDER HELPERS
  // =====================

  const renderGrid = () => {
    const { cell, gap, radius, showNumbers } = gridMetrics[size];
    const columns = `repeat(7, ${cell}px)`;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: `${gap}px` }}>
        <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: columns, gap: `${gap}px` }}>
          {WEEKDAY_INITIALS.map((initial, index) => (
            <span
              key={index}
              style={{
                textAlign: 'center',
                fontSize: size === 'lg' ? '11px' : '9px',
                lineHeight: 1,
                color: 'var(--vscode-descriptionForeground, #8b8b8b)',
              }}
            >
              {initial}
            </span>
          ))}
        </div>
        <div role="grid" aria-label={monthLabel} style={{ display: 'flex', flexDirection: 'column', gap: `${gap}px` }}>
          {weeks.map((week, weekIndex) => (
            <div role="row" key={weekIndex} style={{ display: 'grid', gridTemplateColumns: columns, gap: `${gap}px` }}>
              {week.map((date, dayIndex) => {
                if (!date) {
                  return <span role="gridcell" key={dayIndex} data-blank aria-hidden="true" style={{ width: cell, height: cell }} />;
                }
                const key = toDateKey(date);
                const done = completedSet.has(key);
                const isToday = key === todayKey;
                const isFuture = key > todayKey;
                const dayLabel = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                const label = `${dayLabel}: ${done ? 'completed' : 'not completed'}`;
                return (
                  <span
                    role="gridcell"
                    key={key}
                    data-day={key}
                    data-completed={done}
                    aria-label={label}
                    title={label}
                    style={{
                      width: cell,
                      height: cell,
                      boxSizing: 'border-box',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius,
                      fontSize: '11px',
                      fontWeight: isToday ? 600 : 400,
                      background: done ? COMPLETED_COLOR : mutedFill(isFuture ? 8 : 20),
                      color: done
                        ? 'var(--vscode-editor-background, #1e1e1e)'
                        : 'var(--vscode-descriptionForeground, #8b8b8b)',
                      outline: isToday ? '1.5px solid var(--vscode-focusBorder, #007fd4)' : 'none',
                      outlineOffset: '1px',
                      transition: 'background 0.2s ease',
                    }}
                  >
                    {showNumbers ? date.getDate() : null}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Compact round check button (sm header)
  const renderIconCheckIn = () => (
    isTodayComplete ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        <button
          type="button"
          onClick={handleUndoToday}
          aria-label="Undo today"
          title="Undo today"
          style={undoButtonStyle}
        >
          <UndoIcon size={11} />
        </button>
        <span
          role="img"
          aria-label="Completed today"
          title="Completed today"
          style={{ ...roundButtonStyle, background: COMPLETED_COLOR, color: 'var(--vscode-editor-background, #1e1e1e)', cursor: 'default' }}
        >
          <CheckIcon size={14} />
        </span>
      </div>
    ) : (
      <button
        type="button"
        onClick={handleCheckToday}
        aria-label="Mark today complete"
        title="Mark today complete"
        style={{ ...roundButtonStyle, background: 'transparent', border: `1.5px solid ${COMPLETED_COLOR}`, color: COMPLETED_COLOR }}
      >
        <CheckIcon size={14} />
      </button>
    )
  );

  // Full-width check-in button (md/lg)
  const renderButtonCheckIn = () => (
    isTodayComplete ? (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%', height: '28px' }}>
        <Label variant="productive" size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
          <CheckIcon size={14} /> Done today
        </Label>
        <button
          type="button"
          onClick={handleUndoToday}
          aria-label="Undo today"
          title="Undo today"
          style={{ ...undoButtonStyle, width: 'auto', padding: '0 6px', gap: '4px', fontSize: '11px' }}
        >
          <UndoIcon size={11} /> Undo
        </button>
      </div>
    ) : (
      <Button
        onClick={handleCheckToday}
        aria-label="Mark today complete"
        title="Mark today complete"
        style={{ width: '100%', background: COMPLETED_COLOR, color: 'var(--vscode-editor-background, #1e1e1e)' }}
      >
        <CheckIcon size={14} /> Mark done
      </Button>
    )
  );

  const streakText = `${streak} day streak`;

  // =====================
  // RENDER
  // =====================

  return (
    <Widget size={size} design="default" data-size={size} style={{ position: 'relative' }}>
      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Habit Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {size === 'sm' && (
        <>
          <WidgetHeader style={{ alignItems: 'center', gap: '4px' }}>
            <WidgetTitle style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </WidgetTitle>
            {renderIconCheckIn()}
            <SettingsToggle isOpen={isSettingsOpen} onClick={() => setIsSettingsOpen(!isSettingsOpen)} />
          </WidgetHeader>
          <WidgetContent>{renderGrid()}</WidgetContent>
          <WidgetFooter style={{ justifyContent: 'center' }}>
            <span>{monthCountText}</span>
          </WidgetFooter>
        </>
      )}

      {size === 'md' && (
        <WidgetContent style={{ alignItems: 'stretch', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
              <WidgetTitle style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</WidgetTitle>
              <SettingsToggle isOpen={isSettingsOpen} onClick={() => setIsSettingsOpen(!isSettingsOpen)} />
            </div>
            <Label variant="muted" size="sm">{monthLabel}</Label>
            {showStreak && (
              <Label size="xl" style={{ marginTop: '8px', lineHeight: 1.1 }}>{streakText}</Label>
            )}
            <Label variant="muted" size="sm">{monthCountText}</Label>
            <div style={{ marginTop: 'auto' }}>{renderButtonCheckIn()}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>{renderGrid()}</div>
        </WidgetContent>
      )}

      {size === 'lg' && (
        <>
          <WidgetHeader style={{ alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <WidgetTitle style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</WidgetTitle>
              <Label variant="muted" size="sm">{monthLabel}</Label>
            </div>
            <SettingsToggle isOpen={isSettingsOpen} onClick={() => setIsSettingsOpen(!isSettingsOpen)} />
          </WidgetHeader>
          {showStreak && (
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
              <Label size="lg" style={{ fontWeight: 600 }}>{streakText}</Label>
              <Label variant="muted" size="sm" aria-label="Best streak">Best {bestStreak}</Label>
            </div>
          )}
          <WidgetContent>{renderGrid()}</WidgetContent>
          <WidgetFooter style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
            <span style={{ textAlign: 'center' }}>{monthCountText}</span>
            {renderButtonCheckIn()}
          </WidgetFooter>
        </>
      )}
    </Widget>
  );
};

const roundButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '26px',
  height: '26px',
  borderRadius: '50%',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};

const undoButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '20px',
  height: '20px',
  borderRadius: '4px',
  border: 'none',
  padding: 0,
  background: 'transparent',
  color: 'var(--vscode-descriptionForeground, #8b8b8b)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
