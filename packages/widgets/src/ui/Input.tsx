/**
 * Input UI Components
 * 
 * Form inputs styled for VS Code theme integration
 */

import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'outline';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant = 'default', style, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`widget-input ${className || ''}`}
        style={{
          width: 'calc(100% - 16px)',
          padding: '6px 8px',
          fontSize: '13px',
          fontFamily: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif)',
          borderRadius: '4px',
          border: '1px solid var(--vscode-input-border, #3c3c3c)',
          background: 'var(--vscode-input-background, #3c3c3c)',
          color: 'var(--vscode-input-foreground, #cccccc)',
          outline: 'none',
          transition: 'border-color 0.15s ease',
          ...style,
        }}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, style, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`widget-textarea ${className || ''}`}
        style={{
          width: 'calc(100% - 16px)',
          padding: '8px',
          fontSize: '13px',
          fontFamily: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif)',
          borderRadius: '4px',
          border: '1px solid var(--vscode-input-border, #3c3c3c)',
          background: 'var(--vscode-input-background, #3c3c3c)',
          color: 'var(--vscode-input-foreground, #cccccc)',
          outline: 'none',
          resize: 'vertical',
          minHeight: '60px',
          transition: 'border-color 0.15s ease',
          ...style,
        }}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children?: React.ReactNode;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, style, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`widget-select ${className || ''}`}
        style={{
          width: '100%',
          padding: '6px 8px',
          fontSize: '13px',
          fontFamily: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif)',
          borderRadius: '4px',
          border: '1px solid var(--vscode-input-border, #3c3c3c)',
          background: 'var(--vscode-input-background, #3c3c3c)',
          color: 'var(--vscode-input-foreground, #cccccc)',
          outline: 'none',
          cursor: 'pointer',
          ...style,
        }}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, style, ...props }, ref) => {
    return (
      <label
        className={`widget-checkbox ${className || ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          fontSize: '13px',
          color: 'var(--vscode-editor-foreground, #cccccc)',
          ...style,
        }}
      >
        <input
          ref={ref}
          type="checkbox"
          style={{
            width: '16px',
            height: '16px',
            cursor: 'pointer',
            accentColor: 'var(--vscode-button-background, #0e639c)',
          }}
          {...props}
        />
        {label && <span>{label}</span>}
      </label>
    );
  }
);
Checkbox.displayName = 'Checkbox';
