/**
 * Settings UI Components
 * 
 * React components for widget configuration and settings
 */

import React, { useState, useCallback } from 'react';
import type { IWidgetConfig, IDataSource, IWidgetConnection, IWidgetAction } from '../core/types';

export interface WidgetSettingsProps {
  config: IWidgetConfig;
  onChange: (config: IWidgetConfig) => void;
  onClose?: () => void;
}

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
      
      <div className="form-group">
        <label>Transform (JavaScript expression)</label>
        <textarea
          className="widget-input"
          rows={3}
          value={source.config.transform || ''}
          onChange={(e) => updateConfig({ transform: e.target.value })}
          placeholder="data => data.results"
        />
      </div>
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
const ActionsEditor: React.FC<{
  actions: IWidgetAction[];
  onChange: (actions: IWidgetAction[]) => void;
}> = ({ actions, onChange }) => {
  const addAction = () => {
    onChange([
      ...actions,
      {
        id: `action-${Date.now()}`,
        label: 'New Action',
        script: ''
      }
    ]);
  };
  
  const updateAction = (index: number, updates: Partial<IWidgetAction>) => {
    const updated = [...actions];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
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
            <label>Label</label>
            <input
              type="text"
              className="widget-input"
              value={action.label}
              onChange={(e) => updateAction(index, { label: e.target.value })}
            />
          </div>
          
          <div className="form-group">
            <label>Icon</label>
            <input
              type="text"
              className="widget-input"
              value={action.icon || ''}
              onChange={(e) => updateAction(index, { icon: e.target.value })}
              placeholder="codicon-name"
            />
          </div>
          
          <div className="form-group">
            <label>Script</label>
            <textarea
              className="widget-input"
              rows={5}
              value={action.script}
              onChange={(e) => updateAction(index, { script: e.target.value })}
              placeholder="JavaScript code to execute"
            />
          </div>
          
          <button onClick={() => removeAction(index)} className="widget-button">
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
