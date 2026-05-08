/**
 * CalendarDetailWidget - Detailed date display with full weekday, month, and year badge
 * Based on wigggle-ui calendar-02.tsx pattern
 * 
 * Shows today's date with more details than the simple CalendarWidget:
 * - Full weekday name (e.g., "Sunday")
 * - Large date number
 * - Full month name (e.g., "December")
 * - Year badge (optional)
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Widget, WidgetContent, WidgetHeader, Label } from '../ui';
import { Button } from '../ui/Button';
import { WidgetSettingsPanel } from '../ui/WidgetSettingsPanel';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

// Badge component for year display (similar to wigggle-ui badge)
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'outline' | 'secondary';
  children?: React.ReactNode;
}

const Badge: React.FC<BadgeProps> = ({ 
  variant = 'outline', 
  style, 
  children, 
  ...props 
}) => {
  const variantStyles: Record<string, React.CSSProperties> = {
    default: {
      background: 'var(--vscode-button-background, #0e639c)',
      color: 'var(--vscode-button-foreground, #ffffff)',
      border: 'none',
    },
    outline: {
      background: 'transparent',
      color: 'var(--vscode-editor-foreground, #cccccc)',
      border: '1px solid var(--vscode-panel-border, #454545)',
    },
    secondary: {
      background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
      color: 'var(--vscode-button-secondaryForeground, #cccccc)',
      border: 'none',
    },
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 12px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 500,
        ...variantStyles[variant],
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
};

export interface CalendarDetailWidgetConfig {
  showWeekday?: boolean;
  showMonth?: boolean;
  showYear?: boolean;
  size?: 'sm' | 'md' | 'lg';
  design?: 'default' | 'minimal' | 'glass';
  locale?: string;
}

const defaultConfig: CalendarDetailWidgetConfig = {
  showWeekday: true,
  showMonth: true,
  showYear: true,
  size: 'sm',
  design: 'default',
  locale: 'en-US',
};

export const CalendarDetailWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  onUpdate 
}) => {
  const [showSettings, setShowSettings] = useState(false);
  
  // Get raw config (includes type and id from renderer)
  const rawConfig = config as Record<string, any>;
  
  // Use local state for settings so changes apply immediately
  const [localConfig, setLocalConfig] = useState<CalendarDetailWidgetConfig>(() => ({
    showWeekday: rawConfig.showWeekday ?? defaultConfig.showWeekday,
    showMonth: rawConfig.showMonth ?? defaultConfig.showMonth,
    showYear: rawConfig.showYear ?? defaultConfig.showYear,
    size: rawConfig.size ?? defaultConfig.size,
    design: rawConfig.design ?? defaultConfig.design,
    locale: rawConfig.locale ?? defaultConfig.locale,
  }));

  // Sync with external config changes (e.g., when code block is edited directly)
  useEffect(() => {
    setLocalConfig({
      showWeekday: rawConfig.showWeekday ?? defaultConfig.showWeekday,
      showMonth: rawConfig.showMonth ?? defaultConfig.showMonth,
      showYear: rawConfig.showYear ?? defaultConfig.showYear,
      size: rawConfig.size ?? defaultConfig.size,
      design: rawConfig.design ?? defaultConfig.design,
      locale: rawConfig.locale ?? defaultConfig.locale,
    });
  }, [rawConfig.showWeekday, rawConfig.showMonth, rawConfig.showYear, rawConfig.size, rawConfig.design, rawConfig.locale]);

  const { showWeekday, showMonth, showYear, size, design, locale } = localConfig;
  
  const now = new Date();
  const day = now.toLocaleDateString(locale, { weekday: 'long' });
  const month = now.toLocaleDateString(locale, { month: 'long' });
  const date = now.getDate();
  const year = now.getFullYear();
  
  // Size-based label configurations
  const sizeConfig = {
    sm: { 
      weekday: 'md' as const, 
      date: '5xl' as const, 
      month: 'md' as const,
      gap: '4px',
    },
    md: { 
      weekday: 'lg' as const, 
      date: '6xl' as const, 
      month: 'lg' as const,
      gap: '6px',
    },
    lg: { 
      weekday: 'xl' as const, 
      date: '8xl' as const, 
      month: 'xl' as const,
      gap: '8px',
    },
  };
  
  const labelSizes = sizeConfig[size || 'sm'];

  // Settings panel configuration
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
      key: 'showWeekday',
      label: 'Show Weekday',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      key: 'showMonth',
      label: 'Show Month',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      key: 'showYear',
      label: 'Show Year Badge',
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
  ];

  const handleSettingsSave = useCallback((values: Record<string, any>) => {
    // Apply settings immediately to local state
    const newConfig: CalendarDetailWidgetConfig = {
      showWeekday: values.showWeekday ?? localConfig.showWeekday,
      showMonth: values.showMonth ?? localConfig.showMonth,
      showYear: values.showYear ?? localConfig.showYear,
      size: values.size ?? localConfig.size,
      design: values.design ?? localConfig.design,
      locale: values.locale ?? localConfig.locale,
    };
    setLocalConfig(newConfig);
    
    // Build updated config with user's new values
    // IMPORTANT: Include type from original config for proper serialization
    const updatedConfig = {
      type: rawConfig.type, // MUST include type for widget to work
      ...values, // User's new settings values
    };
    
    // Call onUpdate to notify parent (if available)
    if (onUpdate) {
      onUpdate({ config: updatedConfig });
    }
    
    // Dispatch custom event for WidgetRenderer to catch and persist to code block
    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'settings-change',
        config: updatedConfig,
        data: {},
        widgetId: rawConfig.id,
      },
    });
    document.dispatchEvent(customEvent);
    
    setShowSettings(false);
  }, [onUpdate, rawConfig, localConfig]);

  const toggleSettings = useCallback(() => {
    setShowSettings(prev => !prev);
  }, []);

  return (
    <Widget size={size} design={design}>
      {/* Settings Button */}
      <WidgetHeader>
        <div style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSettings}
          title="Widget Settings"
          style={{
            opacity: showSettings ? 1 : 0.6,
            transform: showSettings ? 'rotate(90deg)' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          ⚙️
        </Button>
      </WidgetHeader>

      {/* Calendar Display */}
      <WidgetContent 
        style={{ 
          flexDirection: 'column', 
          alignItems: 'center', 
          gap: labelSizes.gap,
          padding: '0 8px 8px 8px',
        }}
      >
        {/* Weekday */}
        {showWeekday && (
          <Label size={labelSizes.weekday} variant="muted">
            {day}
          </Label>
        )}
        
        {/* Date Number (large) */}
        <Label 
          size={labelSizes.date} 
          style={{ 
            lineHeight: 1,
            letterSpacing: '-0.02em',
          }}
        >
          {date}
        </Label>
        
        {/* Month */}
        {showMonth && (
          <Label size={labelSizes.month} variant="muted">
            {month}
          </Label>
        )}
        
        {/* Year Badge */}
        {showYear && (
          <Badge variant="outline" style={{ marginTop: '4px' }}>
            {year}
          </Badge>
        )}
      </WidgetContent>

      {/* Settings Panel */}
      {showSettings && (
        <WidgetSettingsPanel
          title="Calendar Settings"
          fields={settingsFields}
          values={localConfig}
          onSave={handleSettingsSave}
          onClose={() => setShowSettings(false)}
        />
      )}
    </Widget>
  );
};
