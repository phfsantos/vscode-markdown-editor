import { BaseRenderer } from '../BaseRenderer';
import { IRenderer, IRenderContext, IRendererCapabilities } from '../types';
import { vscodeLogError, vscodeLog } from '../../webview-logger';
import { initializeWidgetSystem } from '../../widget-integration';

/**
 * WidgetRenderer - Renders widget code blocks using the widget system
 * 
 * Supports various widget types:
 * - Data widgets: chart, table, form
 * - Time widgets: clock, calendar, timer
 * - Info widgets: weather, stock, productivity
 * 
 * Usage:
 * ```widget
 * type: clock
 * title: Current Time
 * format: 12h
 * showSeconds: true
 * ```
 * 
 * ```widget
 * type: timer
 * title: Focus Timer
 * initialMinutes: 25
 * design: default
 * ---
 * data: {"timeLeft": 1500, "isRunning": false}
 * ```
 */
export class WidgetRenderer extends BaseRenderer implements IRenderer {
  readonly id = 'widget-renderer';
  readonly name = 'Widget';
  readonly language = 'widget';
  readonly version = '2.0.0';
  readonly description = 'Interactive widgets (clock, calendar, timer, weather, stock, productivity, chart, table, form)';
  readonly author = 'VSCode Markdown Editor';
  
  readonly capabilities: IRendererCapabilities = {
    supportsPersistence: true, // Data saves back to markdown code block
    supportsMultipleInstances: true,
    supportsExport: false,
    supportsImport: false,
    requiresExtensionHost: false // Pure client-side
  };
  
  // Track active widgets for cleanup
  private activeWidgets = new Map<string, { element: HTMLElement; cleanup: () => void }>();

  /**
   * Initialize widget system on load
   */
  async onLoad(context: IRenderContext): Promise<void> {
    // Use the shared initialization function
    initializeWidgetSystem();
    
    // Setup global event listener for widget updates
    this.setupWidgetUpdateListener(context);
  }
  
  /**
   * Setup listener for widget-update events (for persistence)
   * CRITICAL: Only register handlers ONCE globally to prevent duplicate executions
   */
  private setupWidgetUpdateListener(context: IRenderContext): void {
    // CRITICAL: Check if widget-update handler already registered
    if ((window as any).__widgetUpdateHandler) {
      vscodeLog('[WidgetRenderer] widget-update handler already registered, skipping');
      return;
    }
    
    const handleWidgetUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent.detail;
      
      if (!detail) return;
      
      vscodeLog(`[WidgetRenderer] Received widget-update event: ${detail.type}`);
      
      // Get widgetId from event detail (preferred) or try to find from target
      let widgetContainer: Element | null = null;
      let widgetId: string | null = null;
      
      // First, try to get widgetId from event detail
      if (detail.widgetId) {
        widgetId = detail.widgetId;
        widgetContainer = document.querySelector(`.widget-container[data-widget-id="${widgetId}"]`);
        vscodeLog(`[WidgetRenderer] Looking for container with data-widget-id="${widgetId}", found: ${!!widgetContainer}`);
        
        // Debug: List all widget containers in DOM
        const allContainers = document.querySelectorAll('.widget-container[data-widget-id]');
        vscodeLog(`[WidgetRenderer] All widget containers in DOM (${allContainers.length}):`);
        allContainers.forEach((c, i) => {
          const id = c.getAttribute('data-widget-id');
          const type = c.getAttribute('data-widget-type');
          vscodeLog(`  [${i}] type=${type}, id=${id}`);
        });
      }
      
      // Fallback: try to find from event target (for events dispatched on element)
      if (!widgetContainer) {
        const target = e.target as Node;
        if (target && target !== document && target instanceof HTMLElement) {
          widgetContainer = target.closest?.('.widget-container');
        }
      }
      
      // CRITICAL: Do NOT fallback to finding any widget container!
      // This was causing data from one widget to be applied to all widgets of the same type.
      // If we can't find the specific widget container, abort the update.
      if (!widgetContainer) {
        vscodeLogError(`[WidgetRenderer] Could not find widget container for widgetId: ${widgetId}. Aborting update to prevent cross-widget contamination.`);
        return;
      }
      
      // DEBUG: Log this widget-update event
      console.log(`[WidgetRenderer] handleWidgetUpdate - Event received:`, {
        eventWidgetId: widgetId,
        foundContainerId: widgetContainer.getAttribute('data-widget-id'),
        eventDataKeys: detail.data ? Object.keys(detail.data) : [],
        eventEventsCount: detail.data?.events?.length || 0
      });
      
      widgetId = widgetContainer.getAttribute('data-widget-id');
      const widgetType = widgetContainer.getAttribute('data-widget-type');
      
      if (!widgetId) return;
      
      // Build updated content from detail
      // CRITICAL: Ensure 'type' AND 'id' are included for proper identification
      const baseConfig = detail.config || {};
      
      // Check if there's a mismatch between event widgetId and config id
      if (baseConfig.id && baseConfig.id !== widgetId) {
        vscodeLog(`[WidgetRenderer] WARNING: ID mismatch! Event widgetId=${detail.widgetId}, DOM widgetId=${widgetId}, config.id=${baseConfig.id}. Using DOM ID.`);
      }
      
      const updatedConfig = { 
        type: widgetType, // Must include type for re-rendering
        ...baseConfig,
        id: widgetId, // CRITICAL: Put id LAST so DOM ID always wins over any stale config.id
      };
      const updatedData = detail.data || {};
      
      vscodeLog(`[WidgetRenderer] Config for serialization: type=${widgetType}, keys=${Object.keys(updatedConfig).join(',')}`);
      vscodeLog(`[WidgetRenderer] Config values: ${JSON.stringify(updatedConfig)}`);
      vscodeLog(`[WidgetRenderer] Data for serialization: keys=${Object.keys(updatedData).join(',')}`);
      
      // Generate new code block content
      const newContent = this.serializeWidgetContent(updatedConfig, updatedData);
      
      vscodeLog(`[WidgetRenderer] Raw newContent from serialize: "${newContent.substring(0, 200)}"`);
      
      // SAFETY: Aggressively strip any fences from content - they should NEVER be in the serialized content
      // Use a simple approach: split by lines, filter out fence lines, rejoin
      const lines = newContent.split('\n');
      const cleanLines = lines.filter(line => {
        const trimmed = line.trim();
        // Remove any line that is just a fence (with or without language)
        if (trimmed.match(/^```\w*$/)) {
          vscodeLog(`[WidgetRenderer] Stripping fence line: "${line}"`);
          return false;
        }
        return true;
      });
      const cleanContent = cleanLines.join('\n').trim();
      
      vscodeLog(`[WidgetRenderer] Cleaned content: "${cleanContent.substring(0, 100)}..."`);
      
      // Find the code block element - try multiple strategies
      // The widget container is inside: .vditor-ir__node > pre.vditor-ir__preview > .widget-container
      // First try the stored reference from render time
      let codeBlockNode: Element | null = (widgetContainer as any).__codeBlockNode || null;
      
      if (!codeBlockNode) {
        // Try DOM traversal
        codeBlockNode = widgetContainer.closest('.vditor-ir__node') 
          || widgetContainer.closest('.vditor-wysiwyg__block')
          || widgetContainer.closest('pre');
      }
      
      // Debug: log the DOM path
      vscodeLog(`[WidgetRenderer] Widget container classes: ${widgetContainer.className}`);
      vscodeLog(`[WidgetRenderer] Widget container parent: ${widgetContainer.parentElement?.tagName}.${widgetContainer.parentElement?.className}`);
      vscodeLog(`[WidgetRenderer] Widget container grandparent: ${widgetContainer.parentElement?.parentElement?.tagName}.${widgetContainer.parentElement?.parentElement?.className}`);
      vscodeLog(`[WidgetRenderer] Stored codeBlockNode: ${(widgetContainer as any).__codeBlockNode ? 'yes' : 'no'}`);
      
      // If still not found, try going up from the container's parent (the pre element)
      if (!codeBlockNode) {
        // The container is inside: pre.vditor-ir__preview > div.widget-container
        // And pre.vditor-ir__preview is inside .vditor-ir__node
        const preElement = widgetContainer.parentElement;
        if (preElement && preElement.tagName === 'PRE') {
          codeBlockNode = preElement.closest('.vditor-ir__node') || preElement.parentElement;
        }
      }
      
      // Get vditor instance from window if context doesn't have it
      const vditorInstance = context.vditor || (window as any).vditor;
      
      if (codeBlockNode && vditorInstance) {
        this.updateCodeBlock(codeBlockNode as HTMLElement, cleanContent, vditorInstance);
        vscodeLog(`[WidgetRenderer] Updated ${widgetType} widget content in code block`);
      } else {
        vscodeLogError(`[WidgetRenderer] Could not find code block node for update. codeBlockNode=${!!codeBlockNode}, vditor=${!!vditorInstance}`);
      }
    };
    
    // Listen at document level for bubbled events
    document.addEventListener('widget-update', handleWidgetUpdate);
    
    // Store for cleanup
    (window as any).__widgetUpdateHandler = handleWidgetUpdate;
    vscodeLog('[WidgetRenderer] Registered global widget-update handler');
    
    // Setup listener for timer-completed events (for VS Code notifications)
    // CRITICAL: Only add ONE handler globally - check if already registered
    if (!(window as any).__timerCompletedHandler) {
      const handleTimerCompleted = (e: Event) => {
        const customEvent = e as CustomEvent;
        const detail = customEvent.detail;
        
        if (!detail) return;
        
        vscodeLog(`[WidgetRenderer] Timer completed: ${detail.title}`);
        
        // Send notification to VS Code via postMessage
        if ((window as any).vscode && typeof (window as any).vscode.postMessage === 'function') {
          (window as any).vscode.postMessage({
            command: 'widget-notification',
            type: 'timer-completed',
            title: detail.title || 'Timer',
            message: `⏱️ ${detail.title || 'Timer'} has completed!`,
            widgetId: detail.widgetId,
          });
          vscodeLog('[WidgetRenderer] Sent timer-completed notification to VS Code');
        } else {
          vscodeLogError('[WidgetRenderer] window.vscode not available for timer notification');
        }
      };
      
      document.addEventListener('timer-completed', handleTimerCompleted);
      (window as any).__timerCompletedHandler = handleTimerCompleted;
      vscodeLog('[WidgetRenderer] Registered global timer-completed handler');
    } else {
      vscodeLog('[WidgetRenderer] timer-completed handler already registered, skipping');
    }
    
    // Setup listener for alarm-triggered events (for VS Code notifications)
    // CRITICAL: Only add ONE handler globally - check if already registered
    if (!(window as any).__alarmTriggeredHandler) {
      const handleAlarmTriggered = (e: Event) => {
        const customEvent = e as CustomEvent;
        const detail = customEvent.detail;
        
        if (!detail) return;
        
        vscodeLog(`[WidgetRenderer] Alarm triggered: ${detail.label} at ${detail.time}`);
        
        // Send notification to VS Code via postMessage
        if ((window as any).vscode && typeof (window as any).vscode.postMessage === 'function') {
          (window as any).vscode.postMessage({
            command: 'widget-notification',
            type: 'alarm-triggered',
            title: detail.title || 'Alarms',
            label: detail.label || 'Alarm',
            time: detail.time,
            message: `🔔 ${detail.label || 'Alarm'} - ${detail.time}`,
            widgetId: detail.widgetId,
            alarmId: detail.alarmId,
          });
          vscodeLog('[WidgetRenderer] Sent alarm-triggered notification to VS Code');
        } else {
          vscodeLogError('[WidgetRenderer] window.vscode not available for alarm notification');
        }
      };
      
      document.addEventListener('alarm-triggered', handleAlarmTriggered);
      (window as any).__alarmTriggeredHandler = handleAlarmTriggered;
      vscodeLog('[WidgetRenderer] Registered global alarm-triggered handler');
    } else {
      vscodeLog('[WidgetRenderer] alarm-triggered handler already registered, skipping');
    }
    
    // Setup listener for button-action events (for VS Code commands and widget actions)
    // CRITICAL: Only add ONE handler globally - check if already registered
    if (!(window as any).__buttonActionHandler) {
      const handleButtonAction = (e: Event) => {
        const customEvent = e as CustomEvent;
        const detail = customEvent.detail;
        
        if (!detail) return;
        
        vscodeLog(`[WidgetRenderer] Button action: ${detail.action} (${detail.actionType})`);
        
        // Send action to VS Code via postMessage
        if ((window as any).vscode && typeof (window as any).vscode.postMessage === 'function') {
          (window as any).vscode.postMessage({
            command: 'widget-action',
            actionType: detail.actionType,
            action: detail.action,
            value: detail.value,
            data: detail.data,
            targetWidget: detail.targetWidget,
            widgetId: detail.widgetId,
            timestamp: detail.timestamp,
          });
          vscodeLog(`[WidgetRenderer] Sent button action to VS Code: ${detail.action}`);
        } else {
          vscodeLogError('[WidgetRenderer] window.vscode not available for button action');
        }
      };
      
      document.addEventListener('button-action', handleButtonAction);
      (window as any).__buttonActionHandler = handleButtonAction;
      vscodeLog('[WidgetRenderer] Registered global button-action handler');
    } else {
      vscodeLog('[WidgetRenderer] button-action handler already registered, skipping');
    }
  }
  
  /**
   * Serialize widget config and data back to code block format
   */
  private serializeWidgetContent(config: any, data: any): string {
    const lines: string[] = [];
    
    // Serialize config (YAML-like format)
    // CRITICAL: Persist widget ID first to ensure identity across re-renders
    for (const [key, value] of Object.entries(config)) {
      // Skip internal underscore-prefixed keys but KEEP the id
      if (key.startsWith('_')) continue;
      
      if (typeof value === 'object' && value !== null) {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      } else if (typeof value === 'boolean') {
        lines.push(`${key}: ${value}`);
      } else if (typeof value === 'number') {
        lines.push(`${key}: ${value}`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    
    // Add data section if present
    if (data && Object.keys(data).length > 0) {
      // Filter out internal keys
      const cleanData = { ...data };
      delete cleanData._config;
      
      if (Object.keys(cleanData).length > 0) {
        lines.push('---');
        lines.push(`data: ${JSON.stringify(cleanData)}`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Update the code block content in Vditor
   */
  private updateCodeBlock(codeBlockNode: HTMLElement, newContent: string, vditor: any): void {
    try {
      vscodeLog(`[WidgetRenderer] updateCodeBlock called with content length: ${newContent.length}`);
      vscodeLog(`[WidgetRenderer] Content preview: ${newContent.substring(0, 150)}...`);
      
      // In IR mode, the actual source code is in the hidden marker, not the visible preview
      // The structure is:
      // .vditor-ir__node
      //   .vditor-ir__marker--pre (hidden source - THIS is what we need to update)
      //     code (contains the full ```widget\n...\n``` text)
      //   pre.vditor-ir__preview (visible preview - now contains our widget container)
      
      let updated = false;
      
      // Find the marker code element - this is the source of truth
      // The marker contains the RAW markdown: ```widget\n...\n```
      const markerCode = codeBlockNode.querySelector('.vditor-ir__marker--pre code');
      if (markerCode) {
        // SIMPLE APPROACH: Always construct clean content with single fence pair
        // The newContent should be JUST the config lines (no fences)
        markerCode.textContent = newContent;
        vscodeLog('[WidgetRenderer] Updated marker with content: ' + newContent.substring(0, 150));
        updated = true;
      } else {
        // Fallback: try to find any code element with language-widget
        const codeEl = codeBlockNode.querySelector('code.language-widget, code[class*="language-widget"]');
        if (codeEl) {
          codeEl.textContent = newContent;
          vscodeLog('[WidgetRenderer] Updated code element (fallback)');
          updated = true;
        } else {
          vscodeLogError('[WidgetRenderer] Could not find code element to update');
        }
      }
      
      if (!updated) {
        return;
      }
      
      // CRITICAL: Trigger Vditor to recognize the change and sync to VS Code
      // Option 1: Use Vditor's getValue and send to VS Code directly
      if (vditor && typeof vditor.getValue === 'function') {
        const rawContent = vditor.getValue();
        
        // Use the global window.vscode that's set up in main.ts via utils.ts
        if ((window as any).vscode && typeof (window as any).vscode.postMessage === 'function') {
          (window as any).vscode.postMessage({ command: 'edit', content: rawContent });
          vscodeLog('[WidgetRenderer] Sent updated content to VS Code via window.vscode');
        } else {
          vscodeLogError('[WidgetRenderer] window.vscode not available for postMessage');
        }
      }
      
      // Also trigger Vditor's internal processing
      if (vditor && typeof vditor.ir?.processAfterRender === 'function') {
        vditor.ir.processAfterRender(vditor);
      }
      
    } catch (error) {
      vscodeLogError('[WidgetRenderer] Failed to update code block:', error);
    }
  }

  /**
   * Parse widget configuration from code block content
   */
  private parseWidgetConfig(content: string): { config: any; data: any } | null {
    try {
      // Split by --- separator (config above, data below)
      const parts = content.split(/\n---\s*\n/);
      
      // Parse config (YAML-like simple format)
      const configLines = parts[0].trim().split('\n');
      const config: any = { id: `widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
      
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
          } else if (value === 'true') {
            config[key] = true;
          } else if (value === 'false') {
            config[key] = false;
          } else if (!isNaN(Number(value)) && value !== '') {
            config[key] = Number(value);
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
            vscodeLogError('[WidgetRenderer] Failed to parse data:', error);
          }
        }
      }
      
      return { config, data };
    } catch (error) {
      vscodeLogError('[WidgetRenderer] Failed to parse widget block:', error);
      return null;
    }
  }

  /**
   * Render the widget
   */
  async render(element: HTMLElement, vditor: any, context: IRenderContext): Promise<void> {
    try {
      // CRITICAL: Check if element is still attached to DOM
      if (!element.parentElement) {
        return;
      }
      
      // The 'element' parameter from Vditor customRenders is typically:
      // - In IR mode: the <pre class="vditor-ir__preview"> element containing the code
      // - We should NOT replace the <pre> itself, but render INSIDE it
      
      // Skip if we're in the marker (hidden source) area
      const isInMarker = element.closest('.vditor-ir__marker--pre') || 
                         element.classList.contains('vditor-ir__marker--pre');
      if (isInMarker) {
        return;
      }
      
      // Check if already rendered - look for widget container
      const existingWidget = element.querySelector('.widget-container');
      if (existingWidget) {
        return;
      }
      
      // Also check if the element itself is marked as FULLY rendered (not pending)
      if (element.hasAttribute('data-widget-rendered')) {
        return;
      }
      
      // Clear the pending attribute from init.ts and set rendered
      element.removeAttribute('data-widget-pending');
      element.setAttribute('data-widget-rendered', 'true');

      // Ensure widget system is initialized
      initializeWidgetSystem();
      
      // Check if widget bundle is available
      if (!window.markdownWidgets) {
        this.showWidgetError(element, 'Widget system not available. Make sure the widget bundle is loaded.');
        return;
      }

      // Debug: log what's available
      vscodeLog('[WidgetRenderer] window.markdownWidgets keys: ' + Object.keys(window.markdownWidgets).join(', '));

      // Extract content from code element
      const content = this.extractCode(element);
      if (!content) {
        this.showWidgetError(element, 'Empty widget block');
        return;
      }

      // Parse configuration
      const parsed = this.parseWidgetConfig(content);
      if (!parsed) {
        this.showWidgetError(element, 'Failed to parse widget configuration');
        return;
      }

      const { config, data } = parsed;

      if (!config.type) {
        this.showWidgetError(element, 'Widget type not specified. Add "type: clock" (or calendar, weather, stock, productivity, chart, table, form)');
        return;
      }

      // Get widget registry - with safety check
      const { WidgetRegistry } = window.markdownWidgets;
      if (!WidgetRegistry) {
        this.showWidgetError(element, 'WidgetRegistry not found in widget bundle. Available: ' + Object.keys(window.markdownWidgets).join(', '));
        return;
      }
      
      const registry = WidgetRegistry.getInstance();

      // Create widget instance
      const widget = registry.create(config);
      
      if (!widget) {
        this.showWidgetError(element, `Unknown widget type: ${config.type}. Available: clock, calendar, weather, stock, productivity, chart, table, form`);
        return;
      }

      // Set widget data if provided
      if (data && typeof (widget as any).setData === 'function') {
        (widget as any).setData(data);
      }

      // Get Vditor node for event handling - do this BEFORE modifying DOM
      const ir__node = element.closest('.vditor-ir__node') as HTMLElement;
      const wysiwyg__node = element.closest('.vditor-wysiwyg__block') as HTMLElement;
      const containerNode = ir__node || wysiwyg__node;

      // Create container
      const container = document.createElement('div');
      container.className = 'widget-container';
      container.setAttribute('data-widget-type', config.type);
      container.setAttribute('data-widget-id', config.id);
      
      // Store reference to the code block node for later updates
      // The containerNode is the .vditor-ir__node that contains the marker with source code
      if (containerNode) {
        container.setAttribute('data-code-block-node-id', containerNode.id || '');
        // Store reference using a weak map approach
        (container as any).__codeBlockNode = containerNode;
      }
      
      container.style.cssText = `
        min-height: 200px;
        padding: 8px;
        border-radius: 4px;
        background: var(--vscode-editor-background, #1e1e1e);
        border: 1px solid var(--vscode-panel-border, #454545);
        margin: 8px 0;
        position: relative;
        overflow: visible;
      `;

      // Add widget to container first
      container.appendChild(widget);

      // Replace element content with the widget container
      // This is the same pattern as KanbanRenderer
      element.innerHTML = '';
      element.appendChild(container);
      
      // Setup event listeners AFTER adding to DOM
      // This ensures the container and its children are in the DOM tree
      if (containerNode) {
        this.setupVditorEventStoppers(container, containerNode);
      }
      
      // Also add event stoppers on the element itself (the pre tag)
      this.setupVditorEventStoppers(container, element);
      
      // Track active widget
      this.activeWidgets.set(config.id, {
        element: container,
        cleanup: () => {
          // Widget cleanup
          container.remove();
        }
      });

      vscodeLog(`[WidgetRenderer] Rendered ${config.type} widget: ${config.id}`);
    } catch (error) {
      vscodeLogError('[WidgetRenderer] Render failed:', error);
      this.showWidgetError(element, `Failed to render widget: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Show widget error message
   */
  private showWidgetError(element: HTMLElement, message: string): void {
    element.innerHTML = `
      <div class="widget-error" style="
        padding: 16px;
        border: 2px solid var(--vscode-errorForeground, #f48771);
        border-radius: 4px;
        background: var(--vscode-inputValidation-errorBackground, rgba(244, 135, 113, 0.1));
        color: var(--vscode-errorForeground, #f48771);
        font-family: var(--vscode-font-family);
        margin: 8px 0;
      ">
        <strong>⚠️ Widget Error</strong><br>
        ${message}
      </div>
    `;
  }

  /**
   * Setup event stoppers to prevent Vditor from interfering with widget
   * 
   * CRITICAL: We must NOT block events INSIDE the widget - only prevent them from
   * bubbling UP to Vditor. Events must flow normally within the widget for interactivity.
   * 
   * Strategy: Add listeners on the PARENT node (not the container) to stop propagation
   * AFTER the widget has processed the event.
   */
  private setupVditorEventStoppers(container: HTMLElement, node: HTMLElement): void {
    if (!node) {
      return;
    }

    // Helper: check if an element is an interactive form element where
    // the browser's default key handling (backspace, arrows, etc.) must work
    const isInteractiveFormElement = (el: EventTarget | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      // Also check role="textbox" or similar ARIA roles used by custom inputs
      const role = el.getAttribute('role');
      if (role === 'textbox' || role === 'spinbutton') return true;
      return false;
    };

    // Stop events from bubbling to Vditor AFTER they've been processed by the widget
    // Use bubble phase (capture: false) so widget handlers run first
    const stopBubblingToVditor = (e: Event) => {
      // Only stop if event originates from within the widget container
      if (!container.contains(e.target as Node)) {
        return;
      }
      
      // Stop propagation to prevent Vditor from seeing this event
      // But do NOT call stopImmediatePropagation - that would block other handlers at same level
      e.stopPropagation();
      
      // For keyboard events, prevent Vditor's default handling
      if (e instanceof KeyboardEvent) {
        const key = e.key.toLowerCase();
        const hasModifier = e.ctrlKey || e.metaKey;
        const targetIsFormElement = isInteractiveFormElement(e.target);
        
        // Navigation/editing keys — only preventDefault when the target is NOT
        // an interactive form element. Inside inputs/textareas the browser must
        // handle backspace, delete, arrows, etc. natively.
        const navigationKeys = ['Enter', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'];
        if (navigationKeys.includes(e.key) && !targetIsFormElement) {
          e.preventDefault();
        }
        
        // Prevent Ctrl/Cmd shortcuts that Vditor might intercept
        // These are common shortcuts that should work within widgets (copy, paste, cut, undo, redo, select all)
        if (hasModifier) {
          const widgetShortcuts = ['c', 'v', 'x', 'a', 'z', 'y'];
          if (widgetShortcuts.includes(key)) {
            // Don't preventDefault - let the browser handle copy/paste/etc naturally
            // But DO stop propagation so Vditor doesn't intercept
            e.stopPropagation();
          }
        }
      }
    };

    // Events that need to be stopped from reaching Vditor
    const eventsToBlock = [
      'click', 'dblclick', 'mousedown', 'mouseup',
      'keydown', 'keypress', 'keyup',
      'beforeinput', 'input',
      'focus', 'focusin', 'focusout', 'blur',
      'change', 'submit',
      'copy', 'cut', 'paste'  // Clipboard events
    ];

    // Add listeners on the NODE (parent of container) in BUBBLE phase
    // This lets events flow through the widget first, then we stop them
    eventsToBlock.forEach(eventName => {
      node.addEventListener(eventName, stopBubblingToVditor, { capture: false });
    });

    // CRITICAL: Also add CAPTURE-phase listeners on the container itself.
    // Vditor registers capture-phase handlers on ancestor elements (the contentEditable div)
    // that intercept keydown/input events before our bubble-phase handlers run.
    // For interactive form elements (input, textarea, select), we must stop propagation
    // in the capture phase so Vditor never sees these events.
    const stopInCapture = (e: Event) => {
      if (!isInteractiveFormElement(e.target)) return;
      // Stop the event from reaching Vditor's capture-phase handlers on ancestors
      e.stopPropagation();
    };
    const captureEvents = [
      'keydown', 'keypress', 'keyup',
      'beforeinput', 'input',
    ];
    captureEvents.forEach(eventName => {
      container.addEventListener(eventName, stopInCapture, { capture: true });
    });
    
    // Mark container as interactive to help with debugging
    container.setAttribute('data-widget-interactive', 'true');
  }

  /**
   * Clean up widget on destroy
   */
  async onDestroy(context: IRenderContext): Promise<void> {
    // Clean up all active widgets
    this.activeWidgets.forEach(({ cleanup }) => cleanup());
    this.activeWidgets.clear();
    
    // Remove global event listener for widget updates
    const handler = (window as any).__widgetUpdateHandler;
    if (handler) {
      document.removeEventListener('widget-update', handler);
      delete (window as any).__widgetUpdateHandler;
    }
    
    // Remove timer-completed event listener
    const timerHandler = (window as any).__timerCompletedHandler;
    if (timerHandler) {
      document.removeEventListener('timer-completed', timerHandler);
      delete (window as any).__timerCompletedHandler;
    }
    
    // Remove alarm-triggered event listener
    const alarmHandler = (window as any).__alarmTriggeredHandler;
    if (alarmHandler) {
      document.removeEventListener('alarm-triggered', alarmHandler);
      delete (window as any).__alarmTriggeredHandler;
    }
    
    // Remove button-action event listener
    const buttonHandler = (window as any).__buttonActionHandler;
    if (buttonHandler) {
      document.removeEventListener('button-action', buttonHandler);
      delete (window as any).__buttonActionHandler;
    }
  }

  /**
   * Extract code content from element
   */
  extractCode(element: HTMLElement): string {
    // Check if element has textContent directly
    if (element.textContent) {
      return element.textContent.trim();
    }

    // Find code element inside
    const codeEl = element.querySelector('code');
    if (codeEl) {
      return codeEl.textContent?.trim() || '';
    }

    return '';
  }

  /**
   * Extract widget ID from element (not used - widgets don't persist to external files)
   */
  extractId(element: HTMLElement): string {
    return 'default';
  }
}
