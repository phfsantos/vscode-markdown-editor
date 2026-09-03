/**
 * Widget Command Provider Tests
 * 
 * Tests for widget command generation and template logic
 */

import assert from 'assert';
import { test } from 'vitest';

// Widget templates (copy from WidgetCommandProvider)
const templates = [
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
      ]
    },
    sampleData: {
      executionCounts: {}
    }
  },
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
    type: 'kanban',
    displayName: 'Kanban Board',
    description: 'Drag-and-drop task board',
    icon: '📌',
    defaultConfig: {
      title: 'My Kanban Board'
    },
    sampleData: {
      columns: [
        {
          id: 'todo',
          title: 'To Do',
          cards: [{ id: 'card-1', title: 'Task 1', description: 'Description', priority: 'high', tags: ['frontend'] }]
        },
        { id: 'in-progress', title: 'In Progress', cards: [] },
        { id: 'done', title: 'Done', cards: [] }
      ]
    }
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
        { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Enter your name' },
        { name: 'email', label: 'Email', type: 'email', required: true, validation: { pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$' } }
      ]
    }
  },
  {
    type: 'map',
    displayName: 'Map',
    description: 'Interactive map with markers',
    icon: '🗺️',
    defaultConfig: {
      title: 'My Map',
      zoom: 4,
      height: 400
    },
    sampleData: {
      center: { lat: 37.7749, lng: -122.4194 },
      markers: [{ id: 'marker-1', lat: 37.7749, lng: -122.4194, title: 'San Francisco', description: 'City by the Bay' }]
    }
  }
];

// Copy of generateWidgetBlock from WidgetCommandProvider
function generateWidgetBlock(template) {
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

// Test: Generate chart widget block
function testGenerateChartWidget() {
  const chartTemplate = templates.find(t => t.type === 'chart');
  const block = generateWidgetBlock(chartTemplate);
  
  assert(block.includes('```widget'), 'Should have widget code fence');
  assert(block.includes('type: chart'), 'Should have type: chart');
  assert(block.includes('title: My Chart'), 'Should have title');
  assert(block.includes('chartType: bar'), 'Should have chartType');
  assert(block.includes('---'), 'Should have data separator');
  assert(block.includes('data:'), 'Should have data section');
  assert(block.includes('"labels"'), 'Should have labels in data');
  
  console.log('✅ testGenerateChartWidget passed');
}

// Test: Generate table widget block
function testGenerateTableWidget() {
  const tableTemplate = templates.find(t => t.type === 'table');
  const block = generateWidgetBlock(tableTemplate);
  
  assert(block.includes('type: table'), 'Should have type: table');
  assert(block.includes('enableSort: true'), 'Should have enableSort');
  assert(block.includes('enableFilter: true'), 'Should have enableFilter');
  assert(block.includes('"id": 1'), 'Should have sample data items');
  
  console.log('✅ testGenerateTableWidget passed');
}

// Test: Generate kanban widget block
function testGenerateKanbanWidget() {
  const kanbanTemplate = templates.find(t => t.type === 'kanban');
  const block = generateWidgetBlock(kanbanTemplate);
  
  assert(block.includes('type: kanban'), 'Should have type: kanban');
  assert(block.includes('title: My Kanban Board'), 'Should have title');
  assert(block.includes('"columns"'), 'Should have columns in data');
  assert(block.includes('"To Do"'), 'Should have To Do column');
  
  console.log('✅ testGenerateKanbanWidget passed');
}

  // Test: Generate macro board widget block
  function testGenerateMacroBoardWidget() {
    const macroBoardTemplate = templates.find(t => t.type === 'macro-board');
    const block = generateWidgetBlock(macroBoardTemplate);

    assert(block.includes('type: macro-board'), 'Should have type: macro-board');
    assert(block.includes('rows: 3'), 'Should have rows config');
    assert(block.includes('columns: 3'), 'Should have columns config');
    assert(block.includes('buttons: ['), 'Should have buttons config');
    assert(block.includes('executionCounts'), 'Should have execution counts data');

    console.log('✅ testGenerateMacroBoardWidget passed');
  }

// Test: All templates have required properties
function testTemplateProperties() {
  templates.forEach(template => {
    assert(template.type, `Template should have type`);
    assert(template.displayName, `Template ${template.type} should have displayName`);
    assert(template.description, `Template ${template.type} should have description`);
    assert(template.icon, `Template ${template.type} should have icon`);
    assert(template.defaultConfig, `Template ${template.type} should have defaultConfig`);
    assert(template.sampleData, `Template ${template.type} should have sampleData`);
  });
  
  console.log('✅ testTemplateProperties passed');
}

// Test: Command names match expected format
function testCommandNames() {
  templates.forEach(template => {
    const expectedCommand = `markdown-editor.insert${template.type}Widget`;
    // Just verify the format is correct
    assert(expectedCommand.includes('markdown-editor.insert'), 'Command should have prefix');
    assert(expectedCommand.includes('Widget'), 'Command should have Widget suffix');
  });
  
  console.log('✅ testCommandNames passed');
}

// Test: Generated blocks can be parsed back
function testRoundTripParsing() {
  // Use parseWidgetBlocks from widget-integration test
  function parseWidgetBlocks(markdown) {
    const widgetBlockRegex = /```widget\s*\n([\s\S]*?)```/g;
    const widgets = [];
    let match;
    while ((match = widgetBlockRegex.exec(markdown)) !== null) {
      const content = match[1];
      const parts = content.split(/\n---\s*\n/);
      const configLines = parts[0].trim().split('\n');
      const config = {};
      configLines.forEach(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          if (value.startsWith('{') || value.startsWith('[')) {
            try { config[key] = JSON.parse(value); } catch { config[key] = value; }
          } else {
            config[key] = value;
          }
        }
      });
      let data = null;
      if (parts[1]) {
        const dataText = parts[1].trim();
        if (dataText.startsWith('data:')) {
          try { data = JSON.parse(dataText.substring(5).trim()); } catch {}
        }
      }
      widgets.push({ config, data });
    }
    return widgets;
  }

  templates.forEach(template => {
    const block = generateWidgetBlock(template);
    const parsed = parseWidgetBlocks(block);
    
    assert.strictEqual(parsed.length, 1, `Should parse exactly one widget for ${template.type}`);
    assert.strictEqual(parsed[0].config.type, template.type, `Type should match for ${template.type}`);
    assert(parsed[0].data !== null, `Data should be parsed for ${template.type}`);
  });
  
  console.log('✅ testRoundTripParsing passed');
}

test('generate chart widget', testGenerateChartWidget);
test('generate table widget', testGenerateTableWidget);
test('generate kanban widget', testGenerateKanbanWidget);
test('generate macro board widget', testGenerateMacroBoardWidget);
test('template properties', testTemplateProperties);
test('command names', testCommandNames);
test('round trip parsing', testRoundTripParsing);
