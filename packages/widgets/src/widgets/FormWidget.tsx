/**
 * FormWidget - Dynamic form builder with validation
 * Inspired by wigggle-ui dashboard-06 pattern
 * 
 * Features: text, number, select, checkbox, textarea fields, validation, submission
 */

import React, { useState, useCallback } from 'react';
import { 
  Widget, WidgetHeader, WidgetTitle, WidgetContent, WidgetFooter,
  Button, Input, Textarea, Select, Checkbox, Label
} from '../ui';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'password' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'date';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    custom?: (value: any) => string | null;
  };
  defaultValue?: any;
}

export interface FormWidgetConfig {
  fields?: FormField[];
  submitLabel?: string;
  submitAction?: string;
  resetOnSubmit?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const FormWidget: React.FC<ReactWidgetProps> = ({ config, onUpdate, onError }) => {
  const widgetConfig = config as any as FormWidgetConfig;
  
  const fields = widgetConfig.fields || [];
  const submitLabel = widgetConfig.submitLabel || 'Submit';
  const resetOnSubmit = widgetConfig.resetOnSubmit !== false;
  const size = widgetConfig.size || 'md';
  
  // Initialize form values
  const initialValues = fields.reduce((acc, field) => {
    acc[field.name] = field.defaultValue ?? (field.type === 'checkbox' ? false : '');
    return acc;
  }, {} as Record<string, any>);
  
  const [values, setValues] = useState<Record<string, any>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const validateField = useCallback((field: FormField, value: any): string | null => {
    // Required check
    if (field.required && !value && value !== 0) {
      return `${field.label} is required`;
    }
    
    if (!field.validation || !value) return null;
    
    const { pattern, min, max, minLength, maxLength, custom } = field.validation;
    
    // Pattern validation
    if (pattern && typeof value === 'string') {
      const regex = new RegExp(pattern);
      if (!regex.test(value)) {
        return `${field.label} format is invalid`;
      }
    }
    
    // Number range validation
    if (field.type === 'number') {
      const numValue = Number(value);
      if (min !== undefined && numValue < min) {
        return `${field.label} must be at least ${min}`;
      }
      if (max !== undefined && numValue > max) {
        return `${field.label} must be at most ${max}`;
      }
    }
    
    // String length validation
    if (typeof value === 'string') {
      if (minLength !== undefined && value.length < minLength) {
        return `${field.label} must be at least ${minLength} characters`;
      }
      if (maxLength !== undefined && value.length > maxLength) {
        return `${field.label} must be at most ${maxLength} characters`;
      }
    }
    
    // Custom validation
    if (custom) {
      return custom(value);
    }
    
    return null;
  }, []);
  
  const handleChange = (fieldName: string, value: any) => {
    setValues(prev => ({ ...prev, [fieldName]: value }));
    
    // Clear error when user starts typing
    if (errors[fieldName]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  };
  
  const handleBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
    
    const field = fields.find(f => f.name === fieldName);
    if (field) {
      const error = validateField(field, values[fieldName]);
      if (error) {
        setErrors(prev => ({ ...prev, [fieldName]: error }));
      }
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all fields
    const newErrors: Record<string, string> = {};
    fields.forEach(field => {
      const error = validateField(field, values[field.name]);
      if (error) {
        newErrors[field.name] = error;
      }
    });
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setTouched(fields.reduce((acc, field) => {
        acc[field.name] = true;
        return acc;
      }, {} as Record<string, boolean>));
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Call onUpdate with form values and emit event
      onUpdate?.(values);
      
      // Dispatch custom event for form submission
      const customEvent = new CustomEvent('widget-update', {
        bubbles: true,
        detail: { 
          type: 'form-submit', 
          data: values, 
          config: widgetConfig,
          widgetId: (config as any).id,
        },
      });
      document.dispatchEvent(customEvent);
      
      // Execute submit action if provided
      if (widgetConfig.submitAction) {
        console.log('Executing submit action:', widgetConfig.submitAction);
      }
      
      // Reset form if configured
      if (resetOnSubmit) {
        setValues(initialValues);
        setTouched({});
        setErrors({});
      }
    } catch (error) {
      console.error('Form submission error:', error);
      onError?.(error as Error);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const renderField = (field: FormField) => {
    const value = values[field.name];
    const commonProps = {
      id: field.name,
      name: field.name,
      required: field.required,
      onBlur: () => handleBlur(field.name)
    };
    
    switch (field.type) {
      case 'textarea':
        return (
          <Textarea
            {...commonProps}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => handleChange(field.name, e.target.value)}
            rows={3}
          />
        );
      
      case 'select':
        return (
          <Select
            {...commonProps}
            value={value}
            onChange={(e) => handleChange(field.name, e.target.value)}
          >
            <option value="">Select...</option>
            {field.options?.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        );
      
      case 'checkbox':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Checkbox
              {...commonProps}
              checked={value}
              onChange={(e) => handleChange(field.name, e.target.checked)}
            />
            <Label size="sm">{field.label}</Label>
          </div>
        );
      
      case 'radio':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {field.options?.map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="radio"
                  name={field.name}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  onBlur={() => handleBlur(field.name)}
                  style={{
                    accentColor: 'var(--vscode-button-background)',
                  }}
                />
                <Label size="sm">{opt.label}</Label>
              </label>
            ))}
          </div>
        );
      
      default:
        return (
          <Input
            {...commonProps}
            type={field.type}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => handleChange(field.name, e.target.value)}
          />
        );
    }
  };
  
  return (
    <Widget size={size} design="default">
      <WidgetHeader>
        <WidgetTitle>{config.title || 'Form'}</WidgetTitle>
      </WidgetHeader>
      
      <WidgetContent style={{ alignItems: 'stretch', flexDirection: 'column' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {fields.map(field => (
            <div key={field.name}>
              {field.type !== 'checkbox' && (
                <label 
                  htmlFor={field.name} 
                  style={{ 
                    display: 'block', 
                    marginBottom: '4px', 
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--vscode-editor-foreground)',
                  }}
                >
                  {field.label}
                  {field.required && (
                    <span style={{ color: 'var(--vscode-errorForeground)', marginLeft: '2px' }}>*</span>
                  )}
                </label>
              )}
              
              {renderField(field)}
              
              {touched[field.name] && errors[field.name] && (
                <span style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--vscode-errorForeground)',
                  marginTop: '4px',
                }}>
                  {errors[field.name]}
                </span>
              )}
            </div>
          ))}
        </form>
      </WidgetContent>
      
      <WidgetFooter style={{ gap: '8px', justifyContent: 'flex-start' }}>
        <Button
          type="submit"
          variant="default"
          size="sm"
          disabled={isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? 'Submitting...' : submitLabel}
        </Button>
        
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setValues(initialValues);
            setErrors({});
            setTouched({});
          }}
        >
          Reset
        </Button>
      </WidgetFooter>
    </Widget>
  );
};
