/**
 * Settings UI Components
 * 
 * React components for widget configuration and settings
 */

import React, { useState, useCallback, useEffect, useId } from 'react';
import {
  isSafePropertyPath,
  type IWidgetConfig,
  type IDataSource,
  type IWidgetConnection,
  type IWidgetAction,
  type PropertyPath,
  type ValueExpression,
  type WidgetAction,
  type WidgetActionMetadata,
} from '../core/types';

export interface WidgetSettingsProps {
  config: IWidgetConfig;
  onChange: (config: IWidgetConfig) => void;
  onClose?: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValueExpression(value: unknown, depth = 0): value is ValueExpression {
  if (depth > 64 || !isRecord(value) || typeof value.kind !== 'string') {
    return false;
  }

  switch (value.kind) {
    case 'literal':
      return Object.prototype.hasOwnProperty.call(value, 'value');
    case 'get':
      return isSafePropertyPath(value.path);
    case 'coalesce':
    case 'concat':
      return Array.isArray(value.values)
        && value.values.every((item) => isValueExpression(item, depth + 1));
    case 'arithmetic':
      return ['add', 'subtract', 'multiply', 'divide'].includes(String(value.operator))
        && isValueExpression(value.left, depth + 1)
        && isValueExpression(value.right, depth + 1);
    case 'comparison':
      return [
        'equals',
        'not-equals',
        'less-than',
        'less-than-or-equal',
        'greater-than',
        'greater-than-or-equal',
      ].includes(String(value.operator))
        && isValueExpression(value.left, depth + 1)
        && isValueExpression(value.right, depth + 1);
    default:
      return false;
  }
}

function serializeExpression(value: unknown): string {
  if (value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

function parseExpression(value: string): { expression?: ValueExpression; error?: string } {
  if (!value.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string') {
      return { error: 'Legacy JavaScript expressions are unsupported. Use a declarative expression object.' };
    }
    if (!isValueExpression(parsed)) {
      return { error: 'Use a valid declarative expression with a supported kind and safe property path.' };
    }
    return { expression: parsed };
  } catch {
    return { error: 'Expression must be valid JSON.' };
  }
}

const ExpressionEditor: React.FC<{
  label: string;
  value?: unknown;
  onChange: (expression?: ValueExpression) => void;
  rows?: number;
}> = ({ label, value, onChange, rows = 4 }) => {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const validationError = typeof value === 'string'
    ? 'Legacy JavaScript expressions are unsupported. Use a declarative expression object.'
    : value !== undefined && !isValueExpression(value)
      ? 'This expression is invalid and will be rejected at runtime.'
      : undefined;
  const [draft, setDraft] = useState(() => serializeExpression(value));
  const [error, setError] = useState<string | undefined>(validationError);

  useEffect(() => {
    setDraft(serializeExpression(value));
    setError(validationError);
  }, [value, validationError]);

  const handleChange = (nextValue: string) => {
    setDraft(nextValue);
    const parsed = parseExpression(nextValue);
    setError(parsed.error);
    if (!parsed.error) {
      onChange(parsed.expression);
    }
  };

  return (
    <div className="form-group">
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        className="widget-input"
        rows={rows}
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        placeholder='{"kind":"get","path":["results"]}'
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="widget-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

/**
 * Main widget settings component
 */
export const WidgetSettings: React.FC<WidgetSettingsProps> = ({ config, onChange, onClose }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'data' | 'connections' | 'actions' | 'theme'>('general');
  
  const updateConfig = useCallback((updates: Partial<IWidgetConfig>) => {
    onChange({ ...config, ...updates });
  }, [config, onChange]);
  
  return (
    <div className="widget-settings">
      <div className="widget-settings-header">
        <h2>Widget Settings</h2>
        {onClose && (
          <button onClick={onClose} className="widget-button">
            Close
          </button>
        )}
      </div>
      
      <div className="widget-settings-tabs">
        <button
          className={activeTab === 'general' ? 'active' : ''}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
        <button
          className={activeTab === 'data' ? 'active' : ''}
          onClick={() => setActiveTab('data')}
        >
          Data Source
        </button>
        <button
          className={activeTab === 'connections' ? 'active' : ''}
          onClick={() => setActiveTab('connections')}
        >
          Connections
        </button>
        <button
          className={activeTab === 'actions' ? 'active' : ''}
          onClick={() => setActiveTab('actions')}
        >
          Actions
        </button>
        <button
          className={activeTab === 'theme' ? 'active' : ''}
          onClick={() => setActiveTab('theme')}
        >
          Theme
        </button>
      </div>
      
      <div className="widget-settings-content">
        {activeTab === 'general' && (
          <GeneralSettings config={config} onChange={updateConfig} />
        )}
        {activeTab === 'data' && (
          <DataSourceEditor
            dataSource={config.dataSource}
            onChange={(dataSource) => updateConfig({ dataSource })}
          />
        )}
        {activeTab === 'connections' && (
          <ConnectionsEditor
            connections={config.connections || []}
            onChange={(connections) => updateConfig({ connections })}
          />
        )}
        {activeTab === 'actions' && (
          <ActionsEditor
            actions={config.actions || []}
            onChange={(actions) => updateConfig({ actions })}
          />
        )}
        {activeTab === 'theme' && (
          <ThemeEditor
            theme={config.theme}
            customCss={config.customCss}
            onChange={(theme, customCss) => updateConfig({ theme, customCss })}
          />
        )}
      </div>
    </div>
  );
};

/**
 * General settings tab
 */
const GeneralSettings: React.FC<{
  config: IWidgetConfig;
  onChange: (updates: Partial<IWidgetConfig>) => void;
}> = ({ config, onChange }) => {
  return (
    <div className="general-settings">
      <div className="form-group">
        <label>Title</label>
        <input
          type="text"
          className="widget-input"
          value={config.title || ''}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      
      <div className="form-group">
        <label>Size</label>
        <select
          className="widget-input"
          value={config.size}
          onChange={(e) => onChange({ size: e.target.value as 'sm' | 'md' | 'lg' })}
        >
          <option value="sm">Small</option>
          <option value="md">Medium</option>
          <option value="lg">Large</option>
        </select>
      </div>
      
      <div className="form-group">
        <label>Refresh Interval (seconds)</label>
        <input
          type="number"
          className="widget-input"
          value={config.refreshInterval || ''}
          onChange={(e) => onChange({ refreshInterval: parseInt(e.target.value) || undefined })}
          placeholder="Auto-refresh interval"
        />
      </div>
    </div>
  );
};

/**
 * Data source editor component
 */
export const DataSourceEditor: React.FC<{
  dataSource?: IDataSource;
  onChange: (dataSource?: IDataSource) => void;
}> = ({ dataSource, onChange }) => {
  const [source, setSource] = useState<IDataSource>(
    dataSource || { type: 'static', config: {} }
  );
  
  const updateSource = (updates: Partial<IDataSource>) => {
    const updated = { ...source, ...updates };
    setSource(updated);
    onChange(updated);
  };
  
  const updateConfig = (configUpdates: any) => {
    const updated = {
      ...source,
      config: { ...source.config, ...configUpdates }
    };
    setSource(updated);
    onChange(updated);
  };
  
  return (
    <div className="data-source-editor">
      <div className="form-group">
        <label>Source Type</label>
        <select
          className="widget-input"
          value={source.type}
          onChange={(e) => updateSource({ type: e.target.value as any })}
        >
          <option value="static">Static Data</option>
          <option value="api">API</option>
          <option value="file">File</option>
          <option value="computed">Computed</option>
          <option value="widget">Widget</option>
        </select>
      </div>
      
      {source.type === 'api' && (
        <>
          <div className="form-group">
            <label>URL</label>
            <input
              type="text"
              className="widget-input"
              value={source.config.url || ''}
              onChange={(e) => updateConfig({ url: e.target.value })}
              placeholder="https://api.example.com/data"
            />
          </div>
          
          <div className="form-group">
            <label>Method</label>
            <select
              className="widget-input"
              value={source.config.method || 'GET'}
              onChange={(e) => updateConfig({ method: e.target.value })}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
        </>
      )}
      
      {source.type === 'file' && (
        <>
          <div className="form-group">
            <label>File Path</label>
            <input
              type="text"
              className="widget-input"
              value={source.config.path || ''}
              onChange={(e) => updateConfig({ path: e.target.value })}
              placeholder="/path/to/file.json"
            />
          </div>
          
          <div className="form-group">
            <label>Format</label>
            <select
              className="widget-input"
              value={source.config.format || 'json'}
              onChange={(e) => updateConfig({ format: e.target.value })}
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="yaml">YAML</option>
            </select>
          </div>
        </>
      )}
      
      {source.type === 'static' && (
        <div className="form-group">
          <label>Data (JSON)</label>
          <textarea
            className="widget-input"
            rows={10}
            value={JSON.stringify(source.config.data || {}, null, 2)}
            onChange={(e) => {
              try {
                const data = JSON.parse(e.target.value);
                updateConfig({ data });
              } catch (err) {
                // Invalid JSON, ignore
              }
            }}
            placeholder='{"key": "value"}'
          />
        </div>
      )}

      {source.type === 'computed' && (
        <ExpressionEditor
          label="Computed expression (declarative JSON)"
          value={source.config.expression}
          onChange={(expression) => updateConfig({ expression })}
        />
      )}

      {source.type !== 'computed' && (
        <ExpressionEditor
          label="Transform (declarative JSON)"
          value={source.config.transform}
          onChange={(transform) => updateConfig({ transform })}
        />
      )}
    </div>
  );
};

/**
 * Connections editor component
 */
const ConnectionsEditor: React.FC<{
  connections: IWidgetConnection[];
  onChange: (connections: IWidgetConnection[]) => void;
}> = ({ connections, onChange }) => {
  const addConnection = () => {
    onChange([
      ...connections,
      {
        id: `conn-${Date.now()}`,
        sourceWidget: '',
        sourceEvent: '',
        targetProperty: '',
        enabled: true
      }
    ]);
  };
  
  const updateConnection = (index: number, updates: Partial<IWidgetConnection>) => {
    const updated = [...connections];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };
  
  const removeConnection = (index: number) => {
    onChange(connections.filter((_, i) => i !== index));
  };
  
  return (
    <div className="connections-editor">
      <button onClick={addConnection} className="widget-button">
        Add Connection
      </button>
      
      {connections.map((conn, index) => (
        <div key={conn.id} className="connection-item widget-card">
          <div className="form-group">
            <label>Source Widget ID</label>
            <input
              type="text"
              className="widget-input"
              value={conn.sourceWidget}
              onChange={(e) => updateConnection(index, { sourceWidget: e.target.value })}
            />
          </div>
          
          <div className="form-group">
            <label>Source Event</label>
            <input
              type="text"
              className="widget-input"
              value={conn.sourceEvent}
              onChange={(e) => updateConnection(index, { sourceEvent: e.target.value })}
            />
          </div>
          
          <div className="form-group">
            <label>Target Property</label>
            <input
              type="text"
              className="widget-input"
              value={conn.targetProperty}
              onChange={(e) => updateConnection(index, { targetProperty: e.target.value })}
            />
          </div>

          <ExpressionEditor
            label="Connection transform (declarative JSON)"
            value={conn.transform}
            onChange={(transform) => updateConnection(index, { transform })}
            rows={3}
          />
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={conn.enabled}
                onChange={(e) => updateConnection(index, { enabled: e.target.checked })}
              />
              {' '}Enabled
            </label>
          </div>
          
          <button onClick={() => removeConnection(index)} className="widget-button">
            Remove
          </button>
        </div>
      ))}
    </div>
  );
};

/**
 * Actions editor component
 */
function literalExpression(value: string | boolean | null): ValueExpression {
  return { kind: 'literal', value };
}

function createAction(kind: WidgetAction['kind'], id: string): IWidgetAction {
  switch (kind) {
    case 'set-data':
      return {
        id,
        label: 'Set data',
        kind,
        path: ['status'],
        value: literalExpression(null),
      };
    case 'open-url':
      return {
        id,
        label: 'Open URL',
        kind,
        url: literalExpression('https://example.com'),
      };
    case 'emit':
    default:
      return {
        id,
        label: 'Emit event',
        kind: 'emit',
        event: 'widget-event',
      };
  }
}

function parsePropertyPath(value: string): PropertyPath | undefined {
  const path = value.split('.').map((part) => part.trim());
  return path.length > 0 && isSafePropertyPath(path) ? path : undefined;
}

const ActionsEditor: React.FC<{
  actions: IWidgetAction[];
  onChange: (actions: IWidgetAction[]) => void;
}> = ({ actions, onChange }) => {
  const [pathErrors, setPathErrors] = useState<Record<number, string>>({});

  const addAction = () => {
    onChange([
      ...actions,
      createAction('emit', `action-${Date.now()}`),
    ]);
  };
  
  const updateActionMetadata = (index: number, updates: Partial<WidgetActionMetadata>) => {
    const updated = [...actions];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const replaceActionKind = (index: number, kind: WidgetAction['kind']) => {
    const current = actions[index];
    const replacement = createAction(kind, current.id);
    onChange(actions.map((action, actionIndex) => (
      actionIndex === index
        ? { ...replacement, label: current.label || replacement.label, icon: current.icon }
        : action
    )));
  };

  const updateAction = (index: number, action: IWidgetAction) => {
    onChange(actions.map((current, actionIndex) => actionIndex === index ? action : current));
  };

  const updatePath = (index: number, rawPath: string) => {
    const path = parsePropertyPath(rawPath);
    if (!path) {
      setPathErrors((errors) => ({ ...errors, [index]: 'Use non-empty dot-separated safe keys.' }));
      return;
    }

    const action = actions[index];
    if (action.kind === 'set-data') {
      updateAction(index, { ...action, path });
      setPathErrors((errors) => {
        const next = { ...errors };
        delete next[index];
        return next;
      });
    }
  };
  
  const removeAction = (index: number) => {
    onChange(actions.filter((_, i) => i !== index));
  };
  
  return (
    <div className="actions-editor">
      <button onClick={addAction} className="widget-button">
        Add Action
      </button>
      
      {actions.map((action, index) => (
        <div key={action.id} className="action-item widget-card">
          <div className="form-group">
            <label htmlFor={`widget-action-label-${action.id}`}>Label</label>
            <input
              id={`widget-action-label-${action.id}`}
              type="text"
              className="widget-input"
              value={action.label}
              onChange={(e) => updateActionMetadata(index, { label: e.target.value })}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor={`widget-action-icon-${action.id}`}>Icon</label>
            <input
              id={`widget-action-icon-${action.id}`}
              type="text"
              className="widget-input"
              value={action.icon || ''}
              onChange={(e) => updateActionMetadata(index, { icon: e.target.value })}
              placeholder="codicon-name"
            />
          </div>

          <div className="form-group">
            <label htmlFor={`widget-action-kind-${action.id}`}>Action kind</label>
            <select
              id={`widget-action-kind-${action.id}`}
              className="widget-input"
              value={action.kind || ''}
              onChange={(e) => replaceActionKind(index, e.target.value as WidgetAction['kind'])}
            >
              <option value="">Choose an action</option>
              <option value="set-data">Set data</option>
              <option value="emit">Emit event</option>
              <option value="open-url">Open URL</option>
            </select>
          </div>

          {!['set-data', 'emit', 'open-url'].includes(action.kind) && (
            <div className="widget-error" role="alert">
              This legacy action is rejected because executable strings are not supported.
              <button
                type="button"
                className="widget-button"
                onClick={() => replaceActionKind(index, 'emit')}
              >
                Replace with emit action
              </button>
            </div>
          )}

          {action.kind === 'set-data' && (
            <>
              <div className="form-group">
                <label htmlFor={`widget-action-path-${action.id}`}>Data path</label>
                <input
                  id={`widget-action-path-${action.id}`}
                  type="text"
                  className="widget-input"
                  value={action.path.join('.')}
                  onChange={(e) => updatePath(index, e.target.value)}
                  aria-invalid={Boolean(pathErrors[index])}
                  aria-describedby={pathErrors[index] ? `widget-action-path-error-${action.id}` : undefined}
                />
                {pathErrors[index] && (
                  <p id={`widget-action-path-error-${action.id}`} className="widget-error" role="alert">
                    {pathErrors[index]}
                  </p>
                )}
              </div>
              <ExpressionEditor
                label="Value (declarative JSON)"
                value={action.value}
                onChange={(value) => updateAction(index, { ...action, value: value || literalExpression(null) })}
                rows={3}
              />
            </>
          )}

          {action.kind === 'emit' && (
            <>
              <div className="form-group">
                <label htmlFor={`widget-action-event-${action.id}`}>Event name</label>
                <input
                  id={`widget-action-event-${action.id}`}
                  type="text"
                  className="widget-input"
                  value={action.event}
                  onChange={(e) => updateAction(index, { ...action, event: e.target.value })}
                  placeholder="widget-event"
                />
              </div>
              <ExpressionEditor
                label="Payload (declarative JSON, optional)"
                value={action.payload}
                onChange={(payload) => updateAction(index, { ...action, payload })}
                rows={3}
              />
            </>
          )}

          {action.kind === 'open-url' && (
            <ExpressionEditor
              label="URL (declarative JSON)"
              value={action.url}
              onChange={(url) => updateAction(index, { ...action, url: url || literalExpression('https://') })}
              rows={3}
            />
          )}
          
          <button type="button" onClick={() => removeAction(index)} className="widget-button">
            Remove
          </button>
        </div>
      ))}
    </div>
  );
};

/**
 * Theme editor component
 */
const ThemeEditor: React.FC<{
  theme?: any;
  customCss?: string;
  onChange: (theme: any, customCss?: string) => void;
}> = ({ customCss, onChange }) => {
  return (
    <div className="theme-editor">
      <div className="form-group">
        <label>Custom CSS</label>
        <textarea
          className="widget-input"
          rows={15}
          value={customCss || ''}
          onChange={(e) => onChange(undefined, e.target.value)}
          placeholder=".my-widget { color: red; }"
        />
      </div>
    </div>
  );
};
