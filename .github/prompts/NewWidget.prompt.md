---
description: New Widget Creation Implementation Plan for VSCode Markdown Editor
tools: ['vscode', 'execute', 'read', 'agent', 'edit', 'search', 'web', 'azure-mcp/search', 'github/get_commit', 'github/get_file_contents', 'github/get_me', 'github/get_tag', 'github/list_branches', 'github/list_commits', 'github/list_issues', 'github/list_pull_requests', 'github/list_tags', 'github/search_code', 'github/search_issues', 'github/search_pull_requests', 'github/search_repositories', 'github/search_users', 'memory/*', 'microsoft/markitdown/*', 'sequentialthinking/*', 'upstash/context7/*', 'todo']
---

# Widget Creation Implementation Plan

**Document Version:** 1.2
**Date:** December 3, 2025
**Status:** Active
**Owner:** Development Team

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Goals and Success Metrics](#goals-and-success-metrics)
- [Scope and Non-Goals](#scope-and-non-goals)
- [Requirements Breakdown](#requirements-breakdown)
- [Architecture and Design](#architecture-and-design)
- [Work Breakdown Structure](#work-breakdown-structure)
- [Input Parameters for AI Agent](#input-parameters-for-ai-agent)
- [Data Model](#data-model)
- [APIs and Contracts](#apis-and-contracts)
- [Validation Strategy](#validation-strategy)
- [Risks and Mitigations](#risks-and-mitigations)
- [Example Implementation](#example-implementation)
- [Traceability Matrices](#traceability-matrices)
- [Quality Checks](#quality-checks)

---

## Executive Summary

This plan provides a comprehensive, step-by-step guide for an AI agent to create new widgets for the VSCode Markdown Editor's custom text editor. The widget system uses React components wrapped as Web Components, integrating with VSCode's theming and the Vditor-based markdown editor.

**Key Features:**

- React-based widget components with TypeScript support
- Automatic persistence to markdown code blocks
- VSCode theme integration
- Settings panel for runtime configuration
- Event-driven architecture for data updates

**Expected Outcomes:**

- Consistent widget implementation patterns
- Reduced development time for new widgets
- Maintainable, testable widget code
- Seamless integration with existing editor

---

## Goals and Success Metrics

### Business Objectives

1. Enable rapid widget development with consistent patterns
2. Maintain interactivity within the Vditor markdown editor context
3. Support data persistence back to markdown code blocks
4. Provide excellent developer experience for widget creators

### Success Metrics


| Metric                                               | Target           | Measurement Method                  |
| ---------------------------------------------------- | ---------------- | ----------------------------------- |
| Widget renders correctly in markdown preview         | 100%             | Visual inspection + automated tests |
| Widget interactions work without Vditor interference | 100%             | Event propagation tests             |
| Settings panel saves config back to code block       | 100%             | Persistence integration tests       |
| Widget follows existing style patterns               | Pass code review | Manual code review                  |
| TypeScript compiles without errors                   | 0 errors         | `npm run build`                     |
| Bundle size impact                                   | < 5KB per widget | Webpack bundle analyzer             |

---

## Scope and Non-Goals

### In Scope

- ✅ React-based widget components using the existing UI primitives
- ✅ Widget registration with `WidgetRegistry`
- ✅ Data persistence via `widget-update` custom events
- ✅ Settings panel integration for configuration
- ✅ VSCode theme variable integration
- ✅ Support for all widget sizes (sm/md/lg)
- ✅ TypeScript type safety
- ✅ Shadow DOM isolation

### Non-Goals

- ❌ Pure Web Component widgets (use React wrapper instead)
- ❌ Server-side data fetching (client-side only for now)
- ❌ Complex drag-and-drop across widgets
- ❌ External npm package additions (use existing deps)
- ❌ Backend API integration (future enhancement)
- ❌ Widget marketplace or plugin system

---

## Requirements Breakdown

### Functional Requirements


| ID   | Priority | Description                                        | Acceptance Criteria                                                 |
| ---- | -------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| FR-1 | P0       | Widget renders inside`widget` code block           | Widget appears when markdown contains ```widget with correct type   |
| FR-2 | P0       | Widget accepts configuration from YAML-like syntax | Config props from code block populate widget correctly              |
| FR-3 | P0       | Widget interactions emit update events             | Clicking/editing triggers`widget-update` event with correct payload |
| FR-4 | P1       | Settings panel modifies widget config              | Opening settings, changing values, and saving updates code block    |
| FR-5 | P0       | Widget uses VSCode theme colors                    | All colors reference`--vscode-*` CSS variables                      |
| FR-6 | P1       | Widget supports multiple sizes                     | sm/md/lg sizes render correctly                                     |
| FR-7 | P2       | Widget data persists on save                       | Data section in code block updates when widget changes              |

### Non-Functional Requirements


| ID    | Category        | Criteria                           | Measurement                     |
| ----- | --------------- | ---------------------------------- | ------------------------------- |
| NFR-1 | Performance     | Widget renders in < 100ms          | Chrome DevTools Performance tab |
| NFR-2 | Bundle Size     | Single widget adds < 5KB to bundle | Webpack bundle analyzer         |
| NFR-3 | Accessibility   | Interactive elements have labels   | Axe accessibility scanner       |
| NFR-4 | Code Quality    | TypeScript strict mode compliance  | `tsc --strict`                  |
| NFR-5 | Maintainability | Follows established patterns       | Code review checklist           |
| NFR-6 | Documentation   | All interfaces documented          | TSDoc comments present          |

---

## Architecture and Design

### Widget System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Markdown Document                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ```widget                                                 │  │
│  │ type: widget-type
```

│  │
│  │ title: My Widget                                          │  │
│  │ config-key: config-value                                  │  │
│  │ ---                                                       │  │
│  │ data-key: data-value                                      │  │
│  │ ```                                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
↓ (parsed by)
┌─────────────────────────────────────────────────────────────────┐
│                    WidgetRenderer.ts                            │
│   - parseWidgetConfig(content) → { config, data }              │
│   - registry.create(config) → HTMLElement                      │
│   - Handles widget-update events → serializeWidgetContent()    │
│   - Updates code block via Vditor API                          │
└─────────────────────────────────────────────────────────────────┘
↓ (creates)
┌─────────────────────────────────────────────────────────────────┐
│               ReactWidgetWrapper                                │
│   - Creates Web Component from React component                  │
│   - Manages Shadow DOM                                          │
│   - Passes config/data/onUpdate props                          │
│   - Handles lifecycle callbacks                                 │
└─────────────────────────────────────────────────────────────────┘
↓ (renders)
┌─────────────────────────────────────────────────────────────────┐
│               Your Widget Component (React)                     │
│   - Receives: config, data, onUpdate                           │
│   - Uses: Widget, WidgetHeader, WidgetContent, etc.            │
│   - Emits: widget-update events for persistence                │
│   - Manages internal state with hooks                          │
└─────────────────────────────────────────────────────────────────┘

```

### Component Responsibilities

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `BaseWidget.ts` | `packages/widgets/src/core/` | Abstract base class for Web Component widgets |
| `ReactWidgetWrapper.ts` | `packages/widgets/src/core/` | Bridges React → Web Component |
| `WidgetRegistry.ts` | `packages/widgets/src/core/` | Central registry for widget definitions |
| `registerWidgets.ts` | `packages/widgets/src/widgets/` | Registers all core widgets on startup |
| `WidgetRenderer.ts` | `packages/media/src/renderers/builtin/` | Parses code blocks and creates widget instances |
| `Widget.tsx` et al. | `packages/widgets/src/ui/` | UI primitives for building widgets |

### UI Component Library: wigggle-ui

**⚠️ CRITICAL: All widget UI components and styles MUST be based on the wigggle-ui library for consistency.**

**Source Repository:**
- **GitHub:** [https://github.com/wigggle-ui/ui/](https://github.com/wigggle-ui/ui/)
- **Widget Examples:** [https://github.com/wigggle-ui/ui/tree/main/registry/default/widgets](https://github.com/wigggle-ui/ui/tree/main/registry/default/widgets)

**Widget Design Guidelines:**

1. **Use Existing Components First**
   - Check the wigggle-ui registry for existing widget implementations
   - Many common widget patterns (clocks, timers, charts, productivity widgets) already exist
   - Import and adapt existing components rather than building from scratch

2. **Follow wigggle-ui Styling Standards**
   - Use the same CSS variable patterns (colors, spacing, typography)
   - Follow the component structure patterns (Widget, WidgetHeader, WidgetContent, WidgetFooter)
   - Match hover effects, transitions, and animations

3. **Reference Implementations**
   - Browse `registry/default/widgets/` for reference implementations:
     - `clock-*.tsx` - Various clock/timer widget patterns
     - `chart-*.tsx` - Data visualization widgets
     - `productivity-*.tsx` - Task/todo widget patterns
     - `weather-*.tsx` - Weather display patterns
   - These examples show proper styling, state management, and accessibility

4. **When Creating New Components**
   - If a component doesn't exist in wigggle-ui, create it following the same patterns
   - Use the same naming conventions and file structure
   - Follow the same prop patterns and TypeScript interfaces
   - Document as potential contribution back to wigggle-ui

5. **Consistency Checklist**
   - [ ] Colors use CSS variables matching wigggle-ui patterns
   - [ ] Typography follows wigggle-ui scale
   - [ ] Spacing uses consistent values (4px, 8px, 12px, 16px, 24px)
   - [ ] Animations use consistent easing and duration
   - [ ] Component composition follows Widget/Header/Content/Footer pattern
   - [ ] Icons use consistent style (inline SVG or icon library)
   - [ ] Hover/focus states match existing widgets

### File Structure

```

packages/widgets/
├── src/
│   ├── core/
│   │   ├── BaseWidget.ts           # Base class (for pure WC widgets)
│   │   ├── ReactWidgetWrapper.ts   # React → WC bridge
│   │   ├── WidgetRegistry.ts       # Widget registry
│   │   ├── types.ts                # Core type definitions
│   │   └── index.ts                # Core exports
│   ├── ui/
│   │   ├── Widget.tsx              # Base widget UI components
│   │   ├── Button.tsx              # Button component
│   │   ├── Input.tsx               # Input components
│   │   ├── WidgetSettingsPanel.tsx # Settings modal
│   │   └── index.ts                # UI exports
│   ├── widgets/
│   │   ├──

```

widgetnameWidget.tsx  # Individual widget implementations
│   │   ├── registerWidgets.ts      # Widget registration
│   │   └── index.ts                # Widget exports
│   └── index.ts                    # Package entry point
└── package.json

packages/media/
└── src/
    └── renderers/
        └── builtin/
            ├── WidgetRenderer.ts    # Widget code block renderer
            └── DashboardRenderer.ts # Multi-widget dashboard renderer
```

---

## Work Breakdown Structure

### Phase 1: Widget Implementation

#### Epic 1.1: Create Widget Component File

**Task 1.1.1: Create widget file structure**

- **Assignee:** Developer
- **Deliverables:** New `widgetnameWidget.tsx` file
- **Dependencies:** None
- **Estimate:** 0.5 hours
- **Priority:** P0

**Location:** `packages/widgets/src/widgets/widgetnameWidget.tsx`

**Required template structure:**

```typescript
/**
 * widgetnameWidget - brief
 * 
 * Features:
 * - Feature 1
 * - Feature 2
 * - Feature 3
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Widget, WidgetHeader, WidgetContent, WidgetFooter, 
  WidgetTitle, Label, Button, Input, 
  WidgetSettingsPanel, SettingsToggle
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize } from '../ui/Widget';

// =====================
// TYPE DEFINITIONS
// =====================

export interface widgetnameWidgetConfig {
  title?: string;
  size?: WidgetSize;
  // Add widget-specific config options
}

export interface widgetnameWidgetData {
  // Add widget-specific data structure
}

// =====================
// SETTINGS CONFIGURATION
// =====================

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: '
<default title="">' },
  { 
    key: 'size', 
    label: 'Size', 
    type: 'select', 
    options: [
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Medium' },
      { value: 'lg', label: 'Large' },
    ],
    defaultValue: 'sm'
  },
  // Add widget-specific settings
];

// =====================
// WIDGET COMPONENT
// =====================

export const <widgetname>Widget: React.FC<reactwidgetprops> = ({ 
  config, 
  data, 
  onUpdate
}) => {
  // Cast props to typed interfaces
  const widgetConfig = config as unknown as <widgetname>WidgetConfig;
  const widgetData = data as <widgetname>WidgetData | undefined;
  
  // =====================
  // STATE
  // =====================
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<<widgetname>WidgetConfig>(widgetConfig);
  // Add widget-specific state
  
  // Config with defaults
  const title = localConfig.title || '<default title="">';
  const size = localConfig.size || 'sm';

  // =====================
  // EFFECTS
  // =====================
  
  // Sync with external data changes
  useEffect(() => {
    if (widgetData) {
      // Update local state from external data
    }
  }, [widgetData]);

  // =====================
  // EVENT HANDLERS
  // =====================
  
  // Emit update event (triggers save to code block)
  const emitUpdate = useCallback((
    updatedData: <widgetname>WidgetData, 
    updatedConfig?: <widgetname>WidgetConfig
  ) => {
    const payload = {
      data: updatedData,
      config: updatedConfig || localConfig,
    };
  
    // Call onUpdate to notify parent/renderer
    if (onUpdate) {
      onUpdate({ ...payload.data, _config: payload.config });
    }
  
    // Dispatch custom event for WidgetRenderer to catch
    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'data-change',
        ...payload,
        widgetId: (config as any).id,
      },
    });
    document.dispatchEvent(customEvent);
  }, [onUpdate, localConfig, config]);

  // Handle settings save
  const handleSettingsSave = useCallback((newConfig: Record<string, any="">) => {
    const updatedConfig = { ...localConfig, ...newConfig } as <widgetname>WidgetConfig;
    setLocalConfig(updatedConfig);
    // Emit with current data and new config
    emitUpdate(/* current data */, updatedConfig);
  }, [localConfig, emitUpdate]);

  // =====================
  // RENDER
  // =====================
  
  return (
    <widget size="{size}" design="default" position:="" 'relative'="" }}="">
      <widgetheader justifycontent:="" 'space-between',="" alignitems:="" 'center'="" }}="">
        <widgettitle>{title}</widgettitle>
        <settingstoggle isopen="{isSettingsOpen}" onclick="{()"> setIsSettingsOpen(!isSettingsOpen)} 
        />
      </settingstoggle></widgetheader>

      {/* Settings Panel */}
      {isSettingsOpen && (
        <widgetsettingspanel title="<WidgetName> Settings" fields="{settingsFields}" values="{localConfig" as="" record<string,="" any="">}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      <widgetcontent flexdirection:="" 'column',="" gap:="" '8px'="" }}="">
        {/* Widget content goes here */}
      </widgetcontent>

      <widgetfooter>
        {/* Optional footer content */}
      </widgetfooter>
    </widgetsettingspanel></widget>
  );
};
```

**Task 1.1.2: Implement widget-specific logic**

- **Assignee:** Developer
- **Dependencies:** Task 1.1.1
- **Estimate:** 1-4 hours (depends on complexity)
- **Priority:** P0

**⚠️ IMPORTANT: Check wigggle-ui first!**
Before implementing, check [wigggle-ui/ui registry](https://github.com/wigggle-ui/ui/tree/main/registry/default/widgets) for existing implementations that match your widget type. If a similar widget exists, use it as the primary reference for:
- Component structure and composition
- State management patterns
- Styling and animations
- Accessibility features

**Requirements based on widget type:**

1. **Define Interfaces**

   - `Config` interface with all configurable options
   - `Data` interface with persistable data structure
   - Include JSDoc comments for all properties
2. **Implement State Management**

   - Use `useState` for local state
   - Use `useEffect` for side effects and data sync
   - Use `useCallback` for event handlers (performance)
3. **Implement Data Flow**

   - Call `emitUpdate()` whenever data changes
   - Handle external data updates in `useEffect`
   - Maintain config in local state
4. **Add Settings Fields**

   - Define `settingsFields` array
   - Include all user-configurable options
   - Use appropriate field types (text/number/select/checkbox)
5. **Render UI (following wigggle-ui patterns)**

   - Use provided UI components (`Widget`, `Label`, `Button`, etc.)
   - Follow existing widget patterns from wigggle-ui
   - Use VSCode theme variables for colors
   - Match wigggle-ui styling (spacing, typography, animations)

---

#### Epic 1.2: Register Widget

**Task 1.2.1: Add widget to registry**

- **Assignee:** Developer
- **Deliverables:** Updated `registerWidgets.ts`
- **Dependencies:** Task 1.1.2
- **Estimate:** 0.25 hours
- **Priority:** P0

**File:** `packages/widgets/src/widgets/registerWidgets.ts`

Add import at top:

```typescript
import { <widgetname>Widget } from './<widgetname>Widget';
```

Add registration in `registerCoreWidgets()` function:

```typescript
// <widgetname> Widget
registry.register({
  type: '<widget-type>',  // lowercase, hyphenated, used in code blocks
  displayName: '<widget name="">',
  description: '<brief description="" of="" widget="">',
  category: '<category>',  // 'time' | 'data' | 'info' | 'finance' | 'productivity' | 'input' | 'example'
  reactComponent: {
    component: <widgetname>Widget,
    tagName: '<widget-type>-widget',  // must contain hyphen for custom element
    displayName: '<widget name="">'
  }
});
```

**Task 1.2.2: Export widget from index**

- **Assignee:** Developer
- **Deliverables:** Updated `widgets/index.ts`
- **Dependencies:** Task 1.2.1
- **Estimate:** 0.1 hours
- **Priority:** P0

**File:** `packages/widgets/src/widgets/index.ts`

Add exports:

```typescript
export { <widgetname>Widget } from './<widgetname>Widget';
export type { 
  <widgetname>WidgetConfig, 
  <widgetname>WidgetData 
} from './<widgetname>Widget';
```

---

#### Epic 1.3: Update Editor Integration Points

**⚠️ CRITICAL: The following locations MUST be updated for full widget integration:**

**Task 1.3.1: Update Context Menu (main.ts)**

- **Assignee:** Developer
- **Deliverables:** Updated `packages/media/src/main.ts`
- **Dependencies:** Task 1.2.1
- **Estimate:** 0.25 hours
- **Priority:** P0

**File:** `packages/media/src/main.ts`

**Step 1:** Add widget template in `insertWidgetDirect()` templates object (~line 145-215):

```typescript
const templates: Record<string, { config: Record<string, any>; data?: any }> = {
  // ... existing templates ...
  
  <widgettype>: {
    config: { 
      type: '<widget-type>', 
      title: 'My <WidgetName>', 
      // Add all default config options
    },
    data: {
      // Add default data structure if applicable
    }
  },
};
```

**Step 2:** Add context menu entry in `buildVSCodeContextMenu()` Insert submenu (~line 403-435):

```typescript
{
  label: "Insert",
  submenu: [
    // ... existing menu items ...
    {
      label: "📦 <WidgetName> Widget",
      click: () => insertWidgetDirect("<widget-type>"),
    },
  ],
},
```

---

**Task 1.3.2: Update WidgetRenderer parseWidgetConfig (optional)**

- **Assignee:** Developer
- **Deliverables:** Updated `packages/media/src/renderers/builtin/WidgetRenderer.ts`
- **Dependencies:** Task 1.2.1
- **Estimate:** 0.1 hours
- **Priority:** P2

**Note:** Only needed if widget requires custom parsing logic beyond standard YAML-like config.

**File:** `packages/media/src/renderers/builtin/WidgetRenderer.ts`

The `parseWidgetConfig()` method (~line 283-333) handles standard config parsing. For widgets with complex data structures (arrays, nested objects), ensure the parsing handles the format correctly.

---

**Task 1.3.3: Update DashboardRenderer (if widget requires special dashboard handling)**

- **Assignee:** Developer
- **Deliverables:** Updated `packages/media/src/renderers/builtin/DashboardRenderer.ts`
- **Dependencies:** Task 1.2.1
- **Estimate:** 0.1 hours
- **Priority:** P2

**⚠️ IMPORTANT: Most widgets do NOT require DashboardRenderer changes!**

**File:** `packages/media/src/renderers/builtin/DashboardRenderer.ts`

The widget will **automatically work in dashboards** if registered correctly in `registerWidgets.ts`. The DashboardRenderer uses the WidgetRegistry to create widgets dynamically, so no modifications are needed for standard widgets.

**When DashboardRenderer.ts changes ARE needed:**

| Scenario | Required Change | Location in File |
|----------|-----------------|------------------|
| Widget needs custom default colspan/rowspan | Add default span logic in `createWidgetWrapper()` | ~line 1236 |
| Widget needs custom grid positioning rules | Modify grid style calculation | ~line 1261 |
| Widget has dashboard-only configuration | Add special config parsing in `parseDashboardConfig()` | ~line 306 |
| Widget needs custom serialization format | Update `serializeDashboardConfig()` | ~line 196 |
| Widget requires connector support (future) | Add connector handling logic | ~line 238 |

**When DashboardRenderer.ts changes are NOT needed:**

- ✅ Standard widgets that work at any grid position
- ✅ Widgets that use default colspan=1, rowspan=1
- ✅ Widgets with standard config/data structure
- ✅ Widgets that don't need special dashboard behavior

**Example: Adding custom default span for a large widget:**

```typescript
// In createWidgetWrapper() method (~line 1236)
private createWidgetWrapper(
  widgetConfig: DashboardWidgetConfig, 
  registry: any,
  widgetIndex: number,
  editMode: boolean
): HTMLElement {
  // Add custom defaults for specific widget types
  if (widgetConfig.type === 'calendar' && !widgetConfig.colspan) {
    widgetConfig.colspan = 2; // Calendar defaults to 2 columns
  }
  if (widgetConfig.type === 'kanban' && !widgetConfig.rowspan) {
    widgetConfig.rowspan = 2; // Kanban defaults to 2 rows
  }
  // ... rest of method
}
```

**Documentation example for dashboard usage:**

```markdown
\`\`\`dashboard
title: My Dashboard
columns: 3
widgets:
  - type: <widget-type>
    title: <WidgetName>
    colspan: 1
    data:
      # Widget-specific data
\`\`\`
```

---

**Task 1.3.4: Update VSCodeWebviewIntegrator (optional)**

- **Assignee:** Developer
- **Deliverables:** Updated `packages/media/src/vscode-integrator.ts`
- **Dependencies:** Task 1.2.1
- **Estimate:** 0.1 hours
- **Priority:** P2

**Note:** Only needed if widget should have dedicated VS Code command integration.

If the widget needs a VS Code command (e.g., `markdown-editor.insert<WidgetName>`):

1. Add command handling in `EditorPanel.ts` (`src/app/EditorPanel.ts`)
2. Register command in `package.json` contributes.commands
3. Add command to `WidgetCommandProvider.ts` (`src/commands/WidgetCommandProvider.ts`)

---

### Summary: All Files to Update for New Widget

| File | Location | Required | Purpose |
|------|----------|----------|---------|
| `<widgetname>Widget.tsx` | `packages/widgets/src/widgets/` | ✅ Yes | Widget implementation |
| `registerWidgets.ts` | `packages/widgets/src/widgets/` | ✅ Yes | Widget registration |
| `widgets/index.ts` | `packages/widgets/src/widgets/` | ✅ Yes | Widget exports |
| `main.ts` | `packages/media/src/` | ✅ Yes | Context menu + insert template |
| `WidgetRenderer.ts` | `packages/media/src/renderers/builtin/` | ⚠️ If custom parsing | Custom config parsing |
| `DashboardRenderer.ts` | `packages/media/src/renderers/builtin/` | ⚠️ Rarely needed | Only if widget needs custom grid defaults (colspan/rowspan), special positioning, or dashboard-only behavior. Most widgets work automatically via WidgetRegistry. |
| `vscode-integrator.ts` | `packages/media/src/` | ⚠️ If VS Code commands | VS Code integration |
| `EditorPanel.ts` | `src/app/` | ⚠️ If VS Code commands | Command handlers |
| `WidgetCommandProvider.ts` | `src/commands/` | ⚠️ If VS Code commands | Command palette |
| `package.json` | Root | ⚠️ If VS Code commands | Command registration |
| `<WidgetName> Demo.md` | `demo-workspace/` | ✅ Yes | Test file |

---

#### Epic 1.4: Testing

**Task 1.4.1: Create test markdown file**

- **Assignee:** QA/Developer
- **Deliverables:** Test file in `demo-workspace/`
- **Dependencies:** Task 1.3.1
- **Estimate:** 0.5 hours
- **Priority:** P1

**File:** `demo-workspace/<widgetname> Demo.md`

```markdown
# <widgetname> Widget Demo

## Basic Usage

\`\`\`widget
type: <widget-type>
title: My <widgetname>
\`\`\`

## Small Size

\`\`\`widget
type: <widget-type>
title: Small Widget
size: sm
\`\`\`

## Medium Size

\`\`\`widget
type: <widget-type>
title: Medium Widget
size: md
\`\`\`

## Large Size

\`\`\`widget
type: <widget-type>
title: Large Widget
size: lg
\`\`\`

## With Custom Config

\`\`\`widget
type: <widget-type>
title: Custom Configuration
<config-option-1>: <value>
<config-option-2>: <value>
\`\`\`

## With Data

\`\`\`widget
type: <widget-type>
title: With Data
---
<data-key>: <data-value>
<data-key-2>: <data-value-2>
\`\`\`

## Multiple Instances

\`\`\`widget
type: <widget-type>
title: Instance 1
\`\`\`

\`\`\`widget
type: <widget-type>
title: Instance 2
\`\`\`
```

**Task 1.4.2: Verify widget functionality**

- **Assignee:** QA/Developer
- **Dependencies:** Task 1.4.1
- **Estimate:** 1 hour
- **Priority:** P0

**Verification Checklist:**

- [ ]  **Rendering**

  - [ ]  Widget renders in markdown preview
  - [ ]  Widget appears in correct position
  - [ ]  No console errors during render
- [ ]  **Configuration**

  - [ ]  All config options work correctly
  - [ ]  Default values apply when config missing
  - [ ]  Size variants (sm/md/lg) render correctly
- [ ]  **Interactions**

  - [ ]  Clicking/typing works in widget
  - [ ]  Interactions don't break Vditor editing
  - [ ]  No event propagation to Vditor
- [ ]  **Settings Panel**

  - [ ]  Settings gear icon appears
  - [ ]  Settings panel opens correctly
  - [ ]  Settings fields show current values
  - [ ]  Saving updates widget
  - [ ]  Saving updates code block
  - [ ]  Closing without saving discards changes
- [ ]  **Persistence**

  - [ ]  Data changes update code block
  - [ ]  Config changes update code block
  - [ ]  Reloading file restores widget state
- [ ]  **Theming**

  - [ ]  Widget uses VSCode theme colors
  - [ ]  Colors change when theme changes
  - [ ]  Widget readable in light/dark themes
- [ ]  **Multiple Instances**

  - [ ]  Multiple widgets work independently
  - [ ]  No ID conflicts
  - [ ]  Each widget maintains separate state

---

### Phase 2: Documentation (Optional)

**Task 2.1: Add widget documentation**

- **Assignee:** Developer
- **Estimate:** 0.5 hours
- **Priority:** P2

Add section to main README or create widget-specific docs.

---

## Input Parameters for AI Agent

When creating a new widget, the AI agent should request the following parameters from the user:

### Required Parameters


| Parameter     | Type   | Description                             | Example                                                                             |
| ------------- | ------ | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `widgetType`  | string | Type identifier (lowercase, hyphenated) | `"countdown"`, `"quote"`, `"timer"`                                                 |
| `displayName` | string | Human-readable widget name              | `"Countdown Timer"`, `"Quote Display"`                                              |
| `description` | string | Brief description (1-2 sentences)       | `"Display countdown to a target date"`                                              |
| `category`    | enum   | Widget category                         | `"time"`, `"data"`, `"info"`, `"productivity"`, `"finance"`, `"input"`, `"example"` |

### Optional Parameters


| Parameter       | Type                | Description                       | Default |
| --------------- | ------------------- | --------------------------------- | ------- |
| `configOptions` | ConfigOption[]      | List of configuration options     | `[]`    |
| `dataStructure` | DataField[]         | Structure of persistent data      | `{}`    |
| `hasSettings`   | boolean             | Whether to include settings panel | `true`  |
| `defaultSize`   | 'sm'\| 'md' \| 'lg' | Default widget size               | `"sm"`  |
| `features`      | string[]            | List of features to implement     | `[]`    |

### Config Option Structure

```typescript
interface ConfigOption {
  key: string;           // e.g., "showProgress"
  type: 'text' | 'number' | 'select' | 'checkbox' | 'color';
  label: string;         // e.g., "Show Progress Bar"
  defaultValue: any;     // e.g., true
  placeholder?: string;  // For text inputs
  helpText?: string;     // Optional help text
  
  // For select type
  options?: { value: string; label: string }[];
  
  // For number type
  min?: number;
  max?: number;
  step?: number;
}
```

### Data Field Structure

```typescript
interface DataField {
  key: string;           // e.g., "tasks"
  type: string;          // TypeScript type: "string", "number", "Task[]", etc.
  description: string;   // Field description
  required?: boolean;    // Whether field is required
  defaultValue?: any;    // Default value if not provided
}
```

### Example Agent Prompt

```
Create a new widget with the following parameters:

Required:
- widgetType: "countdown"
- displayName: "Countdown Timer"
- description: "Display a countdown to a target date with customizable format"
- category: "time"

Optional:
- configOptions:
  - { key: "targetDate", type: "text", label: "Target Date", placeholder: "YYYY-MM-DD" }
  - { key: "showDays", type: "checkbox", label: "Show Days", defaultValue: true }
  - { key: "showHours", type: "checkbox", label: "Show Hours", defaultValue: true }
- dataStructure:
  - { key: "targetDate", type: "string", description: "ISO date string", required: true }
- defaultSize: "sm"
- features: ["Real-time countdown", "Multiple time units", "Custom formatting"]
```

---

## Data Model

### Widget Configuration (Parsed from Code Block)

```typescript
interface ParsedWidgetConfig {
  // Core fields (auto-generated or parsed)
  type: string;           // Required: widget type
  id: string;             // Auto-generated unique ID
  
  // Common fields (optional)
  title?: string;         // Display title
  size?: 'sm' | 'md' | 'lg';
  
  // Widget-specific fields
  [key: string]: any;     // Additional config from code block
}
```

### Widget Data (Parsed from Code Block)

```typescript
interface WidgetData {
  // Widget-specific data fields
  [key: string]: any;
  
  // Internal metadata (added by system)
  _config?: any;          // Config embedded for emitUpdate
}
```

### Persistence Format

Widget code blocks use YAML-like format with `---` separator:

```yaml
# Configuration section (above ---)
type: <widget-type>
title: <title>
size: sm|md|lg
<config-key>: <value>
<config-key-2>: <value>

# Separator
---

# Data section (below ---)
<data-key>: <value>
<data-key-2>: <value>
```

**Parsing Rules:**

- Lines before `---`: Configuration
- Lines after `---`: Data
- Simple key-value pairs: `key: value`
- Nested objects: Indented YAML-like syntax (limited support)
- Arrays: JSON format or YAML-like list syntax

**Example:**

```yaml
type: productivity
title: My Tasks
showProgress: true
maxTasks: 20
---
tasks:
  - id: "1"
    text: "Review code"
    completed: true
  - id: "2"
    text: "Write tests"
    completed: false
```

---

## APIs and Contracts

### ReactWidgetProps Interface

```typescript
interface ReactWidgetProps {
  config: IWidgetConfig;      // Widget configuration
  data?: any;                  // Persisted data from code block
  onUpdate?: (data: any) => void;  // Callback for data changes
  onError?: (error: Error) => void;  // Error handler (optional)
}
```

**Usage:**

```typescript
export const MyWidget: React.FC<ReactWidgetProps> = ({ config, data, onUpdate }) => {
  // Implementation
};
```

---

### Widget Update Event

To trigger persistence to the markdown code block, dispatch this custom event:

```typescript
// Event type
interface WidgetUpdateEvent {
  type: string;           // Event type descriptor
  data: any;              // Updated data to persist
  config?: any;           // Updated config (optional)
  widgetId: string;       // Widget instance ID
}

// Dispatch event
const event = new CustomEvent('widget-update', {
  bubbles: true,
  detail: {
    type: 'data-change',  // or 'settings-change', 'task-toggle', etc.
    data: { /* persistable data */ },
    config: { /* updated config */ },
    widgetId: (config as any).id,
  },
});
document.dispatchEvent(event);
```

**Event Flow:**

1. Widget component dispatches `widget-update` event
2. Event bubbles to document
3. `WidgetRenderer` catches event (listener on document)
4. `WidgetRenderer` serializes data/config to YAML format
5. `WidgetRenderer` updates code block via Vditor API
6. Vditor syncs changes to VS Code
7. File is marked as modified

---

### Widget Registry API

```typescript
interface WidgetRegistry {
  // Register a new widget
  register(definition: WidgetDefinition): void;
  
  // Create widget instance
  create(config: IWidgetConfig): HTMLElement | null;
  
  // Get widget definition
  getDefinition(type: string): WidgetDefinition | undefined;
  
  // Check if widget type exists
  has(type: string): boolean;
}

interface WidgetDefinition {
  type: string;           // Widget type identifier
  displayName: string;    // Human-readable name
  description?: string;   // Brief description
  category?: string;      // Widget category
  icon?: string;          // Icon (emoji or icon name)
  defaultConfig?: Partial<IWidgetConfig>;
  
  // React component definition
  reactComponent?: WidgetComponentDefinition;
}
```

---

### UI Component APIs

**Widget Container:**

```typescript
<Widget size="sm" | "md" | "lg" design="default" | "minimal" | "glass">
  {children}
</Widget>
```

**Widget Header:**

```typescript
<WidgetHeader style={...}>
  <WidgetTitle>Title</WidgetTitle>
  <SettingsToggle isOpen={bool} onClick={handler} />
</WidgetHeader>
```

**Widget Content:**

```typescript
<WidgetContent style={{ flexDirection: 'column', gap: '8px' }}>
  {/* Main content */}
</WidgetContent>
```

**Widget Footer:**

```typescript
<WidgetFooter>
  {/* Footer content */}
</WidgetFooter>
```

**Label:**

```typescript
<Label 
  variant="default" | "muted" | "productive" | "destructive"
  size="sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl"
>
  Text
</Label>
```

**Button:**

```typescript
<Button 
  variant="default" | "outline" | "ghost" | "secondary"
  size="sm" | "md" | "lg" | "icon"
  onClick={handler}
  disabled={bool}
>
  Label
</Button>
```

**Input:**

```typescript
<Input
  type="text" | "number" | "color"
  value={value}
  onChange={handler}
  placeholder="..."
  min={number}
  max={number}
/>
```

---

## Validation Strategy

### Test Cases


| Test ID | Test                | Description                        | Pass Criteria                                   |
| ------- | ------------------- | ---------------------------------- | ----------------------------------------------- |
| T-1     | Render Test         | Widget appears in markdown preview | Widget visible, no console errors               |
| T-2     | Config Test         | Config from code block applies     | Widget reflects all config values               |
| T-3     | Interaction Test    | User interactions work             | Events fire, UI updates, no Vditor interference |
| T-4     | Persistence Test    | Data saves to code block           | Code block content updates correctly            |
| T-5     | Theme Test          | VSCode theme integration           | Colors match editor theme in light/dark modes   |
| T-6     | Settings Test       | Settings panel works               | Opens, saves, closes, updates code block        |
| T-7     | Multi-Instance Test | Multiple widgets work              | Each widget maintains independent state         |
| T-8     | Size Test           | Size variants work                 | sm/md/lg render at correct sizes                |
| T-9     | Type Safety Test    | TypeScript compiles                | No TS errors, strict mode passes                |
| T-10    | Performance Test    | Widget renders quickly             | < 100ms initial render                          |

### Manual Testing Checklist

**Pre-Testing:**

- [ ]  Build succeeds: `npm run build`
- [ ]  No TypeScript errors
- [ ]  No console warnings

**Functional Testing:**

- [ ]  Widget renders on page load
- [ ]  All config options work
- [ ]  All size variants work
- [ ]  Interactions are responsive
- [ ]  Settings panel functions
- [ ]  Data persists correctly
- [ ]  Multiple instances work
- [ ]  Widget survives page reload

**Visual Testing:**

- [ ]  Layout matches design
- [ ]  Colors match VSCode theme
- [ ]  Typography is consistent
- [ ]  Responsive to container size
- [ ]  No visual glitches

**Edge Cases:**

- [ ]  Empty data handling
- [ ]  Missing config handling
- [ ]  Invalid data handling
- [ ]  Large datasets
- [ ]  Rapid interactions
- [ ]  Theme switching

### Automated Testing (Future)

```typescript
describe('<WidgetName>Widget', () => {
  it('should render with default config', () => {
    // Test implementation
  });
  
  it('should apply custom config', () => {
    // Test implementation
  });
  
  it('should emit update events', () => {
    // Test implementation
  });
  
  it('should persist data changes', () => {
    // Test implementation
  });
});
```

---

## Risks and Mitigations


| Risk                      | Likelihood | Impact | Severity     | Mitigation Strategy                                                        |
| ------------------------- | ---------- | ------ | ------------ | -------------------------------------------------------------------------- |
| Vditor event interference | Medium     | High   | **Critical** | Use event stoppers pattern from existing widgets; test thoroughly          |
| Shadow DOM styling issues | Low        | Medium | **Medium**   | Use inline styles; avoid global CSS; test in different themes              |
| Bundle size growth        | Low        | Low    | **Low**      | Keep widgets lightweight; avoid heavy dependencies; monitor bundle         |
| Performance degradation   | Low        | Medium | **Medium**   | Use React.memo; optimize re-renders; profile with DevTools                 |
| Type safety gaps          | Medium     | Medium | **Medium**   | Use strict TypeScript; add comprehensive types; review types in PR         |
| Breaking changes to API   | Low        | High   | **High**     | Follow semantic versioning; document breaking changes; add migration guide |
| Persistence conflicts     | Low        | High   | **High**     | Test concurrent edits; ensure atomic updates; add conflict detection       |
| Memory leaks              | Low        | Medium | **Medium**   | Clean up in useEffect; remove event listeners; test with many instances    |

---

## Example Implementation

### Example: Creating a "Quote" Widget

Given these parameters:

- **widgetType**: `"quote"`
- **displayName**: `"Quote Display"`
- **description**: `"Display inspirational quotes with author attribution"`
- **category**: `"info"`
- **configOptions**:
  - `{ key: 'fontSize', type: 'select', label: 'Font Size', options: [{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }], defaultValue: 'md' }`
  - `{ key: 'showAuthor', type: 'checkbox', label: 'Show Author', defaultValue: true }`
- **dataStructure**:
  - `{ key: 'text', type: 'string', description: 'Quote text', required: true }`
  - `{ key: 'author', type: 'string', description: 'Quote author', required: false }`

### Implementation Steps

**1. Create `QuoteWidget.tsx`:**

```typescript
/**
 * QuoteWidget - Display inspirational quotes
 * 
 * Features:
 * - Customizable font size
 * - Optional author display
 * - Elegant typography
 */

import React, { useState, useCallback } from 'react';
import { 
  Widget, WidgetHeader, WidgetContent, WidgetFooter,
  WidgetTitle, Label, WidgetSettingsPanel, SettingsToggle
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize } from '../ui/Widget';

export interface QuoteWidgetConfig {
  title?: string;
  size?: WidgetSize;
  fontSize?: 'sm' | 'md' | 'lg';
  showAuthor?: boolean;
}

export interface QuoteWidgetData {
  text: string;
  author?: string;
}

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Quote' },
  { 
    key: 'size', 
    label: 'Size', 
    type: 'select', 
    options: [
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Medium' },
      { value: 'lg', label: 'Large' },
    ],
    defaultValue: 'sm'
  },
  {
    key: 'fontSize',
    label: 'Font Size',
    type: 'select',
    options: [
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Medium' },
      { value: 'lg', label: 'Large' },
    ],
    defaultValue: 'md'
  },
  { key: 'showAuthor', label: 'Show Author', type: 'checkbox', defaultValue: true },
];

export const QuoteWidget: React.FC<ReactWidgetProps> = ({ 
  config, 
  data, 
  onUpdate
}) => {
  const widgetConfig = config as unknown as QuoteWidgetConfig;
  const widgetData = data as QuoteWidgetData | undefined;
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<QuoteWidgetConfig>(widgetConfig);
  
  const title = localConfig.title || 'Quote';
  const size = localConfig.size || 'md';
  const fontSize = localConfig.fontSize || 'md';
  const showAuthor = localConfig.showAuthor !== false;
  
  const quoteText = widgetData?.text || 'No quote provided';
  const author = widgetData?.author;
  
  const emitUpdate = useCallback((
    updatedData: QuoteWidgetData, 
    updatedConfig?: QuoteWidgetConfig
  ) => {
    if (onUpdate) {
      onUpdate({ ...updatedData, _config: updatedConfig || localConfig });
    }
  
    const customEvent = new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'data-change',
        data: updatedData,
        config: updatedConfig || localConfig,
        widgetId: (config as any).id,
      },
    });
    document.dispatchEvent(customEvent);
  }, [onUpdate, localConfig, config]);

  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = { ...localConfig, ...newConfig } as QuoteWidgetConfig;
    setLocalConfig(updatedConfig);
    emitUpdate(widgetData || { text: quoteText }, updatedConfig);
  }, [localConfig, widgetData, quoteText, emitUpdate]);
  
  const fontSizeMap = {
    sm: 'md' as const,
    md: 'lg' as const,
    lg: 'xl' as const,
  };

  return (
    <Widget size={size} design="default" style={{ position: 'relative' }}>
      <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <WidgetTitle>{title}</WidgetTitle>
        <SettingsToggle 
          isOpen={isSettingsOpen} 
          onClick={() => setIsSettingsOpen(!isSettingsOpen)} 
        />
      </WidgetHeader>

      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Quote Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      <WidgetContent style={{ 
        flexDirection: 'column', 
        padding: '16px',
        textAlign: 'center'
      }}>
        <Label size={fontSizeMap[fontSize]} style={{ 
          fontStyle: 'italic',
          lineHeight: '1.6'
        }}>
          "{quoteText}"
        </Label>
      </WidgetContent>

      {showAuthor && author && (
        <WidgetFooter style={{ justifyContent: 'center' }}>
          <Label variant="muted" size="sm">— {author}</Label>
        </WidgetFooter>
      )}
    </Widget>
  );
};
```

**2. Register in `registerWidgets.ts`:**

```typescript
import { QuoteWidget } from './QuoteWidget';

// In registerCoreWidgets():
registry.register({
  type: 'quote',
  displayName: 'Quote Display',
  description: 'Display inspirational quotes with author attribution',
  category: 'info',
  reactComponent: {
    component: QuoteWidget,
    tagName: 'quote-widget',
    displayName: 'Quote Display'
  }
});
```

**3. Export in `widgets/index.ts`:**

```typescript
export { QuoteWidget } from './QuoteWidget';
export type { QuoteWidgetConfig, QuoteWidgetData } from './QuoteWidget';
```

**4. Create test file `demo-workspace/Quote Demo.md`:**

```markdown
# Quote Widget Demo

## Basic Quote

\`\`\`widget
type: quote
title: Daily Quote
---
text: The only way to do great work is to love what you do.
author: Steve Jobs
\`\`\`

## Large Quote

\`\`\`widget
type: quote
title: Inspiration
size: lg
fontSize: lg
---
text: Be yourself; everyone else is already taken.
author: Oscar Wilde
\`\`\`

## Quote Without Author

\`\`\`widget
type: quote
showAuthor: false
---
text: Success is not final, failure is not fatal.
\`\`\`
```

**5. Test the widget:**

- Open `Quote Demo.md` in editor
- Verify all three quotes render
- Test settings panel
- Verify persistence

---

## Traceability Matrices

### Requirement → Task Mapping


| Requirement ID                     | Related Tasks       | Status |
| ---------------------------------- | ------------------- | ------ |
| FR-1: Widget renders in code block | 1.2.1, 1.2.2        | ✅     |
| FR-2: Config from YAML syntax      | 1.1.1, 1.1.2        | ✅     |
| FR-3: Interactions emit events     | 1.1.2               | ✅     |
| FR-4: Settings panel works         | 1.1.2               | ✅     |
| FR-5: VSCode theme colors          | 1.1.1               | ✅     |
| FR-6: Multiple sizes               | 1.1.1, 1.1.2        | ✅     |
| FR-7: Data persistence             | 1.1.2               | ✅     |
| **Context menu insert**            | **1.3.1**           | ✅     |
| **Dashboard support**              | **1.3.3**           | ✅     |
| **VS Code command integration**    | **1.3.4**           | ⚠️ Optional |

### Requirement → Test Mapping


| Requirement ID     | Test Cases             | Verification Method       |
| ------------------ | ---------------------- | ------------------------- |
| FR-1               | T-1 (Render Test)      | Visual inspection         |
| FR-2               | T-2 (Config Test)      | Config value verification |
| FR-3               | T-3 (Interaction Test) | Event monitoring          |
| FR-4               | T-6 (Settings Test)    | Settings panel testing    |
| FR-5               | T-5 (Theme Test)       | Theme switching           |
| FR-6               | T-8 (Size Test)        | Size variant testing      |
| FR-7               | T-4 (Persistence Test) | Code block inspection     |
| Context menu       | T-11 (Insert Test)     | Context menu verification |
| Dashboard support  | T-12 (Dashboard Test)  | Dashboard grid testing    |

### Task Dependencies

```
Task 1.1.1 (Create file)
  ↓
Task 1.1.2 (Implement logic)
  ↓
Task 1.2.1 (Register widget)
  ↓
Task 1.2.2 (Export widget)
  ↓
┌─────────────────────────────────────────┐
│          INTEGRATION TASKS              │
│                                         │
│  Task 1.3.1 (Context menu - main.ts)    │  ← CRITICAL
│  Task 1.3.2 (WidgetRenderer - optional) │
│  Task 1.3.3 (DashboardRenderer - opt.)  │
│  Task 1.3.4 (VS Code commands - opt.)   │
└─────────────────────────────────────────┘
  ↓
Task 1.4.1 (Create test file)
  ↓
Task 1.4.2 (Verify functionality)
```

---

## Quality Checks

### Pre-Implementation Checklist

- [X]  All required parameters collected
- [X]  Widget type name validated (lowercase, hyphenated)
- [X]  Category selected from valid options
- [X]  Config options defined with types
- [X]  Data structure documented

### Implementation Checklist

**Core Widget Implementation:**

- [ ]  Widget file created in correct location (`packages/widgets/src/widgets/<widgetname>Widget.tsx`)
- [ ]  All required imports added
- [ ]  Type interfaces defined with JSDoc (`<widgetname>WidgetConfig`, `<widgetname>WidgetData`)
- [ ]  Settings fields configured (`settingsFields` array)
- [ ]  State management implemented (useState, useEffect, useCallback)
- [ ]  Event handlers implemented with useCallback
- [ ]  emitUpdate called on data changes
- [ ]  UI components used correctly (Widget, WidgetHeader, WidgetContent, etc.)
- [ ]  VSCode theme variables used for colors

**Widget Registration:**

- [ ]  Widget imported in `registerWidgets.ts`
- [ ]  Widget registered with correct type, displayName, description, category
- [ ]  Widget exported from `widgets/index.ts`
- [ ]  TypeScript compiles without errors

**Editor Integration (CRITICAL):**

- [ ]  📋 **Context Menu Updated** (`packages/media/src/main.ts`)
  - [ ]  Template added to `insertWidgetDirect()` templates object
  - [ ]  Menu item added to `buildVSCodeContextMenu()` Insert submenu
- [ ]  📋 **WidgetRenderer** - Verify widget parsing works (usually automatic)
- [ ]  📋 **DashboardRenderer** - Test widget works in dashboard grids (usually automatic)
- [ ]  📋 **VS Code Commands** (if applicable):
  - [ ]  Command handler in `EditorPanel.ts`
  - [ ]  Command registered in `package.json`
  - [ ]  Command added to `WidgetCommandProvider.ts`

**Testing:**

- [ ]  Test markdown file created (`demo-workspace/<WidgetName> Demo.md`)
- [ ]  Widget renders correctly via code block
- [ ]  Widget renders correctly via context menu insert
- [ ]  Widget renders correctly in dashboard
- [ ]  All size variants work (sm/md/lg)
- [ ]  Config options work
- [ ]  Data persistence works
- [ ]  Settings panel works
- [ ]  Multiple instances work
- [ ]  Theme integration works
- [ ]  No console errors

### Testing Checklist

- [ ]  Test markdown file created
- [ ]  Basic usage works
- [ ]  All size variants work
- [ ]  Config options work
- [ ]  Data persistence works
- [ ]  Settings panel works
- [ ]  Multiple instances work
- [ ]  Theme integration works
- [ ]  No console errors
- [ ]  Performance acceptable

### Code Review Checklist

- [ ]  Follows existing patterns
- [ ]  Code is readable and maintainable
- [ ]  TypeScript types are correct
- [ ]  No unnecessary dependencies
- [ ]  Event handlers properly memoized
- [ ]  No memory leaks (cleanup in useEffect)
- [ ]  Documentation comments present
- [ ]  Error handling implemented
- [ ]  Edge cases handled

---

## Appendix

### Available Widget Categories

- `time` - Time-related widgets (clock, calendar, timer, countdown)
- `data` - Data visualization (chart, table, graph)
- `info` - Information display (weather, stock, quote, news)
- `finance` - Financial widgets (stock, crypto, budget)
- `productivity` - Productivity tools (tasks, notes, kanban)
- `input` - Input/form widgets (form, survey, calculator)
- `example` - Example/demo widgets (hello-world)

### VSCode Theme Variables Reference

```css
/* Background colors */
--vscode-editor-background
--vscode-sideBar-background
--vscode-panel-background
--vscode-editorWidget-background

/* Foreground colors */
--vscode-editor-foreground
--vscode-descriptionForeground

/* Border colors */
--vscode-panel-border
--vscode-widget-border

/* Button colors */
--vscode-button-background
--vscode-button-foreground
--vscode-button-hoverBackground

/* Status colors */
--vscode-errorForeground
--vscode-testing-iconPassed    /* Green */
--vscode-testing-iconFailed    /* Red */

/* Input colors */
--vscode-input-background
--vscode-input-foreground
--vscode-input-border
--vscode-inputValidation-errorBackground

/* Progress */
--vscode-progressBar-background

/* Selection */
--vscode-selection-background
```

### Useful React Hooks

```typescript
// State management
const [state, setState] = useState(initialValue);

// Side effects (data fetching, subscriptions)
useEffect(() => {
  // Effect logic
  return () => {
    // Cleanup
  };
}, [dependencies]);

// Memoized callbacks (performance)
const memoizedCallback = useCallback(() => {
  // Callback logic
}, [dependencies]);

// Memoized values (performance)
const memoizedValue = useMemo(() => {
  // Compute value
  return value;
}, [dependencies]);

// Refs (DOM access, mutable values)
const ref = useRef(initialValue);
```

### Common Patterns

**Data fetching pattern:**

```typescript
useEffect(() => {
  if (widgetData) {
    // Update local state from external data
    setLocalState(widgetData.someField);
  }
}, [widgetData]);
```

**Update emission pattern:**

```typescript
const emitUpdate = useCallback((updatedData, updatedConfig?) => {
  if (onUpdate) {
    onUpdate({ ...updatedData, _config: updatedConfig || localConfig });
  }
  
  document.dispatchEvent(new CustomEvent('widget-update', {
    bubbles: true,
    detail: {
      type: 'data-change',
      data: updatedData,
      config: updatedConfig || localConfig,
      widgetId: (config as any).id,
    },
  }));
}, [onUpdate, localConfig, config]);
```

**Settings save pattern:**

```typescript
const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
  const updatedConfig = { ...localConfig, ...newConfig };
  setLocalConfig(updatedConfig);
  emitUpdate(currentData, updatedConfig);
}, [localConfig, currentData, emitUpdate]);
```

---

## Document History


| Version | Date       | Author           | Changes                                                |
| ------- | ---------- | ---------------- | ------------------------------------------------------ |
| 1.0     | 2025-12-03 | Development Team | Initial creation                                       |
| 1.1     | 2025-12-03 | Development Team | Added Editor Integration Points section (Epic 1.3)     |
|         |            |                  | - Context menu updates (main.ts)                       |
|         |            |                  | - WidgetRenderer notes                                 |
|         |            |                  | - DashboardRenderer integration                        |
|         |            |                  | - VS Code command integration                          |
|         |            |                  | Added comprehensive implementation checklist           |
|         |            |                  | Updated task dependencies diagram                      |
| 1.2     | 2025-12-03 | Development Team | Added wigggle-ui component library reference           |
|         |            |                  | - Added UI Component Library section with guidelines   |
|         |            |                  | - Added wigggle-ui registry reference for examples     |
|         |            |                  | - Updated Task 1.1.2 with wigggle-ui check requirement |
|         |            |                  | - Added consistency checklist for styling              |

---

## References

- [wigggle-ui Component Library](https://github.com/wigggle-ui/ui/) - **Primary UI reference**
- [wigggle-ui Widget Examples](https://github.com/wigggle-ui/ui/tree/main/registry/default/widgets) - Reference implementations
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Web Components](https://developer.mozilla.org/en-US/docs/Web/Web_Components)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [Vditor Documentation](https://github.com/Vanessa219/vditor)

---

**End of Document**

</title></widget-type></widget-type></widget-type></data-value-2></data-key-2></data-value></data-key></widget-type></value></config-option-2></value></config-option-1></widget-type></widget-type></widget-type></widget-type></widgetname></widget-type></widgetname></widgetname></widgetname></widgetname></widgetname></widgetname></widgetname></widget></widget-type></widgetname></category></brief></widget></widget-type></widgetname></widgetname></widgetname></widgetname></string,></widgetname></widgetname></default></widgetname></widgetname></widgetname></reactwidgetprops></widgetname></default>
