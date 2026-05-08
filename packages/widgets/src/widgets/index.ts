/**
 * Widget exports
 * 
 * All built-in widgets based on wigggle-ui patterns
 */

// Core widgets
export { HelloWorldWidget } from './HelloWorldWidget';
export { ChartWidget } from './ChartWidget';
export { TableWidget } from './TableWidget';
export { FormWidget } from './FormWidget';

// wigggle-ui inspired widgets
export { ClockWidget } from './ClockWidget';
export type { ClockWidgetConfig, ClockFace, TimezoneConfig } from './ClockWidget';
export { CalendarWidget } from './CalendarWidget';
export { CalendarDetailWidget } from './CalendarDetailWidget';
export type { CalendarDetailWidgetConfig } from './CalendarDetailWidget';
export { CalendarMonthWidget } from './CalendarMonthWidget';
export type { CalendarMonthWidgetConfig, CalendarMonthWidgetData } from './CalendarMonthWidget';
export { CalendarEventsWidget } from './CalendarEventsWidget';
export type { CalendarEventsWidgetConfig, CalendarEventsWidgetData, CalendarEvent } from './CalendarEventsWidget';
export { WeatherWidget } from './WeatherWidget';
export { StockWidget } from './StockWidget';
export { ProductivityWidget } from './ProductivityWidget';
export { TimerWidget } from './TimerWidget';
export type { TimerWidgetConfig, TimerWidgetData } from './TimerWidget';
export { AlarmWidget } from './AlarmWidget';
export type { AlarmWidgetConfig, AlarmWidgetData, Alarm } from './AlarmWidget';
export { SingleAlarmWidget } from './SingleAlarmWidget';
export type { SingleAlarmWidgetConfig, SingleAlarmWidgetData } from './SingleAlarmWidget';
export { StopwatchWidget } from './StopwatchWidget';
export type { StopwatchWidgetConfig, StopwatchWidgetData, LapTime } from './StopwatchWidget';
export { ButtonWidget } from './ButtonWidget';
export type { ButtonWidgetConfig, ButtonWidgetData, ButtonActionType, ButtonVariant } from './ButtonWidget';
export { MacroBoardWidget } from './MacroBoardWidget';
export type { MacroBoardWidgetConfig, MacroBoardWidgetData, MacroBoardButton } from './MacroBoardWidget';

// Registration
export { registerCoreWidgets } from './registerWidgets';
