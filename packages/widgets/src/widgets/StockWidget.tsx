/**
 * StockWidget - Simple stock ticker display with size variants
 * Inspired by wigggle-ui stock widget
 */

import React from 'react';
import { Widget, WidgetHeader, WidgetContent, WidgetFooter, Label } from '../ui';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

export interface StockWidgetConfig {
  symbol?: string;
  name?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const StockWidget: React.FC<ReactWidgetProps> = ({ config, data }) => {
  const widgetConfig = config as any as StockWidgetConfig;
  const stockData = data || widgetConfig;
  
  const symbol = stockData.symbol || 'AAPL';
  const name = stockData.name || 'Apple Inc';
  const price = stockData.price ?? 175.50;
  const change = stockData.change ?? 2.50;
  const changePercent = stockData.changePercent ?? 1.45;
  const currency = stockData.currency || '$';
  const size = widgetConfig.size || 'sm';
  
  const isPositive = change >= 0;
  const variant = isPositive ? 'productive' : 'destructive';
  const arrow = isPositive ? '▲' : '▼';
  
  // Size-based label sizes
  const sizeConfig = {
    sm: { price: '4xl' as const, arrow: '20px', change: 'md' as const, symbol: 'xl' as const, name: 'sm' as const },
    md: { price: '5xl' as const, arrow: '28px', change: 'lg' as const, symbol: '2xl' as const, name: 'md' as const },
    lg: { price: '6xl' as const, arrow: '36px', change: 'xl' as const, symbol: '3xl' as const, name: 'lg' as const },
  };
  const labelSizes = sizeConfig[size];

  return (
    <Widget size={size} design="default">
      <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Label size={labelSizes.price}>{currency}{price.toFixed(2)}</Label>
        <span style={{ 
          color: isPositive ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)',
          fontSize: labelSizes.arrow 
        }}>
          {arrow}
        </span>
      </WidgetHeader>
      <WidgetContent style={{ justifyContent: 'space-between' }}>
        <Label size={labelSizes.change} variant={variant}>
          {isPositive ? '+' : ''}{change.toFixed(2)}
        </Label>
        <Label size={labelSizes.change} variant={variant}>
          {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
        </Label>
      </WidgetContent>
      <WidgetFooter style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        <Label size={labelSizes.symbol} style={{ fontWeight: 500 }}>{symbol}</Label>
        <Label size={labelSizes.name} variant="muted">{name}</Label>
      </WidgetFooter>
    </Widget>
  );
};
