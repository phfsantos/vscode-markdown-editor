/**
 * Widget registration
 * 
 * Registers all core widgets with the WidgetRegistry
 * Based on wigggle-ui widget patterns: simple, developer-friendly widgets
 */

import { WidgetRegistry } from '../core';
import { HelloWorldWidget } from './HelloWorldWidget';
import { ChartWidget } from './ChartWidget';
import { TableWidget } from './TableWidget';
import { FormWidget } from './FormWidget';
import { ClockWidget } from './ClockWidget';
import { CalendarWidget } from './CalendarWidget';
import { CalendarDetailWidget } from './CalendarDetailWidget';
import { CalendarMonthWidget } from './CalendarMonthWidget';
import { CalendarEventsWidget } from './CalendarEventsWidget';
import { WeatherWidget } from './WeatherWidget';
import { StockWidget } from './StockWidget';
import { ProductivityWidget } from './ProductivityWidget';
import { TimerWidget } from './TimerWidget';
import { AlarmWidget } from './AlarmWidget';
import { SingleAlarmWidget } from './SingleAlarmWidget';
import { StopwatchWidget } from './StopwatchWidget';
import { ButtonWidget } from './ButtonWidget';
import { MacroBoardWidget } from './MacroBoardWidget';

/**
 * Register all core widgets
 * Call this function once during application initialization
 */
export function registerCoreWidgets() {
  const registry = WidgetRegistry.getInstance();
  
  // HelloWorld Widget (example)
  registry.register({
    type: 'hello-world',
    displayName: 'Hello World',
    description: 'Simple example widget',
    category: 'example',
    reactComponent: {
      component: HelloWorldWidget,
      tagName: 'hello-world-widget',
      displayName: 'Hello World'
    }
  });
  
  // Clock Widget
  registry.register({
    type: 'clock',
    displayName: 'Clock',
    description: 'Digital clock with customizable format',
    category: 'time',
    reactComponent: {
      component: ClockWidget,
      tagName: 'clock-widget',
      displayName: 'Clock'
    }
  });
  
  // Calendar Widget
  registry.register({
    type: 'calendar',
    displayName: 'Calendar',
    description: 'Simple date display widget',
    category: 'time',
    reactComponent: {
      component: CalendarWidget,
      tagName: 'calendar-widget',
      displayName: 'Calendar'
    }
  });
  
  // Calendar Detail Widget
  registry.register({
    type: 'calendar-detail',
    displayName: 'Calendar Detail',
    description: 'Detailed date display with weekday, month, and year',
    category: 'time',
    reactComponent: {
      component: CalendarDetailWidget,
      tagName: 'calendar-detail-widget',
      displayName: 'Calendar Detail'
    }
  });
  
  // Calendar Month Widget
  registry.register({
    type: 'calendar-month',
    displayName: 'Calendar Month',
    description: 'Full month calendar view with day grid and navigation',
    category: 'time',
    reactComponent: {
      component: CalendarMonthWidget,
      tagName: 'calendar-month-widget',
      displayName: 'Calendar Month'
    }
  });
  
  // Calendar Events Widget
  registry.register({
    type: 'calendar-events',
    displayName: 'Calendar Events',
    description: 'Display calendar events for a specific day with custom event support',
    category: 'time',
    reactComponent: {
      component: CalendarEventsWidget,
      tagName: 'calendar-events-widget',
      displayName: 'Calendar Events'
    }
  });
  
  // Timer Widget
  registry.register({
    type: 'timer',
    displayName: 'Timer',
    description: 'Countdown timer with start/pause/reset controls',
    category: 'time',
    reactComponent: {
      component: TimerWidget,
      tagName: 'timer-widget',
      displayName: 'Timer'
    }
  });
  
  // Alarm Widget
  registry.register({
    type: 'alarm',
    displayName: 'Alarm',
    description: 'Multiple alarms with sound and VS Code notifications',
    category: 'time',
    reactComponent: {
      component: AlarmWidget,
      tagName: 'alarm-widget',
      displayName: 'Alarm'
    }
  });
  
  // Single Alarm Widget
  registry.register({
    type: 'single-alarm',
    displayName: 'Single Alarm',
    description: 'Simple alarm with wheel picker interface',
    category: 'time',
    reactComponent: {
      component: SingleAlarmWidget,
      tagName: 'single-alarm-widget',
      displayName: 'Single Alarm'
    }
  });
  
  // Stopwatch Widget
  registry.register({
    type: 'stopwatch',
    displayName: 'Stopwatch',
    description: 'Elapsed time tracker with lap times',
    category: 'time',
    reactComponent: {
      component: StopwatchWidget,
      tagName: 'stopwatch-widget',
      displayName: 'Stopwatch'
    }
  });
  
  // Weather Widget
  registry.register({
    type: 'weather',
    displayName: 'Weather',
    description: 'Weather display with temperature and conditions',
    category: 'info',
    reactComponent: {
      component: WeatherWidget,
      tagName: 'weather-widget',
      displayName: 'Weather'
    }
  });
  
  // Stock Widget
  registry.register({
    type: 'stock',
    displayName: 'Stock',
    description: 'Stock ticker with price and change',
    category: 'finance',
    reactComponent: {
      component: StockWidget,
      tagName: 'stock-widget',
      displayName: 'Stock'
    }
  });
  
  // Productivity Widget
  registry.register({
    type: 'productivity',
    displayName: 'Tasks',
    description: 'Simple task list for productivity',
    category: 'productivity',
    reactComponent: {
      component: ProductivityWidget,
      tagName: 'productivity-widget',
      displayName: 'Tasks'
    }
  });
  
  // Chart Widget
  registry.register({
    type: 'chart',
    displayName: 'Chart',
    description: 'Interactive data visualization',
    category: 'data',
    reactComponent: {
      component: ChartWidget,
      tagName: 'chart-widget',
      displayName: 'Chart'
    }
  });
  
  // Table Widget
  registry.register({
    type: 'table',
    displayName: 'Table',
    description: 'Data table display',
    category: 'data',
    reactComponent: {
      component: TableWidget,
      tagName: 'table-widget',
      displayName: 'Table'
    }
  });
  
  // Form Widget
  registry.register({
    type: 'form',
    displayName: 'Form',
    description: 'Dynamic form builder with validation',
    category: 'input',
    reactComponent: {
      component: FormWidget,
      tagName: 'form-widget',
      displayName: 'Form'
    }
  });
  
  // Button Widget
  registry.register({
    type: 'button',
    displayName: 'Button',
    description: 'Interactive action button for triggering events and commands',
    category: 'input',
    reactComponent: {
      component: ButtonWidget,
      tagName: 'button-widget',
      displayName: 'Button'
    }
  });

  // Macro Board Widget
  registry.register({
    type: 'macro-board',
    displayName: 'Macro Board',
    description: 'Single-level productivity deck for launching commands and macros',
    category: 'productivity',
    reactComponent: {
      component: MacroBoardWidget,
      tagName: 'macro-board-widget',
      displayName: 'Macro Board'
    }
  });
}
