# Dev Commands Widget Demo

A developer commands panel for running VS Code commands and macros. Three preset grid sizes.

## Small (2x2)

```widget
type: dev-commands
title: Quick Actions
gridSize: 2x2
```

## Medium (4x4)

```widget
type: dev-commands
title: Dev Commands
gridSize: 4x4
```

## Large (6x6)

```widget
type: dev-commands
title: Full Developer Panel
gridSize: 6x6
```

## Custom Commands

```widget
type: dev-commands
title: My Workflow
gridSize: 2x2
commands: [{"id":"palette","label":"Palette","icon":"palette","command":"workbench.action.showCommands"},{"id":"terminal","label":"Terminal","icon":"terminal","command":"workbench.action.terminal.toggleTerminal"},{"id":"format","label":"Format","icon":"format","command":"editor.action.formatDocument"},{"id":"save","label":"Save","icon":"save","command":"workbench.action.files.saveAll"}]
```
