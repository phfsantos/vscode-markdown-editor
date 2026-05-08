/**
 * Button UI Component
 * 
 * Inspired by wigggle-ui Button component
 * Supports VS Code theme integration via CSS variables
 */

import React from 'react';

export type ButtonVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  default: {
    background: 'var(--vscode-button-background, #0e639c)',
    color: 'var(--vscode-button-foreground, #ffffff)',
    border: 'none',
  },
  secondary: {
    background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
    color: 'var(--vscode-button-secondaryForeground, #cccccc)',
    border: 'none',
  },
  destructive: {
    background: 'var(--vscode-testing-iconFailed, #f44336)',
    color: '#ffffff',
    border: 'none',
  },
  outline: {
    background: 'transparent',
    color: 'var(--vscode-editor-foreground, #cccccc)',
    border: '1px solid var(--vscode-panel-border, #454545)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--vscode-editor-foreground, #cccccc)',
    border: 'none',
  },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: {
    padding: '4px 8px',
    fontSize: '12px',
    height: '24px',
    minWidth: '60px',
  },
  md: {
    padding: '6px 12px',
    fontSize: '13px',
    height: '28px',
    minWidth: '80px',
  },
  lg: {
    padding: '8px 16px',
    fontSize: '14px',
    height: '32px',
    minWidth: '100px',
  },
  icon: {
    padding: '4px',
    fontSize: '16px',
    height: '28px',
    width: '28px',
    minWidth: 'unset',
  },
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', style, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`widget-button ${className || ''}`}
        disabled={disabled}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          borderRadius: '4px',
          fontFamily: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif)',
          fontWeight: 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
          opacity: disabled ? 0.5 : 1,
          ...variantStyles[variant],
          ...sizeStyles[size],
          ...style,
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
