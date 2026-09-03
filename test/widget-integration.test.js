/**
 * Widget Integration Tests
 * 
 * Tests for widget block parsing and configuration extraction
 */

import assert from 'assert';
import { test } from 'vitest';

// Copy of parseWidgetBlocks from widget-integration.ts for testing
function parseWidgetBlocks(markdown) {
  const widgetBlockRegex = /```widget\s*\n([\s\S]*?)```/g;
  const widgets = [];

  let match;
  while ((match = widgetBlockRegex.exec(markdown)) !== null) {
    const content = match[1];
    const fullText = match[0];
    
    // Split by --- separator (config above, data below)
    const parts = content.split(/\n---\s*\n/);
    
    try {
      // Parse config (YAML-like simple format)
      const configLines = parts[0].trim().split('\n');
      const config = { id: `widget-${Date.now()}-${Math.random()}` };
      
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
            // Invalid JSON, ignore
          }
        }
      }
      
      widgets.push({ fullText, config, data });
    } catch (error) {
      // Failed to parse, skip
    }
  }
  
  return widgets;
}

// Test: Parse simple widget block
function testParseSimpleWidget() {
  const markdown = `# My Document

\`\`\`widget
type: chart
title: Sales Chart
\`\`\`

Some more content.
`;

  const widgets = parseWidgetBlocks(markdown);
  
  assert.strictEqual(widgets.length, 1, 'Should find one widget');
  assert.strictEqual(widgets[0].config.type, 'chart', 'Widget type should be chart');
  assert.strictEqual(widgets[0].config.title, 'Sales Chart', 'Widget title should match');
  assert.strictEqual(widgets[0].data, null, 'Data should be null when not provided');
  
  console.log('✅ testParseSimpleWidget passed');
}

// Test: Parse widget with data
function testParseWidgetWithData() {
  const markdown = `\`\`\`widget
type: table
title: My Table
---
data: [{"id": 1, "name": "Item 1"}, {"id": 2, "name": "Item 2"}]
\`\`\``;

  const widgets = parseWidgetBlocks(markdown);
  
  assert.strictEqual(widgets.length, 1, 'Should find one widget');
  assert.strictEqual(widgets[0].config.type, 'table', 'Widget type should be table');
  assert(Array.isArray(widgets[0].data), 'Data should be an array');
  assert.strictEqual(widgets[0].data.length, 2, 'Data should have 2 items');
  assert.strictEqual(widgets[0].data[0].name, 'Item 1', 'First item name should match');
  
  console.log('✅ testParseWidgetWithData passed');
}

// Test: Parse widget with nested JSON config
function testParseWidgetWithNestedConfig() {
  const markdown = `\`\`\`widget
type: chart
title: Complex Chart
chartType: bar
options: {"responsive": true, "plugins": {"legend": {"display": true}}}
\`\`\``;

  const widgets = parseWidgetBlocks(markdown);
  
  assert.strictEqual(widgets.length, 1, 'Should find one widget');
  assert.strictEqual(widgets[0].config.chartType, 'bar', 'Chart type should be bar');
  assert.strictEqual(typeof widgets[0].config.options, 'object', 'Options should be an object');
  assert.strictEqual(widgets[0].config.options.responsive, true, 'Responsive should be true');
  
  console.log('✅ testParseWidgetWithNestedConfig passed');
}

  // Test: Parse widget with array config values
  function testParseWidgetWithArrayConfig() {
    const markdown = `\`\`\`widget
  type: macro-board
  title: Macro Board
  rows: 2
  columns: 2
  buttons: [{"id":"commands","label":"Commands","icon":"bolt","command":"workbench.action.showCommands"},{"id":"daily-note","label":"Daily Note","icon":"calendar","command":"markdown-editor.openDailyNote"}]
  \`\`\``;

    const widgets = parseWidgetBlocks(markdown);

    assert.strictEqual(widgets.length, 1, 'Should find one widget');
    assert.strictEqual(widgets[0].config.type, 'macro-board', 'Widget type should be macro-board');
    assert(Array.isArray(widgets[0].config.buttons), 'Buttons should parse as an array');
    assert.strictEqual(widgets[0].config.buttons[0].label, 'Commands', 'First button label should match');

    console.log('✅ testParseWidgetWithArrayConfig passed');
  }

// Test: Parse multiple widgets
function testParseMultipleWidgets() {
  const markdown = `# Dashboard

\`\`\`widget
type: chart
title: Chart 1
\`\`\`

Some text between widgets.

\`\`\`widget
type: table
title: Table 1
\`\`\`

More content.

\`\`\`widget
type: kanban
title: Kanban 1
\`\`\`
`;

  const widgets = parseWidgetBlocks(markdown);
  
  assert.strictEqual(widgets.length, 3, 'Should find three widgets');
  assert.strictEqual(widgets[0].config.type, 'chart', 'First widget should be chart');
  assert.strictEqual(widgets[1].config.type, 'table', 'Second widget should be table');
  assert.strictEqual(widgets[2].config.type, 'kanban', 'Third widget should be kanban');
  
  console.log('✅ testParseMultipleWidgets passed');
}

// Test: Parse widget with complex data
function testParseWidgetWithComplexData() {
  const markdown = `\`\`\`widget
type: kanban
title: Project Board
---
data: {
  "columns": [
    {"id": "todo", "title": "To Do", "cards": [{"id": "card-1", "title": "Task 1"}]},
    {"id": "done", "title": "Done", "cards": []}
  ]
}
\`\`\``;

  const widgets = parseWidgetBlocks(markdown);
  
  assert.strictEqual(widgets.length, 1, 'Should find one widget');
  assert.strictEqual(widgets[0].config.type, 'kanban', 'Widget type should be kanban');
  assert(widgets[0].data.columns, 'Data should have columns');
  assert.strictEqual(widgets[0].data.columns.length, 2, 'Should have 2 columns');
  assert.strictEqual(widgets[0].data.columns[0].cards[0].title, 'Task 1', 'Card title should match');
  
  console.log('✅ testParseWidgetWithComplexData passed');
}

// Test: Handle invalid JSON gracefully
function testHandleInvalidJson() {
  const markdown = `\`\`\`widget
type: chart
options: {invalid json here}
---
data: [this is not valid json]
\`\`\``;

  const widgets = parseWidgetBlocks(markdown);
  
  assert.strictEqual(widgets.length, 1, 'Should still find the widget');
  assert.strictEqual(widgets[0].config.type, 'chart', 'Type should be parsed');
  assert.strictEqual(widgets[0].config.options, '{invalid json here}', 'Invalid JSON should be kept as string');
  assert.strictEqual(widgets[0].data, null, 'Invalid data should be null');
  
  console.log('✅ testHandleInvalidJson passed');
}

// Test: No widgets in document
function testNoWidgets() {
  const markdown = `# Just a normal document

This has no widget blocks.

\`\`\`javascript
console.log('This is just code');
\`\`\`
`;

  const widgets = parseWidgetBlocks(markdown);
  
  assert.strictEqual(widgets.length, 0, 'Should find no widgets');
  
  console.log('✅ testNoWidgets passed');
}

// Test: Widget with empty config
function testWidgetEmptyConfig() {
  const markdown = `\`\`\`widget

\`\`\``;

  const widgets = parseWidgetBlocks(markdown);
  
  assert.strictEqual(widgets.length, 1, 'Should find one widget');
  assert(widgets[0].config.id, 'Should have generated ID');
  
  console.log('✅ testWidgetEmptyConfig passed');
}

test('parse simple widget', testParseSimpleWidget);
test('parse widget with data', testParseWidgetWithData);
test('parse widget with nested config', testParseWidgetWithNestedConfig);
test('parse widget with array config', testParseWidgetWithArrayConfig);
test('parse multiple widgets', testParseMultipleWidgets);
test('parse widget with complex data', testParseWidgetWithComplexData);
test('handle invalid json', testHandleInvalidJson);
test('no widgets', testNoWidgets);
test('widget empty config', testWidgetEmptyConfig);
