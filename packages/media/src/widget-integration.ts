/**
 * Widget System Integration
 * 
 * This module initializes and manages the widget system in the markdown editor
 */

// Extend the window interface to include widget exports
declare global {
  interface Window {
    markdownWidgets?: any;
  }
}

let widgetsInitialized = false;

/**
 * Initialize the widget system
 */
export function initializeWidgetSystem() {
  if (widgetsInitialized) {
    return;
  }

  // Check if widget bundle is loaded
  if (!window.markdownWidgets) {
    return;
  }

  try {
    const { registerCoreWidgets, WidgetRegistry } = window.markdownWidgets;
    
    if (!registerCoreWidgets) {
      console.error('[Widgets] registerCoreWidgets function not found in bundle');
      return;
    }
    
    if (!WidgetRegistry) {
      console.error('[Widgets] WidgetRegistry class not found in bundle');
      return;
    }
    
    // Register all core widgets
    registerCoreWidgets();
    
    widgetsInitialized = true;
  } catch (error) {
    console.error('[Widgets] Initialization error:', error);
  }
}

/**
 * Parse widget code blocks from markdown content
 * 
 * Looks for code blocks with language "widget" and extracts config and data
 * Format:
 * ```widget
 * type: chart
 * title: My Chart
 * ---
 * data: [...]
 * ```
 */
export function parseWidgetBlocks(markdown: string) {
  const widgetBlockRegex = /```widget\s*\n([\s\S]*?)```/g;
  const widgets: Array<{
    fullText: string;
    config: any;
    data: any;
  }> = [];

  let match;
  while ((match = widgetBlockRegex.exec(markdown)) !== null) {
    const content = match[1];
    const fullText = match[0];
    
    // Split by --- separator (config above, data below)
    const parts = content.split(/\n---\s*\n/);
    
    try {
      // Parse config (YAML-like simple format)
      const configLines = parts[0].trim().split('\n');
      const config: any = { id: `widget-${Date.now()}-${Math.random()}` };
      
      configLines.forEach(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          
          // Try to parse as JSON if it looks like JSON
          if (value.startsWith('{') || value.startsWith('[')) {
            try {
              config[key] = JSON.parse(value);
            } catch {
              config[key] = value;
            }
          } else {
            config[key] = value;
          }
        }
      });
      
      // Parse data (JSON format)
      let data = null;
      if (parts[1]) {
        const dataText = parts[1].trim();
        if (dataText.startsWith('data:')) {
          const jsonText = dataText.substring(5).trim();
          try {
            data = JSON.parse(jsonText);
          } catch (error) {
            console.error('[Widgets] Failed to parse data:', error);
          }
        }
      }
      
      widgets.push({ fullText, config, data });
    } catch (error) {
      console.error('[Widgets] Failed to parse widget block:', error);
    }
  }
  
  return widgets;
}

/**
 * Insert a widget at the cursor position
 */
export function insertWidget(type: string, config: any = {}, data: any = null) {
  // Create widget markdown block
  const configLines = Object.entries({ type, ...config })
    .map(([key, value]) => {
      if (typeof value === 'object') {
        return `${key}: ${JSON.stringify(value)}`;
      }
      return `${key}: ${value}`;
    })
    .join('\n');
  
  const dataSection = data ? `\n---\ndata: ${JSON.stringify(data, null, 2)}` : '';
  
  const widgetBlock = `\`\`\`widget\n${configLines}${dataSection}\n\`\`\`\n`;
  
  return widgetBlock;
}
