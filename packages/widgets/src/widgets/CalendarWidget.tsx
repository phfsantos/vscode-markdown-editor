/**
 * CalendarWidget - Simple date display with size variants
 * Inspired by wigggle-ui calendar widget
 */

import React from 'react';
import { Widget, WidgetContent, Label } from '../ui';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

export interface CalendarWidgetConfig {
  showYear?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const CalendarWidget: React.FC<ReactWidgetProps> = ({ config }) => {
  const widgetConfig = config as any as CalendarWidgetConfig;
  const showYear = widgetConfig.showYear ?? false;
  const size = widgetConfig.size || 'sm';
  
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'short' });
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  const date = now.getDate().toString().padStart(2, '0');
  const year = now.getFullYear();
  
  // Size-based label sizes
  const sizeConfig = {
    sm: { dayMonth: 'xl' as const, date: '8xl' as const, year: 'lg' as const },
    md: { dayMonth: '2xl' as const, date: '8xl' as const, year: 'xl' as const },
    lg: { dayMonth: '3xl' as const, date: '8xl' as const, year: '2xl' as const },
  };
  const labelSizes = sizeConfig[size];

  return (
    <Widget size={size} design="default">
      <WidgetContent style={{ flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Label size={labelSizes.dayMonth} variant="destructive">{day}</Label>
          <Label size={labelSizes.dayMonth}>{month}</Label>
        </div>
        <Label size={labelSizes.date} style={{ lineHeight: 1 }}>{date}</Label>
        {showYear && (
          <Label size={labelSizes.year} variant="muted">{year}</Label>
        )}
      </WidgetContent>
    </Widget>
  );
};
