# Widget System Implementation Plan

**Project**: VSCode Markdown Editor - Interactive Widget System  
**Version**: 1.0.0  
**Date**: November 21, 2025  
**Status**: Planning  
**Owner**: @phfsantos

---

## Executive Summary

### Overview
Create a modular, extensible widget system that wraps [Wigggle UI](https://wigggle-ui.vercel.app/widgets/dashboard) React components as web components for use in the markdown editor. This system will enable developers to create interactive dashboards, data visualizations, and dynamic UI elements directly within markdown documents, similar to the existing KanbanRenderer but with broader capabilities.

### Goals
- Enable interactive widgets (charts, timers, counters, progress bars, stats) in markdown
- Support inter-widget communication and data sharing
- Integrate with VSCode API for notifications, commands, and file operations
- Provide declarative configuration UI for non-technical users
- Package independently for versioning and distribution
- Maintain security through sandboxing and proxying

### Success Metrics
- ✅ 5+ widget types implemented and functional
- ✅ Inter-widget communication working with visual editor
- ✅ VSCode API integration (notifications, commands, file access)
- ✅ < 100ms widget initialization time
- ✅ > 80% test coverage
- ✅ Complete documentation with examples
- ✅ NPM package published and integrated

---

## Background & Context

### Current State
The markdown editor currently supports:
- Custom code renderers via `BaseRenderer` abstract class
- KanbanRenderer as proof-of-concept for interactive components
- File persistence through `FileSystemHelper`
- Message passing between webview and extension host
- Vditor's `customRenders` API for code block rendering

### Problem Statement
While the kanban board demonstrates interactive rendering, users need:
1. **Variety**: Multiple widget types beyond kanban boards
2. **Connectivity**: Widgets that communicate and share data
3. **Flexibility**: Customizable widgets with configuration UI
4. **Integration**: Deep VSCode API integration (notifications, commands)
5. **Extensibility**: Easy creation of new widget types
6. **Security**: Safe execution of user scripts and API calls

### Related Work
- **Existing System**: KanbanRenderer pattern (`packages/media/src/renderers/builtin/KanbanRenderer.ts`)
- **Renderer Infrastructure**: RendererRegistry, MessageHandler, FileSystemHelper
- **Reference Library**: [Wigggle UI](https://github.com/wigggle-ui/ui) - React dashboard components
- **Technical Reference**: [React to Web Components](https://techblog.skeepers.io/create-a-web-component-from-a-react-component-bbe7c5f85ee6)

---

## Technical Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     VSCode Extension Host                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  EditorPanel.ts                                        │ │
│  │  - handleWidgetMessage()                               │ │
│  │  - handleWidgetApiCall() [API Proxy]                   │ │
│  │  - handleWidgetReadFile() [File Access]                │ │
│  │  - handleWidgetCommand() [VSCode Commands]             │ │
│  │  - handleWidgetNotification() [VSCode Notifications]   │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                 │
│                            │ Message Passing                 │
│                            ▼                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Webview (Vditor)                    │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  WidgetRenderer (BaseRenderer)                   │ │ │
│  │  │  - Parses ```widget-dashboard blocks             │ │ │
│  │  │  - Loads configuration JSON                      │ │ │
│  │  │  - Instantiates widgets                          │ │ │
│  │  │  - Manages settings UI                           │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  │                                                          │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  WidgetBus (Event System)                        │ │ │
│  │  │  - registerWidget()                              │ │ │
│  │  │  - publish() / subscribe()                       │ │ │
│  │  │  - createConnection()                            │ │ │
│  │  │  - getWidgetData() / setWidgetData()            │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  │                                                          │ │
│  │  ┌────────────────────┐  ┌────────────────────┐        │ │
│  │  │  ChartWidget       │  │  TimerWidget       │  ...   │ │
│  │  │  (Web Component)   │  │  (Web Component)   │        │ │
│  │  │                    │  │                    │        │ │
│  │  │  React Wrapper     │  │  React Wrapper     │        │ │
│  │  │  ↓                 │  │  ↓                 │        │ │
│  │  │  Wigggle UI Chart  │  │  Custom Timer UI   │        │ │
│  │  └────────────────────┘  └────────────────────┘        │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Standalone Widget Package                  │
│                  @phfsantos/markdown-widgets                 │
│                                                               │
│  packages/widgets/                                           │
│  ├── src/                                                    │
│  │   ├── core/          [BaseWidget, WidgetBus, etc.]       │
│  │   ├── widgets/       [Chart, Timer, Counter, etc.]       │
│  │   ├── settings/      [ConfigEditor, ConnectionEditor]    │
│  │   └── index.ts       [Public API]                        │
│  ├── dist/              [Bundled ESM + UMD]                 │
│  └── package.json                                            │
└─────────────────────────────────────────────────────────────┘
```

### Component Specifications

#### 1. BaseWidget Abstract Class
**Purpose**: Base class for all widget implementations  
**Location**: `packages/widgets/src/core/BaseWidget.ts`

```typescript
export abstract class BaseWidget extends HTMLElement {
  // Metadata
  abstract readonly widgetType: string;
  abstract readonly version: string;
  abstract readonly displayName: string;
  abstract readonly configSchema: any;
  
  // State
  protected config: IWidgetConfig;
  protected data: any;
  protected state: Map<string, any>;
  
  // Lifecycle
  abstract render(): void;
  onConfigChange?(newConfig: IWidgetConfig): void;
  onDataReceived?(data: any): void;
  onConnect?(): void;
  onDisconnect?(): void;
  
  // Communication
  protected emit(event: string, payload: any): void;
  protected subscribe(event: string, handler: Function): void;
  
  // Data & Integration
  protected fetchData(source: IDataSource): Promise<any>;
  protected saveData(data: any): Promise<void>;
  protected sendVSCodeMessage(command: string, payload: any): void;
  protected executeScript(script: string, context: any): any;
}
```

#### 2. WidgetBus (Communication System)
**Purpose**: Central event bus for inter-widget communication  
**Location**: `packages/widgets/src/core/WidgetBus.ts`

**Key Features**:
- Singleton pattern for global access
- Pub/sub event system
- Widget registration/discovery
- Connection management
- Data sharing between widgets

**API**:
```typescript
class WidgetBus {
  static getInstance(): WidgetBus;
  
  registerWidget(widget: BaseWidget): void;
  unregisterWidget(widgetId: string): void;
  
  publish(widgetId: string, event: string, payload: any): void;
  subscribe(widgetId: string, event: string, handler: Function): () => void;
  
  getWidgetData(widgetId: string): any;
  setWidgetData(widgetId: string, data: any): void;
  
  createConnection(connection: IWidgetConnection): void;
  removeConnection(connectionId: string): void;
}
```

#### 3. ThemeBridge
**Purpose**: CSS variable bridge for VSCode theme integration  
**Location**: `packages/widgets/src/core/ThemeBridge.ts`

**Implementation**:
```typescript
class ThemeBridge {
  static initialize(): void {
    // Inject VSCode theme colors as CSS custom properties
    const root = document.documentElement;
    const theme = this.getVSCodeTheme();
    
    root.style.setProperty('--widget-bg', theme.background);
    root.style.setProperty('--widget-fg', theme.foreground);
    // ... all theme colors
    
    // Listen for theme changes
    window.addEventListener('vscode-theme-changed', () => {
      this.updateTheme();
    });
  }
}
```

#### 4. DataProvider
**Purpose**: Abstraction for multiple data source types  
**Location**: `packages/widgets/src/core/DataProvider.ts`

**Supported Sources**:
- `static`: Inline JSON data
- `api`: HTTP/REST API calls (proxied through extension host)
- `file`: Read from workspace files
- `computed`: JavaScript expressions with context
- `widget`: Subscribe to another widget's data

#### 5. ScriptExecutor
**Purpose**: Sandboxed JavaScript execution for widget actions  
**Location**: `packages/widgets/src/core/ScriptExecutor.ts`

**Security**:
- Function() constructor for sandboxing
- Limited global scope (no window, document)
- Timeout enforcement
- Error isolation
- Explicit context passing

#### 6. Widget Types

**ChartWidget** - Data visualization
- Line, bar, pie, area charts
- Based on Wigggle UI or Recharts
- Click interactions emit events
- Real-time data updates

**StatWidget** - Single metric display
- Large numeric value
- Trend indicators (↑↓)
- Comparison display
- Color-coded states

**CounterWidget** - Numeric counter
- Increment/decrement buttons
- Min/max limits
- Step configuration
- Reset capability

**ProgressWidget** - Progress indicator
- Linear and circular variants
- Percentage or value display
- Status colors
- Animation options

**TimerWidget** - Time-based widget
- Countdown timer
- Stopwatch mode
- VSCode notifications on completion
- Play/pause/reset controls

---

## Data Models

### Widget Configuration
```typescript
interface IWidgetConfig {
  id: string;                          // Unique instance ID
  type: string;                        // Widget type identifier
  title?: string;                      // Display title
  size: 'sm' | 'md' | 'lg';           // Size hint
  position?: { row: number; col: number };
  
  dataSource?: IDataSource;
  refreshInterval?: number;            // Seconds
  
  connections?: IWidgetConnection[];
  actions?: IWidgetAction[];
  
  theme?: IWidgetTheme;
  customCss?: string;
}
```

### Data Source Configuration
```typescript
interface IDataSource {
  type: 'static' | 'api' | 'file' | 'computed' | 'widget';
  config: {
    // Static
    data?: any;
    
    // API
    url?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: any;
    transform?: string;                // JS expression
    
    // File
    path?: string;
    format?: 'json' | 'csv' | 'yaml';
    
    // Computed
    expression?: string;
    dependencies?: string[];            // Widget IDs
    
    // Widget
    widgetId?: string;
    property?: string;
  };
}
```

### Widget Connection
```typescript
interface IWidgetConnection {
  id: string;
  sourceWidget: string;                // Source widget ID
  sourceEvent: string;                 // Event name
  targetProperty: string;              // Target property to update
  transform?: string;                  // Optional JS transform
  enabled: boolean;
}
```

### Widget Action (Button/Script)
```typescript
interface IWidgetAction {
  id: string;
  label: string;
  icon?: string;
  script: string;                      // JavaScript to execute
  confirmMessage?: string;
  cooldown?: number;                   // Milliseconds
}
```

---

## Implementation Plan

### Phase 1: Foundation (Weeks 1-4)

#### Week 1-2: Project Setup & Core Infrastructure

**Tasks**:
1. Create Vite workspace at `packages/widgets/`
   ```bash
   cd packages
   npm create vite@latest widgets -- --template react-ts
   cd widgets
   npm install lit @lit/react vite-plugin-dts
   npm install -D vitest @testing-library/react jsdom
   ```

2. Configure build for library mode
   - ESM + UMD outputs
   - TypeScript declarations
   - Tree-shaking support
   - Source maps

3. Implement core classes:
   - `BaseWidget` abstract class
   - `WidgetBus` singleton
   - `ThemeBridge` utility
   - `DataProvider` abstraction
   - `ScriptExecutor` sandbox

4. Setup testing infrastructure:
   - Vitest configuration
   - React Testing Library
   - Web Test Runner for components
   - Coverage reporting

**Deliverables**:
- ✅ Functional Vite workspace
- ✅ Core classes implemented and tested
- ✅ Build pipeline producing ESM + UMD bundles
- ✅ Test suite with >80% coverage

**Success Criteria**:
- Build completes without errors
- All tests pass
- Bundle size < 50KB (core only)
- TypeScript types generated correctly

---

#### Week 3-4: React to Web Component Wrapper

**Tasks**:
1. Implement React→Web Component wrapper pattern
   ```typescript
   import { createComponent } from '@lit/react';
   
   export const createWidgetComponent = (
     ReactComponent: React.ComponentType,
     config: WidgetConfig
   ) => {
     return createComponent({
       tagName: config.tagName,
       elementClass: createWidgetClass(ReactComponent),
       react: React,
       reactDOM: ReactDOM,
       events: config.events
     });
   };
   ```

2. Theme integration implementation:
   - CSS variable injection system
   - Theme change listeners
   - Shadow DOM style inheritance
   - Dark/light mode support

3. Settings UI framework:
   - JSON Schema form generator (react-jsonschema-form)
   - Connection visual editor
   - Action/script editor with syntax highlighting
   - Validation and error handling

**Deliverables**:
- ✅ Working React→Web Component wrapper
- ✅ Theme integration functional
- ✅ Settings UI components complete
- ✅ Example widget demonstrating pattern

**Success Criteria**:
- React component renders in web component
- Theme colors propagate correctly
- Settings UI generates from schema
- No memory leaks on mount/unmount

---

### Phase 2: Widget Development (Weeks 5-8)

#### Week 5-6: Port Wigggle UI Widgets

**Tasks**:
1. Analyze and extract Wigggle UI components
2. Implement 5 core widgets:
   
   **ChartWidget**:
   - Support line, bar, pie, area charts
   - Recharts integration
   - Click interactions
   - Responsive sizing
   
   **StatWidget**:
   - Single numeric value display
   - Trend indicators
   - Color states
   - Comparison mode
   
   **CounterWidget**:
   - Increment/decrement
   - Min/max bounds
   - Custom step size
   - Reset button
   
   **ProgressWidget**:
   - Linear and circular modes
   - Percentage display
   - Status colors
   - Animations
   
   **TimerWidget**:
   - Countdown and stopwatch modes
   - Play/pause/reset controls
   - Sound notifications
   - VSCode notification integration

3. Create configuration schemas for each widget
4. Implement event emission for interactions
5. Add comprehensive JSDoc documentation

**Deliverables**:
- ✅ 5 functional widgets
- ✅ Configuration schemas defined
- ✅ Event system working
- ✅ Unit tests for each widget

**Success Criteria**:
- All widgets render correctly
- Interactions work as expected
- Events emit properly
- Tests achieve >80% coverage

---

#### Week 7-8: Data & Configuration Systems

**Tasks**:
1. Implement all data source types:
   - Static data parser
   - API integration (with extension host proxy)
   - File reading system
   - Computed value evaluation
   - Widget subscription system

2. Build configuration UI:
   - Auto-generated forms from schemas
   - Field validation
   - Preview mode
   - Import/export configuration
   - Preset templates

3. Widget connection system:
   - Visual connection editor (drag-and-drop)
   - Event subscription management
   - Data transformation expressions
   - Connection testing/debugging
   - Connection visualization

4. Data refresh and caching:
   - Automatic refresh intervals
   - Manual refresh triggers
   - Cache invalidation
   - Loading states

**Deliverables**:
- ✅ All data sources operational
- ✅ Configuration UI complete
- ✅ Connection system functional
- ✅ Caching implemented

**Success Criteria**:
- Data flows correctly from all sources
- Configuration saves and loads properly
- Connections work between widgets
- No data races or stale updates

---

### Phase 3: Integration & Polish (Weeks 9-12)

#### Week 9-10: Markdown Editor Integration

**Tasks**:
1. Create WidgetRenderer class:
   - Extend `BaseRenderer`
   - Parse `widget-dashboard` code blocks
   - Load configuration from JSON files
   - Instantiate widgets dynamically
   - Manage widget lifecycle
   - Grid layout system

2. Extension host integration:
   - Message handlers in `EditorPanel.ts`
   - API call proxy with security
   - File system access (read/write)
   - VSCode command bridge
   - Notification system

3. Persistence implementation:
   - Configuration storage in JSON files
   - Widget state management
   - Auto-save on changes
   - Migration support for updates
   - Backup and recovery

4. Insert widget command:
   - VS Code command registration
   - Code block template insertion
   - Configuration file creation
   - User prompts and wizards

**Deliverables**:
- ✅ WidgetRenderer fully functional
- ✅ Extension host handlers complete
- ✅ Persistence working reliably
- ✅ Insert command implemented

**Success Criteria**:
- Widgets render in markdown documents
- Configuration persists correctly
- Extension host communication works
- No data loss on save/reload

---

#### Week 11: Testing & Documentation

**Tasks**:
1. Comprehensive testing:
   - Unit tests for all classes (>80% coverage)
   - Integration tests for widget communication
   - E2E tests in markdown editor (Playwright)
   - Performance benchmarks
   - Accessibility audit (WCAG 2.1 AA)
   - Cross-browser testing

2. Documentation creation:
   - **User Guide**:
     - Getting started
     - Available widgets
     - Configuration examples
     - Troubleshooting
   
   - **Developer Guide**:
     - Creating custom widgets
     - Widget API reference
     - Data source guide
     - Testing widgets
     - Publishing widgets
   
   - **Examples**:
     - Dashboard templates
     - Integration patterns
     - Advanced configurations
     - VSCode API usage

3. Create demo workspace with examples
4. Record video tutorials

**Deliverables**:
- ✅ Test suite complete (>80% coverage)
- ✅ User guide published
- ✅ Developer guide published
- ✅ Example workspace created
- ✅ Video tutorials recorded

**Success Criteria**:
- All tests pass
- Documentation complete and accurate
- Examples run without errors
- Positive feedback from beta testers

---

#### Week 12: Polish & Release

**Tasks**:
1. Performance optimization:
   - Lazy loading implementation
   - Code splitting per widget
   - Bundle size optimization (<5MB total)
   - Rendering performance tuning
   - Memory leak prevention

2. Security review:
   - Script sandbox audit
   - API proxy security check
   - Input validation review
   - XSS prevention verification
   - Dependency vulnerability scan

3. Package preparation:
   - NPM package configuration
   - README and changelog
   - License file
   - Contributing guidelines
   - GitHub repository setup

4. Beta release:
   - Publish to NPM (@phfsantos/markdown-widgets)
   - Update VS Code extension
   - Announce to community
   - Gather feedback
   - Bug fixes and iterations

**Deliverables**:
- ✅ Optimized bundle
- ✅ Security audit complete
- ✅ NPM package published
- ✅ Extension updated
- ✅ Community announcement

**Success Criteria**:
- Bundle loads in <500ms
- No critical security issues
- NPM package installable
- Extension integrates smoothly
- Positive community feedback

---

## Security & Privacy

### Script Execution Sandbox
```typescript
class ScriptExecutor {
  private allowedGlobals = {
    console: { log: (...args) => console.log('[Widget]', ...args) },
    Math, Date, JSON, Array, Object, String, Number
  };
  
  execute(script: string, context: any = {}): any {
    const fn = new Function(
      ...Object.keys(this.allowedGlobals),
      ...Object.keys(context),
      `"use strict"; return (${script});`
    );
    
    return fn(
      ...Object.values(this.allowedGlobals),
      ...Object.values(context)
    );
  }
}
```

**Protection**:
- ✅ No access to `window`, `document`, `localStorage`
- ✅ No network access (must use API proxy)
- ✅ No file system access (must use extension host)
- ✅ Timeout enforcement (5 second limit)
- ✅ Error isolation (won't crash editor)

### API Call Security
**Requirements**:
- All API calls proxied through extension host
- Domain allowlist in VSCode settings
- Rate limiting per widget
- No credentials in widget configuration
- Environment variable substitution for secrets

**Configuration**:
```json
{
  "markdown-editor.widgets.allowedApiDomains": [
    "api.example.com",
    "*.github.com"
  ],
  "markdown-editor.widgets.rateLimit": 60
}
```

### File System Access
**Restrictions**:
- Read-only by default
- Path validation (no directory traversal)
- Size limits (10MB max)
- Workspace-only access
- Extension host mediation

### XSS Prevention
- Shadow DOM isolation
- Sanitized user input (DOMPurify)
- CSP headers in webview
- No `dangerouslySetInnerHTML`
- Validated data sources

---

## Performance Targets

### Load Time
- **Widget Bundle**: < 100KB gzipped per widget
- **Initial Load**: < 500ms to first render
- **Lazy Load**: < 100ms per additional widget
- **Total Bundle**: < 5MB for all widgets

### Runtime Performance
- **Render Time**: < 50ms for simple widgets, < 500ms for charts
- **Update Time**: < 16ms (60 FPS) for data updates
- **Memory Usage**: < 10MB per widget instance
- **Event Latency**: < 10ms for widget communication

### Optimization Strategies
1. **Code Splitting**: Separate bundle per widget type
2. **Lazy Loading**: Load on-demand when widget visible
3. **Virtual Scrolling**: For widget grids with many items
4. **Debouncing**: Data updates and re-renders
5. **Web Workers**: Heavy computations offloaded
6. **RequestIdleCallback**: Non-critical updates deferred

---

## Testing Strategy

### Unit Tests (Vitest)
```typescript
describe('ChartWidget', () => {
  it('renders with static data', () => {
    const widget = new ChartWidget();
    widget.config = {
      dataSource: { type: 'static', config: { data: [...] } }
    };
    widget.connectedCallback();
    expect(widget.shadowRoot.querySelector('svg')).toBeTruthy();
  });
  
  it('emits point-selected event on click', async () => {
    const widget = new ChartWidget();
    const spy = vi.fn();
    widget.addEventListener('point-selected', spy);
    
    const point = widget.shadowRoot.querySelector('circle');
    point.click();
    
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { x: 1, y: 2 } })
    );
  });
});
```

### Integration Tests
```typescript
describe('Widget Communication', () => {
  it('connects chart to stat widget', async () => {
    const chart = new ChartWidget();
    const stat = new StatWidget();
    
    const bus = WidgetBus.getInstance();
    bus.registerWidget(chart);
    bus.registerWidget(stat);
    
    bus.createConnection({
      sourceWidget: chart.id,
      sourceEvent: 'point-selected',
      targetProperty: 'value'
    });
    
    chart.emit('point-selected', { y: 42 });
    await nextTick();
    
    expect(stat.value).toBe(42);
  });
});
```

### E2E Tests (Playwright)
```typescript
test('widget renders in markdown editor', async ({ page }) => {
  await page.goto('vscode://...');
  
  // Insert widget code block
  await page.keyboard.type('```widget-dashboard\n```');
  
  // Wait for widget to render
  await page.waitForSelector('widget-chart');
  
  // Verify rendering
  const chart = await page.locator('widget-chart');
  await expect(chart).toBeVisible();
  
  // Test interaction
  await page.click('widget-chart svg circle');
  await expect(page.locator('widget-stat')).toHaveText('42');
});
```

### Coverage Targets
- **Unit Tests**: > 80% line coverage
- **Integration Tests**: All widget communication paths
- **E2E Tests**: Critical user workflows
- **Performance Tests**: All widgets under load

---

## Dependencies

### Core Dependencies
```json
{
  "dependencies": {
    "lit": "^3.1.0",
    "@lit/react": "^1.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "recharts": "^2.10.0",
    "react-jsonschema-form": "^5.15.0",
    "dompurify": "^3.0.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "vite-plugin-dts": "^3.7.0",
    "vitest": "^1.0.0",
    "@testing-library/react": "^14.1.0",
    "@playwright/test": "^1.40.0",
    "typescript": "^5.3.0"
  }
}
```

### Peer Dependencies
```json
{
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

---

## Deployment & Distribution

### NPM Package Structure
```
@phfsantos/markdown-widgets@1.0.0
├── dist/
│   ├── index.js          (UMD bundle)
│   ├── index.mjs         (ESM bundle)
│   ├── index.d.ts        (TypeScript types)
│   ├── widgets/
│   │   ├── chart.mjs
│   │   ├── timer.mjs
│   │   ├── counter.mjs
│   │   ├── progress.mjs
│   │   └── stat.mjs
│   └── core/
│       ├── BaseWidget.d.ts
│       ├── WidgetBus.d.ts
│       └── ...
├── README.md
├── LICENSE
├── CHANGELOG.md
└── package.json
```

### Package Configuration
```json
{
  "name": "@phfsantos/markdown-widgets",
  "version": "1.0.0",
  "description": "Interactive dashboard widgets for VSCode markdown editor",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./widgets/*": {
      "import": "./dist/widgets/*.mjs",
      "require": "./dist/widgets/*.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "keywords": [
    "markdown",
    "widgets",
    "dashboard",
    "visualization",
    "vscode",
    "web-components"
  ]
}
```

### Version Strategy
- **Semantic Versioning**: MAJOR.MINOR.PATCH
  - **Patch**: Bug fixes, documentation updates
  - **Minor**: New widgets, new features (backwards compatible)
  - **Major**: Breaking API changes, architecture changes

### Update Mechanism
```typescript
// Check for widget package updates
async function checkForWidgetUpdates(): Promise<void> {
  const currentVersion = '1.0.0';
  const latestVersion = await fetchLatestVersion(
    '@phfsantos/markdown-widgets'
  );
  
  if (semver.gt(latestVersion, currentVersion)) {
    const action = await vscode.window.showInformationMessage(
      `Widget update available: ${latestVersion}`,
      'Update Now',
      'Later'
    );
    
    if (action === 'Update Now') {
      await updateWidgetPackage(latestVersion);
      vscode.window.showInformationMessage('Widgets updated successfully!');
    }
  }
}
```

### Release Checklist
- [ ] All tests passing
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json
- [ ] Git tag created
- [ ] NPM package published
- [ ] GitHub release created
- [ ] Extension updated and published
- [ ] Community announcement posted

---

## Documentation Plan

### User Documentation

#### 1. Getting Started Guide
- Installation instructions
- First widget creation
- Configuration basics
- Common patterns

#### 2. Widget Gallery
- Overview of available widgets
- Configuration options
- Live examples
- Use cases

#### 3. Configuration Reference
- Data source types
- Connection system
- Actions and scripts
- Theme customization

#### 4. Troubleshooting
- Common issues
- Debug logging
- Performance tips
- FAQ

### Developer Documentation

#### 1. Creating Custom Widgets
- Widget development setup
- BaseWidget API
- React integration
- Testing widgets

#### 2. Widget API Reference
- Class hierarchy
- Method documentation
- Event system
- Data flow

#### 3. Data Sources
- Implementing custom sources
- API integration
- File formats
- Computed values

#### 4. Publishing Widgets
- Package structure
- NPM publishing
- Versioning
- Best practices

### Examples

#### 1. Dashboard Templates
- Analytics dashboard
- Project metrics
- System monitoring
- Personal productivity

#### 2. Integration Patterns
- Chart + stat combination
- Timer with notifications
- API data visualization
- File-based widgets

#### 3. Advanced Configurations
- Complex connections
- Custom scripts
- Theme customization
- Performance optimization

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| React→Web Component compatibility issues | Medium | High | Extensive testing, use @lit/react, fallback to vanilla components |
| Performance issues with many widgets | Medium | Medium | Lazy loading, virtual scrolling, performance monitoring |
| Theme integration complexity | Low | Medium | CSS variable bridge, thorough testing across themes |
| Security vulnerabilities in sandbox | Low | Critical | Security audit, limited global scope, timeout enforcement |
| Breaking changes in dependencies | Medium | Medium | Lock versions, test updates, maintain compatibility layer |

### Project Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Scope creep beyond 12 weeks | High | Medium | Strict phase adherence, MVP focus, defer non-essential features |
| Insufficient testing coverage | Medium | High | TDD approach, automated coverage reports, dedicated testing week |
| Documentation falling behind | Medium | Medium | Document as you code, dedicated documentation week |
| Community adoption slow | Medium | Low | Beta testing, marketing, examples, video tutorials |
| Maintenance burden | Low | Medium | Good documentation, community contributions, automated testing |

---

## Success Criteria

### Functional Requirements
- ✅ 5+ widget types fully functional
- ✅ Inter-widget communication working
- ✅ Data sources (static, API, file, computed, widget) operational
- ✅ Configuration UI complete and usable
- ✅ VSCode API integration (notifications, commands, files)
- ✅ Theme integration across light/dark modes
- ✅ Script execution sandbox secure
- ✅ Settings persist correctly

### Performance Requirements
- ✅ < 500ms initial widget load
- ✅ < 100ms lazy load per widget
- ✅ < 50ms simple widget render
- ✅ < 500ms complex chart render
- ✅ < 10MB memory per widget
- ✅ 60 FPS for interactions
- ✅ < 5MB total bundle size

### Quality Requirements
- ✅ > 80% test coverage
- ✅ Zero critical security issues
- ✅ WCAG 2.1 AA accessibility
- ✅ Cross-browser compatible
- ✅ Mobile responsive
- ✅ No memory leaks

### Documentation Requirements
- ✅ Complete user guide
- ✅ Complete developer guide
- ✅ API documentation
- ✅ 10+ working examples
- ✅ Video tutorials
- ✅ Troubleshooting guide

### Community Requirements
- ✅ NPM package published
- ✅ GitHub repository public
- ✅ Community forum/discussions
- ✅ Contributing guidelines
- ✅ Example projects
- ✅ Positive feedback from beta testers

---

## Future Enhancements

### Phase 4 (Post-Launch)
1. **Additional Widgets**:
   - Calendar widget
   - Kanban board widget (migrate existing)
   - Table widget (migrate existing)
   - Map widget (leaflet)
   - Code editor widget (Monaco)
   - Terminal widget

2. **Enhanced Features**:
   - Widget templates marketplace
   - Collaborative editing
   - Real-time data streaming
   - Export dashboard as HTML
   - Mobile app integration

3. **Advanced Integration**:
   - GitHub integration (issues, PRs)
   - Jira integration
   - Slack integration
   - Database connections
   - GraphQL support

4. **Developer Tools**:
   - Widget debugger
   - Performance profiler
   - Visual editor
   - CLI tools
   - Yeoman generator

---

## Timeline Summary

| Phase | Duration | Key Deliverables | Completion Date |
|-------|----------|------------------|-----------------|
| Phase 1: Foundation | Weeks 1-4 | Core infrastructure, wrapper pattern | Dec 19, 2025 |
| Phase 2: Widgets | Weeks 5-8 | 5 widgets, data sources, configuration | Jan 16, 2026 |
| Phase 3: Integration | Weeks 9-12 | Editor integration, testing, release | Feb 13, 2026 |

**Total Duration**: 12 weeks  
**Start Date**: November 21, 2025  
**Target Completion**: February 13, 2026

---

## Approval & Sign-off

### Stakeholders
- **Project Owner**: @phfsantos
- **Technical Lead**: @phfsantos
- **Documentation Lead**: TBD
- **QA Lead**: TBD

### Approval Status
- [ ] Technical design approved
- [ ] Timeline approved
- [ ] Resource allocation approved
- [ ] Security review approved
- [ ] Ready to begin implementation

### Notes
This plan is a living document and will be updated as the project progresses. Any significant changes to scope, timeline, or approach will be documented here.

---

**Last Updated**: November 21, 2025  
**Next Review**: December 5, 2025 (After Phase 1 completion)
