/**
 * Widget UI Components
 * 
 * Base components for building widgets, inspired by wigggle-ui
 * Supports VS Code theme integration via CSS variables
 */

import React from 'react';

// Widget sizes
export type WidgetSize = 'sm' | 'md' | 'lg';

// Widget design variants
export type WidgetDesign = 'default' | 'minimal' | 'glass';

export interface WidgetProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: WidgetSize;
  design?: WidgetDesign;
  children?: React.ReactNode;
}

const sizeStyles: Record<WidgetSize, React.CSSProperties> = {
  sm: { width: '180px', minHeight: '180px' },
  md: { width: '360px', minHeight: '180px' },
  lg: { width: '360px', minHeight: '360px' },
};

const designStyles: Record<WidgetDesign, React.CSSProperties> = {
  default: {
    padding: '16px',
    background: 'var(--vscode-editor-background, #1e1e1e)',
    border: '1px solid var(--vscode-panel-border, #3c3c3c)',
  },
  minimal: {
    padding: '12px',
    background: 'transparent',
    border: 'none',
  },
  glass: {
    padding: '16px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
};

export const Widget = React.forwardRef<HTMLDivElement, WidgetProps>(
  ({ className, size = 'sm', design = 'default', style, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`widget ${className || ''}`}
        style={{
          position: 'relative', // Required for absolute positioned children like settings panel
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '16px',
          color: 'var(--vscode-editor-foreground, #cccccc)',
          fontFamily: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif)',
          overflow: 'hidden',
          ...sizeStyles[size],
          ...designStyles[design],
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Widget.displayName = 'Widget';

export interface WidgetHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export const WidgetHeader = React.forwardRef<HTMLDivElement, WidgetHeaderProps>(
  ({ className, style, children, ...props }, ref) => (
    <div
      ref={ref}
      className={`widget-header ${className || ''}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexShrink: 0,
        marginBottom: '8px',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
);
WidgetHeader.displayName = 'WidgetHeader';

export interface WidgetTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children?: React.ReactNode;
}

export const WidgetTitle = React.forwardRef<HTMLHeadingElement, WidgetTitleProps>(
  ({ className, style, children, ...props }, ref) => (
    <h3
      ref={ref}
      className={`widget-title ${className || ''}`}
      style={{
        margin: 0,
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--vscode-editor-foreground, #cccccc)',
        letterSpacing: '-0.01em',
        ...style,
      }}
      {...props}
    >
      {children}
    </h3>
  )
);
WidgetTitle.displayName = 'WidgetTitle';

export interface WidgetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export const WidgetContent = React.forwardRef<HTMLDivElement, WidgetContentProps>(
  ({ className, style, children, ...props }, ref) => (
    <div
      ref={ref}
      className={`widget-content ${className || ''}`}
      style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
);
WidgetContent.displayName = 'WidgetContent';

export interface WidgetFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export const WidgetFooter = React.forwardRef<HTMLDivElement, WidgetFooterProps>(
  ({ className, style, children, ...props }, ref) => (
    <div
      ref={ref}
      className={`widget-footer ${className || ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        marginTop: '8px',
        fontSize: '12px',
        color: 'var(--vscode-descriptionForeground, #8b8b8b)',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
);
WidgetFooter.displayName = 'WidgetFooter';

// Label component for consistent text styling
export interface LabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'muted' | 'productive' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '8xl';
  children?: React.ReactNode;
}

const labelSizes: Record<string, string> = {
  sm: '12px',
  md: '14px',
  lg: '18px',
  xl: '24px',
  '2xl': '30px',
  '3xl': '36px',
  '4xl': '48px',
  '5xl': '60px',
  '6xl': '72px',
  '8xl': '96px',
};

const labelVariants: Record<string, string> = {
  default: 'var(--vscode-editor-foreground, #cccccc)',
  muted: 'var(--vscode-descriptionForeground, #8b8b8b)',
  productive: 'var(--vscode-testing-iconPassed, #4caf50)',
  destructive: 'var(--vscode-testing-iconFailed, #f44336)',
};

const isBoldSize = (size: string): boolean => {
  return ['xl', '2xl', '3xl', '4xl', '5xl', '6xl', '8xl'].includes(size);
};

export const Label = React.forwardRef<HTMLSpanElement, LabelProps>(
  ({ className, variant = 'default', size = 'md', style, children, ...props }, ref) => (
    <span
      ref={ref}
      className={`widget-label ${className || ''}`}
      style={{
        fontSize: labelSizes[size],
        color: labelVariants[variant],
        fontWeight: isBoldSize(size) ? 600 : 400,
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  )
);
Label.displayName = 'Label';
