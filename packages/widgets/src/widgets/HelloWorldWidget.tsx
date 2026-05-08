/**
 * HelloWorldWidget - Simple example widget
 * 
 * Demonstrates the React widget pattern
 */

import React from 'react';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

export const HelloWorldWidget: React.FC<ReactWidgetProps> = ({ config, data }) => {
  const [count, setCount] = React.useState(0);
  
  return (
    <div className="widget-container hello-world-widget">
      <h3>{config.title || 'Hello World Widget'}</h3>
      
      <div style={{ padding: '16px' }}>
        <p>Widget ID: {config.id}</p>
        <p>Widget Type: {config.type}</p>
        
        {data && (
          <div>
            <h4>Data:</h4>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        )}
        
        <div style={{ marginTop: '16px' }}>
          <button 
            className="widget-button"
            onClick={() => setCount(count + 1)}
          >
            Clicked {count} times
          </button>
        </div>
      </div>
    </div>
  );
};
