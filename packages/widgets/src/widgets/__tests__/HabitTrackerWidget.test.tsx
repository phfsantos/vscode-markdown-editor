import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HabitTrackerWidget, currentStreak, longestStreak } from '../HabitTrackerWidget';
import type { IWidgetConfig } from '../../core/types';

const TODAY = new Date(2026, 9, 22, 10, 30); // 22 Oct 2026, local time

function makeConfig(overrides: Record<string, unknown> = {}): IWidgetConfig {
  return { id: 'habit-1', type: 'habit-tracker', title: 'Read', ...overrides } as unknown as IWidgetConfig;
}

function captureUpdates() {
  const events: CustomEvent[] = [];
  const listener = (e: Event) => events.push(e as CustomEvent);
  document.addEventListener('widget-update', listener);
  return { events, stop: () => document.removeEventListener('widget-update', listener) };
}

describe('HabitTrackerWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks today complete and persists it through a widget-update event', () => {
    const capture = captureUpdates();
    const onUpdate = vi.fn();
    render(<HabitTrackerWidget config={makeConfig()} data={{ completedDates: [] }} onUpdate={onUpdate} />);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /mark today complete/i }));
    });

    capture.stop();
    expect(capture.events).toHaveLength(1);
    expect(capture.events[0].detail.widgetId).toBe('habit-1');
    expect(capture.events[0].detail.data).toEqual({ completedDates: ['2026-10-22'] });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ completedDates: ['2026-10-22'] }));
  });

  it('offers undo only once today is complete', () => {
    render(<HabitTrackerWidget config={makeConfig()} data={{ completedDates: ['2026-10-21'] }} />);

    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /mark today complete/i }));
    });

    expect(screen.getByRole('button', { name: /undo/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /mark today complete/i })).toBeNull();
  });

  it('undo removes only today and persists the change', () => {
    const capture = captureUpdates();
    render(
      <HabitTrackerWidget
        config={makeConfig()}
        data={{ completedDates: ['2026-10-20', '2026-10-21', '2026-10-22'] }}
      />,
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    });

    capture.stop();
    expect(capture.events).toHaveLength(1);
    expect(capture.events[0].detail.data).toEqual({ completedDates: ['2026-10-20', '2026-10-21'] });
    expect(screen.getByRole('button', { name: /mark today complete/i })).toBeTruthy();
  });

  it('renders the current month grid with completed days marked', () => {
    render(
      <HabitTrackerWidget
        config={makeConfig()}
        data={{ completedDates: ['2026-09-30', '2026-10-01', '2026-10-21'] }}
      />,
    );

    const grid = screen.getByRole('grid', { name: /october 2026/i });
    const days = grid.querySelectorAll('[data-day]');
    expect(days).toHaveLength(31);
    const completed = Array.from(grid.querySelectorAll('[data-completed="true"]')).map(el => el.getAttribute('data-day'));
    expect(completed).toEqual(['2026-10-01', '2026-10-21']);
    expect(screen.getByLabelText('21 Oct: completed')).toBeTruthy();
    expect(screen.getByLabelText('22 Oct: not completed')).toBeTruthy();
    // Count only the days of the visible month
    expect(screen.getByText(/2 days this month/i)).toBeTruthy();
  });

  it('pads the grid so the 1st falls under its weekday', () => {
    render(<HabitTrackerWidget config={makeConfig()} data={{ completedDates: [] }} />);

    // 1 Oct 2026 is a Thursday: four leading blanks in a Sunday-first week
    const grid = screen.getByRole('grid', { name: /october 2026/i });
    expect(grid.querySelectorAll('[data-blank]')).toHaveLength(4);
  });

  describe('streaks', () => {
    it('counts back from today when today is complete', () => {
      expect(currentStreak(['2026-10-20', '2026-10-21', '2026-10-22'], TODAY)).toBe(3);
    });

    it('keeps a streak alive from yesterday until today is checked', () => {
      expect(currentStreak(['2026-10-19', '2026-10-20', '2026-10-21'], TODAY)).toBe(3);
    });

    it('breaks the streak after a missed day', () => {
      expect(currentStreak(['2026-10-18', '2026-10-19', '2026-10-20'], TODAY)).toBe(0);
    });

    it('carries a streak across a month boundary', () => {
      const firstOfMonth = new Date(2026, 10, 1, 9);
      expect(currentStreak(['2026-10-30', '2026-10-31', '2026-11-01'], firstOfMonth)).toBe(3);
    });

    it('finds the longest run regardless of order or duplicates', () => {
      expect(longestStreak(['2026-10-05', '2026-10-01', '2026-10-02', '2026-10-02', '2026-10-03'])).toBe(3);
      expect(longestStreak([])).toBe(0);
    });
  });

  describe.each(['sm', 'md', 'lg'] as const)('size %s', size => {
    it('renders the month grid and the check-in button', () => {
      const { container } = render(
        <HabitTrackerWidget config={makeConfig({ size })} data={{ completedDates: ['2026-10-21'] }} />,
      );

      expect(screen.getByRole('grid', { name: /october 2026/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /mark today complete/i })).toBeTruthy();
      expect(container.querySelector(`[data-size="${size}"]`)).toBeTruthy();
    });
  });

  it('shows the current streak on medium and large sizes', () => {
    const { unmount } = render(
      <HabitTrackerWidget config={makeConfig({ size: 'md' })} data={{ completedDates: ['2026-10-21', '2026-10-22'] }} />,
    );
    expect(screen.getByText(/2 day streak/i)).toBeTruthy();
    unmount();

    render(
      <HabitTrackerWidget config={makeConfig({ size: 'lg' })} data={{ completedDates: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-22'] }} />,
    );
    expect(screen.getByText(/1 day streak/i)).toBeTruthy();
    expect(screen.getByLabelText('Best streak').textContent).toContain('3');
  });

  it('tolerates missing or malformed data', () => {
    render(<HabitTrackerWidget config={makeConfig()} data={{ completedDates: 'nope' }} />);
    expect(screen.getByText(/0 days this month/i)).toBeTruthy();
  });
});

describe('habit-tracker registration', () => {
  it('is registered as a productivity widget with its own custom element', async () => {
    const { registerCoreWidgets } = await import('../registerWidgets');
    const { WidgetRegistry } = await import('../../core');
    registerCoreWidgets();

    const definition = WidgetRegistry.getInstance().getDefinition('habit-tracker');
    expect(definition?.category).toBe('productivity');
    expect(definition?.reactComponent?.component).toBe(HabitTrackerWidget);
    expect(definition?.reactComponent?.tagName).toBe('habit-tracker-widget');
  });
});
