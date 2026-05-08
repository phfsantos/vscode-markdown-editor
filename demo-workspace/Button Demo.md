# Button Widget Demo

The Button Widget allows you to create interactive action buttons that can execute VS Code commands, send data to other widgets, or trigger custom events.

## Basic Button

A simple button that logs a value when clicked:

```widget
type: button
title: Basic Button
label: Click Me
action: my-action
actionType: value
value: Hello World
fullWidth: true
```

## Button Without Title (Minimal)

A button without header - shows settings toggle in corner:

```widget
type: button
label: Minimal Button
action: minimal-click
actionType: value
value: Clicked!
fullWidth: true
variant: outline
```

## Button Variants

### Default (Primary)

```widget
type: button
label: Primary Button
action: primary-action
variant: default
fullWidth: true
```

### Outline

```widget
type: button
label: Outline Button
action: outline-action
variant: outline
fullWidth: true
```

### Ghost

```widget
type: button
label: Ghost Button
action: ghost-action
variant: ghost
fullWidth: true
```

### Secondary

```widget
type: button
label: Secondary Button
action: secondary-action
variant: secondary
fullWidth: true
```

### Destructive (Red)

```widget
type: button
label: Delete Item
action: delete-action
variant: destructive
fullWidth: true
```

## VS Code Command Button

Execute VS Code commands directly:

### Open Settings

```widget
type: button
title: VS Code Actions
label: Open Settings
action: open-settings
actionType: vscode-command
data: {"command": "workbench.action.openSettings"}
variant: default
fullWidth: true
```

### Open Command Palette

```widget
type: button
label: Command Palette
action: command-palette
actionType: vscode-command
data: {"command": "workbench.action.showCommands"}
variant: outline
fullWidth: true
```

### Toggle Sidebar

```widget
type: button
label: Toggle Sidebar
action: toggle-sidebar
actionType: vscode-command
data: {"command": "workbench.action.toggleSidebarVisibility"}
variant: ghost
fullWidth: true
```

## Button with Input Field

Collect user input before executing action:

```widget
type: button
title: Add Task
label: Add
action: add-task
actionType: widget-action
targetWidget: productivity
showInput: true
inputLabel: Task Description
inputPlaceholder: Enter a new task...
fullWidth: true
```

## Size Variants

### Small

```widget
type: button
label: Small Button
size: sm
action: small-action
fullWidth: true
```

### Medium

```widget
type: button
label: Medium Button
size: md
action: medium-action
fullWidth: true
```

### Large

```widget
type: button
label: Large Button
size: lg
action: large-action
fullWidth: true
```

## Design Variants

### Default Design

```widget
type: button
label: Default Design
design: default
action: design-default
fullWidth: true
```

### Minimal Design

```widget
type: button
label: Minimal Design
design: minimal
action: design-minimal
fullWidth: true
```

### Glass Design

```widget
type: button
label: Glass Design
design: glass
action: design-glass
fullWidth: true
```

## Widget-to-Widget Communication

Connect button to Productivity widget to add tasks:

First, add a productivity widget:

```widget
type: productivity
title: My Tasks
```

Then, use a button to add tasks to it:

```widget
type: button
title: Quick Add Task
label: Add "Review Code"
action: add-task
actionType: widget-action
targetWidget: productivity
data: {"action": "add-task", "text": "Review code changes"}
variant: default
fullWidth: true
```

## Data Action (JSON)

Send structured data with the action:

```widget
type: button
title: Send Data
label: Submit Form Data
action: submit-form
actionType: data
data: {"name": "John Doe", "email": "john@example.com", "preferences": {"theme": "dark", "notifications": true}}
variant: default
fullWidth: true
```

## Execution Counter

Buttons track how many times they've been clicked and show the last execution time in the footer. Try clicking any button multiple times to see the counter update!

