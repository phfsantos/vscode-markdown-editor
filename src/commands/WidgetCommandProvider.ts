/**
 * WidgetCommandProvider - Provides commands for inserting widgets into markdown
 */

import * as vscode from 'vscode';
import { logger } from '../utils/Logger';
import { EditorPanel } from '../app/EditorPanel';

export interface WidgetTemplate {
  type: string;
  displayName: string;
  description: string;
  icon: string;
  defaultConfig: any;
  sampleData?: any;
}

export class WidgetCommandProvider {
  private static templates: WidgetTemplate[] = [
    // Time widgets
    {
      type: 'clock',
      displayName: 'Clock',
      description: 'Digital clock with customizable format',
      icon: '🕐',
      defaultConfig: {
        title: 'Current Time',
        format: '12h',
        showSeconds: true,
        showDate: true
      }
    },
    {
      type: 'calendar',
      displayName: 'Calendar',
      description: 'Simple date display',
      icon: '📅',
      defaultConfig: {
        title: 'Today',
        showYear: true
      }
    },
    // Info widgets
    {
      type: 'weather',
      displayName: 'Weather',
      description: 'Weather display with temperature and conditions',
      icon: '🌤️',
      defaultConfig: {
        title: 'Weather'
      },
      sampleData: {
        temperature: 72,
        condition: 'sunny',
        location: 'San Francisco',
        humidity: 65,
        windSpeed: 12
      }
    },
    {
      type: 'stock',
      displayName: 'Stock',
      description: 'Stock ticker with price and change',
      icon: '📈',
      defaultConfig: {
        title: 'Stock'
      },
      sampleData: {
        symbol: 'MSFT',
        company: 'Microsoft',
        price: 450.25,
        change: 5.50,
        changePercent: 1.24
      }
    },
    {
      type: 'productivity',
      displayName: 'Tasks',
      description: 'Simple task list for productivity',
      icon: '✅',
      defaultConfig: {
        title: 'Tasks'
      },
      sampleData: {
        tasks: [
          { id: '1', text: 'Review pull requests', completed: true },
          { id: '2', text: 'Update documentation', completed: false },
          { id: '3', text: 'Deploy to staging', completed: false }
        ]
      }
    },
    {
      type: 'macro-board',
      displayName: 'Macro Board',
      description: 'Stream Deck style grid for launching commands and macros',
      icon: '🎛️',
      defaultConfig: {
        title: 'Macro Board',
        size: 'md',
        rows: 3,
        columns: 3,
        buttons: [
          { id: 'commands', label: 'Commands', icon: 'bolt', command: 'workbench.action.showCommands', tone: 'danger' },
          { id: 'daily-note', label: 'Daily Note', icon: 'calendar', command: 'markdown-editor.openDailyNote' },
          { id: 'quick-open', label: 'Quick Open', icon: 'search', command: 'workbench.action.quickOpen' },
          { id: 'sidebar', label: 'Sidebar', icon: 'layers', command: 'workbench.action.toggleSidebarVisibility' },
          { id: 'graph', label: 'Graph View', icon: 'sparkles', command: 'markdown-editor.openGraphView', tone: 'success' },
          { id: 'notes', label: 'Open Note', icon: 'chat', command: 'markdown-editor.quickOpenNote' },
          { id: 'terminal', label: 'Terminal', icon: 'code', command: 'workbench.action.terminal.toggleTerminal' },
          { id: 'settings', label: 'Settings', icon: 'sliders', command: 'workbench.action.openSettings' },
          { id: 'save-all', label: 'Save All', icon: 'camera', command: 'workbench.action.files.saveAll' }
        ]
      },
      sampleData: {
        executionCounts: {}
      }
    },
    // Data widgets
    {
      type: 'chart',
      displayName: 'Chart',
      description: 'Interactive data visualization',
      icon: '📊',
      defaultConfig: {
        title: 'My Chart',
        chartType: 'bar'
      },
      sampleData: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
        datasets: [{
          label: 'Sales',
          data: [12, 19, 3, 5, 2]
        }]
      }
    },
    {
      type: 'table',
      displayName: 'Table',
      description: 'Sortable and filterable data table',
      icon: '📋',
      defaultConfig: {
        title: 'My Table',
        enableSort: true,
        enableFilter: true,
        enablePagination: true
      },
      sampleData: [
        { id: 1, name: 'Item 1', status: 'active', value: 100 },
        { id: 2, name: 'Item 2', status: 'pending', value: 200 },
        { id: 3, name: 'Item 3', status: 'completed', value: 150 }
      ]
    },
    {
      type: 'form',
      displayName: 'Form',
      description: 'Dynamic form with validation',
      icon: '📝',
      defaultConfig: {
        title: 'My Form',
        submitLabel: 'Submit'
      },
      sampleData: {
        fields: [
          {
            name: 'name',
            label: 'Name',
            type: 'text',
            required: true,
            placeholder: 'Enter your name'
          },
          {
            name: 'email',
            label: 'Email',
            type: 'email',
            required: true,
            validation: {
              pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$'
            }
          }
        ]
      }
    }
  ];

  /**
   * Register widget commands
   */
  static register(context: vscode.ExtensionContext) {
    // Command to show widget picker
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'markdown-editor.insertWidget',
        () => this.showWidgetPicker()
      )
    );

    // Individual widget commands
    this.templates.forEach(template => {
      context.subscriptions.push(
        vscode.commands.registerCommand(
          `markdown-editor.insert${template.type}Widget`,
          () => this.insertWidget(template)
        )
      );
    });

    logger.info(`Registered ${this.templates.length} widget commands`);
  }

  /**
   * Show widget picker quick pick
   */
  private static async showWidgetPicker() {
    const items = this.templates.map(template => ({
      label: `${template.icon} ${template.displayName}`,
      description: template.description,
      template
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a widget type to insert',
      matchOnDescription: true
    });

    if (selected) {
      await this.insertWidget(selected.template);
    }
  }

  /**
   * Insert widget markdown block at cursor
   */
  private static async insertWidget(template: WidgetTemplate) {
    // Generate widget block
    const widgetBlock = this.generateWidgetBlock(template);

    // Try to insert into custom editor (EditorPanel) first
    const currentPanel = EditorPanel.currentPanel;
    if (currentPanel) {
      // Send message to webview to insert widget
      currentPanel.postMessage({
        command: 'insertWidget',
        widgetBlock
      });
      logger.info(`Inserted ${template.type} widget via custom editor`);
      return;
    }

    // Fall back to text editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor found');
      return;
    }

    // Check if editor is markdown
    if (editor.document.languageId !== 'markdown') {
      vscode.window.showWarningMessage('Widgets can only be inserted in markdown files');
      return;
    }

    // Insert at cursor position
    const position = editor.selection.active;
    await editor.edit(editBuilder => {
      editBuilder.insert(position, widgetBlock);
    });

    logger.info(`Inserted ${template.type} widget via text editor`);
  }

  /**
   * Generate widget markdown block
   */
  private static generateWidgetBlock(template: WidgetTemplate): string {
    const config = {
      type: template.type,
      ...template.defaultConfig
    };

    // Build config lines
    const configLines = Object.entries(config)
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `${key}: ${JSON.stringify(value)}`;
        }
        return `${key}: ${value}`;
      })
      .join('\n');

    // Build data section if sample data exists
    const dataSection = template.sampleData
      ? `\n---\ndata: ${JSON.stringify(template.sampleData, null, 2)}`
      : '';

    return `\n\`\`\`widget\n${configLines}${dataSection}\n\`\`\`\n\n`;
  }

  /**
   * Get all widget templates
   */
  static getTemplates(): WidgetTemplate[] {
    return this.templates;
  }

  /**
   * Add a custom widget template
   */
  static addTemplate(template: WidgetTemplate) {
    this.templates.push(template);
  }
}
