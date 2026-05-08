# Macro Board Widget Demo

The Macro Board widget creates a Stream Deck style grid for launching VS Code commands or macro extension commands from a markdown widget block.

## Default 3x3 Deck

```widget
type: macro-board
title: Stream Deck
size: md
rows: 3
columns: 3
```

## Compact 2x2 Deck

```widget
type: macro-board
title: Daily Actions
size: sm
rows: 2
columns: 2
buttons: [{"id":"commands","label":"Commands","icon":"bolt","command":"workbench.action.showCommands","tone":"accent"},{"id":"daily-note","label":"Daily Note","icon":"calendar","command":"markdown-editor.openDailyNote"},{"id":"settings","label":"Settings","icon":"sliders","command":"workbench.action.openSettings"},{"id":"save-all","label":"Save All","icon":"camera","command":"workbench.action.files.saveAll"}]
```

## Larger 4x4 Deck

```widget
type: macro-board
title: Creator Deck
size: lg
rows: 4
columns: 4
```

## Custom Commands

```widget
type: macro-board
title: Project Controls
size: md
rows: 2
columns: 3
buttons: [{"id":"open-commands","label":"GO LIVE","icon":"bolt","command":"workbench.action.showCommands","tone":"danger"},{"id":"main-scene","label":"MAIN SCENE","icon":"layers","command":"workbench.action.focusSideBar"},{"id":"chat-focus","label":"CHAT FOCUS","icon":"chat","command":"workbench.panel.chat.view.copilot.focus"},{"id":"spotify","label":"SPOTIFY","icon":"sparkles","command":"workbench.action.quickOpen"},{"id":"run-dev","label":"RUN DEV","icon":"code","command":"workbench.action.terminal.toggleTerminal"},{"id":"more","label":"MORE","icon":"sliders","command":"workbench.action.openSettings","tone":"success"}]
---
data: {"executionCounts":{"open-commands":2},"lastExecutedButtonId":"open-commands","lastExecutedAt":"2026-04-01T12:00:00.000Z"}
```

## Notes

- Edit the widget settings to change the rows, columns, and button JSON.
- Each button supports `id`, `label`, `icon`, `command`, `args`, and `tone`.
- Command values can target built-in VS Code commands or macro extension commands.