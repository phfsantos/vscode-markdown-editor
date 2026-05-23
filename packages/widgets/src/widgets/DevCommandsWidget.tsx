/**
 * DevCommandsWidget - Developer commands panel.
 *
 * Stream Deck style launcher of VS Code commands and macros, with three
 * preset grid sizes (2x2, 4x4, 6x6) modeled after iOS-style widget tiles.
 * Each tile dispatches a VS Code command through the existing widget action
 * bridge (`button-action` / `widget-action` postMessage).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Widget,
  WidgetHeader,
  WidgetTitle,
  WidgetContent,
  WidgetFooter,
  Label,
  Button,
  Input,
  SettingsToggle,
  WidgetSettingsPanel,
  useSettingsContext,
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';

export type DevCommandsGridSize = '2x2' | '4x4' | '6x6';

export interface DevCommand {
  id: string;
  label: string;
  command: string;
  /** Icon keyword from the built-in registry, or any short text/emoji fallback. */
  icon?: string;
  args?: unknown[];
}

export interface DevCommandsWidgetConfig {
  title?: string;
  gridSize?: DevCommandsGridSize;
  commands?: DevCommand[];
}

export interface DevCommandsWidgetData {
  executionCounts?: Record<string, number>;
  lastExecutedId?: string;
  lastExecutedAt?: string;
}

const GRID_DIMENSIONS: Record<DevCommandsGridSize, number> = {
  '2x2': 2,
  '4x4': 4,
  '6x6': 6,
};

const CONTAINER_WIDTH: Record<DevCommandsGridSize, number> = {
  '2x2': 220,
  '4x4': 360,
  '6x6': 480,
};

const DEFAULT_COMMANDS_2X2: DevCommand[] = [
  { id: 'terminal', label: 'Terminal', icon: 'terminal', command: 'workbench.action.terminal.toggleTerminal' },
  { id: 'run', label: 'Run', icon: 'run', command: 'workbench.action.debug.run' },
  { id: 'debug', label: 'Debug', icon: 'debug', command: 'workbench.action.debug.start' },
  { id: 'settings', label: 'Settings', icon: 'settings', command: 'workbench.action.openSettings' },
];

const DEFAULT_COMMANDS_4X4: DevCommand[] = [
  { id: 'explorer', label: 'Explorer', icon: 'explorer', command: 'workbench.view.explorer' },
  { id: 'search', label: 'Search', icon: 'search', command: 'workbench.view.search' },
  { id: 'source-control', label: 'Source Control', icon: 'source-control', command: 'workbench.view.scm' },
  { id: 'extensions', label: 'Extensions', icon: 'extensions', command: 'workbench.view.extensions' },
  { id: 'problems', label: 'Problems', icon: 'problems', command: 'workbench.actions.view.problems' },
  { id: 'output', label: 'Output', icon: 'output', command: 'workbench.action.output.toggleOutput' },
  { id: 'git', label: 'Git', icon: 'git', command: 'git.openChange' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', command: 'workbench.action.terminal.toggleTerminal' },
  { id: 'run', label: 'Run', icon: 'run', command: 'workbench.action.debug.run' },
  { id: 'debug', label: 'Debug', icon: 'debug', command: 'workbench.action.debug.start' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', command: 'workbench.action.tasks.runTask' },
  { id: 'palette', label: 'Palette', icon: 'palette', command: 'workbench.action.showCommands' },
  { id: 'quick-open', label: 'Quick Open', icon: 'search', command: 'workbench.action.quickOpen' },
  { id: 'sidebar', label: 'Sidebar', icon: 'sidebar', command: 'workbench.action.toggleSidebarVisibility' },
  { id: 'theme', label: 'Theme', icon: 'theme', command: 'workbench.action.selectTheme' },
  { id: 'save-all', label: 'Save All', icon: 'save', command: 'workbench.action.files.saveAll' },
];

const DEFAULT_COMMANDS_6X6: DevCommand[] = [
  ...DEFAULT_COMMANDS_4X4,
  { id: 'reload', label: 'Reload', icon: 'reload', command: 'workbench.action.reloadWindow' },
  { id: 'new-file', label: 'New File', icon: 'new-file', command: 'workbench.action.files.newUntitledFile' },
  { id: 'open-file', label: 'Open File', icon: 'open-file', command: 'workbench.action.files.openFile' },
  { id: 'close-editor', label: 'Close', icon: 'close', command: 'workbench.action.closeActiveEditor' },
  { id: 'split-editor', label: 'Split', icon: 'split', command: 'workbench.action.splitEditor' },
  { id: 'zen', label: 'Zen Mode', icon: 'zen', command: 'workbench.action.toggleZenMode' },
  { id: 'format', label: 'Format', icon: 'format', command: 'editor.action.formatDocument' },
  { id: 'comment', label: 'Comment', icon: 'comment', command: 'editor.action.commentLine' },
  { id: 'rename', label: 'Rename', icon: 'rename', command: 'editor.action.rename' },
  { id: 'goto-def', label: 'Go to Def', icon: 'goto', command: 'editor.action.revealDefinition' },
  { id: 'references', label: 'References', icon: 'references', command: 'editor.action.goToReferences' },
  { id: 'breakpoint', label: 'Breakpoint', icon: 'breakpoint', command: 'editor.debug.action.toggleBreakpoint' },
  { id: 'step-over', label: 'Step Over', icon: 'step-over', command: 'workbench.action.debug.stepOver' },
  { id: 'continue', label: 'Continue', icon: 'continue', command: 'workbench.action.debug.continue' },
  { id: 'stop', label: 'Stop', icon: 'stop', command: 'workbench.action.debug.stop' },
  { id: 'git-pull', label: 'Pull', icon: 'pull', command: 'git.pull' },
  { id: 'git-push', label: 'Push', icon: 'push', command: 'git.push' },
  { id: 'git-commit', label: 'Commit', icon: 'commit', command: 'git.commitStaged' },
  { id: 'git-branch', label: 'Branches', icon: 'branch', command: 'git.checkout' },
  { id: 'keybindings', label: 'Keys', icon: 'keys', command: 'workbench.action.openGlobalKeybindings' },
];

const DEFAULT_COMMANDS: Record<DevCommandsGridSize, DevCommand[]> = {
  '2x2': DEFAULT_COMMANDS_2X2,
  '4x4': DEFAULT_COMMANDS_4X4,
  '6x6': DEFAULT_COMMANDS_6X6,
};

const COMMAND_SUGGESTIONS = [
  { label: 'Command Palette', command: 'workbench.action.showCommands' },
  { label: 'Quick Open', command: 'workbench.action.quickOpen' },
  { label: 'Terminal', command: 'workbench.action.terminal.toggleTerminal' },
  { label: 'Run', command: 'workbench.action.debug.run' },
  { label: 'Debug', command: 'workbench.action.debug.start' },
  { label: 'Settings', command: 'workbench.action.openSettings' },
  { label: 'Explorer', command: 'workbench.view.explorer' },
  { label: 'Search', command: 'workbench.view.search' },
  { label: 'Source Control', command: 'workbench.view.scm' },
  { label: 'Extensions', command: 'workbench.view.extensions' },
  { label: 'Problems', command: 'workbench.actions.view.problems' },
  { label: 'Output', command: 'workbench.action.output.toggleOutput' },
  { label: 'Tasks', command: 'workbench.action.tasks.runTask' },
  { label: 'Save All', command: 'workbench.action.files.saveAll' },
  { label: 'Reload Window', command: 'workbench.action.reloadWindow' },
  { label: 'Format Document', command: 'editor.action.formatDocument' },
  { label: 'Toggle Zen Mode', command: 'workbench.action.toggleZenMode' },
];

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Dev Commands' },
  {
    key: 'gridSize',
    label: 'Grid Size',
    type: 'select',
    options: [
      { value: '2x2', label: 'Small (2x2)' },
      { value: '4x4', label: 'Medium (4x4)' },
      { value: '6x6', label: 'Large (6x6)' },
    ],
    defaultValue: '4x4',
  },
];

const isGridSize = (value: unknown): value is DevCommandsGridSize => {
  return value === '2x2' || value === '4x4' || value === '6x6';
};

const sanitizeCommands = (value: unknown): DevCommand[] | undefined => {
  let parsed = value;

  if (typeof parsed === 'string' && parsed.trim()) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }

  if (!Array.isArray(parsed)) {
    return undefined;
  }

  return parsed.map((raw, index) => {
    const candidate = raw && typeof raw === 'object' ? raw as Partial<DevCommand> : {};
    return {
      id: typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `cmd-${index + 1}`,
      label: typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label.trim()
        : `Command ${index + 1}`,
      command: typeof candidate.command === 'string' ? candidate.command.trim() : '',
      icon: typeof candidate.icon === 'string' && candidate.icon.trim()
        ? candidate.icon.trim()
        : undefined,
      args: Array.isArray(candidate.args) ? candidate.args : [],
    };
  });
};

const sanitizeConfig = (value: DevCommandsWidgetConfig): DevCommandsWidgetConfig => {
  const gridSize = isGridSize(value.gridSize) ? value.gridSize : '4x4';
  const sanitized = sanitizeCommands(value.commands);

  return {
    ...value,
    gridSize,
    commands: sanitized === undefined ? DEFAULT_COMMANDS[gridSize].map((c) => ({ ...c })) : sanitized,
  };
};

const iconStrokeStyle: React.CSSProperties = {
  width: '20px',
  height: '20px',
  stroke: 'currentColor',
  fill: 'none',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const iconRegistry: Record<string, React.ReactNode> = {
  terminal: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="m5 8 4 4-4 4M12 16h7" />
      <rect x="2" y="3" width="20" height="18" rx="2" />
    </svg>
  ),
  run: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="m7 4 14 8-14 8V4Z" />
    </svg>
  ),
  debug: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <rect x="6" y="6" width="12" height="14" rx="6" />
      <path d="M12 2v4M5 11H2M22 11h-3M5 18l-2 2M19 18l2 2M9 6l-2-3M15 6l2-3" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
  explorer: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  ),
  'source-control': (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 8.5v7M8.5 6H14a4 4 0 0 1 4 4v0" />
    </svg>
  ),
  extensions: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M18 14v3M18 17h-3M21 17h-3M18 21v-1" />
    </svg>
  ),
  problems: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M10.3 3.9 2.4 17a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
  output: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h10M7 14h6" />
    </svg>
  ),
  git: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="m21.5 12.5-10-10a1.4 1.4 0 0 0-2 0L7.3 4.7l2.6 2.6a1.7 1.7 0 0 1 2.1 2.2l2.5 2.5a1.7 1.7 0 1 1-1 .8l-2.3-2.3v6a1.7 1.7 0 1 1-1.4 0v-6a1.7 1.7 0 0 1-.9-2.3L6.3 5.7 2.5 9.5a1.4 1.4 0 0 0 0 2l10 10a1.4 1.4 0 0 0 2 0l7-7a1.4 1.4 0 0 0 0-2Z" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="m3 7 2 2 4-4M3 14l2 2 4-4M13 8h8M13 16h8" />
    </svg>
  ),
  palette: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  ),
  sidebar: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  ),
  theme: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-5-5 4 4 0 0 1-4-4Z" />
    </svg>
  ),
  save: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M5 3h11l3 3v15H5V3Z" />
      <path d="M8 3v6h8V3M8 21v-6h8v6" />
    </svg>
  ),
  reload: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M20 12a8 8 0 1 1-2.3-5.7L20 9" />
      <path d="M20 4v5h-5" />
    </svg>
  ),
  'new-file': (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6M12 12v6M9 15h6" />
    </svg>
  ),
  'open-file': (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  ),
  split: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  ),
  zen: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <circle cx="12" cy="12" r="9" />
      <path d="M4 12h16M12 4a14 14 0 0 1 0 16M12 4a14 14 0 0 0 0 16" />
    </svg>
  ),
  format: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M3 6h18M3 12h12M3 18h18" />
    </svg>
  ),
  comment: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
    </svg>
  ),
  rename: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M3 17.25V21h3.75L18 9.75 14.25 6 3 17.25Z" />
      <path d="M14.25 6 17 3.25 20.75 7 18 9.75" />
    </svg>
  ),
  goto: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  references: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M9 7H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4M15 7h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4M8 12h8" />
    </svg>
  ),
  breakpoint: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
    </svg>
  ),
  'step-over': (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M5 15a7 7 0 0 1 14 0" />
      <path d="M19 15v-4M19 15h-4" />
      <circle cx="12" cy="19" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  continue: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M3 4v16M8 6l10 6-10 6V6Z" />
    </svg>
  ),
  stop: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  pull: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M12 4v12M6 10l6 6 6-6M5 20h14" />
    </svg>
  ),
  push: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <path d="M12 20V8M6 14l6-6 6 6M5 4h14" />
    </svg>
  ),
  commit: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M3 12h5.5M15.5 12H21" />
    </svg>
  ),
  branch: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M8 5h6a4 4 0 0 1 4 4v1" />
    </svg>
  ),
  keys: (
    <svg viewBox="0 0 24 24" style={iconStrokeStyle}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
    </svg>
  ),
};

const renderIcon = (icon: string | undefined): React.ReactNode => {
  if (!icon) {
    return iconRegistry.terminal;
  }

  const normalized = icon.trim().toLowerCase();
  if (iconRegistry[normalized]) {
    return iconRegistry[normalized];
  }

  return (
    <span style={{ fontSize: '18px', lineHeight: 1 }} aria-hidden="true">
      {icon}
    </span>
  );
};

interface CommandsEditorProps {
  value: DevCommand[] | undefined;
  gridSize: DevCommandsGridSize;
  onChange: (commands: DevCommand[]) => void;
}

const CommandsEditor: React.FC<CommandsEditorProps> = ({ value, gridSize, onChange }) => {
  const { onFieldChange, markChanged } = useSettingsContext();
  const cellCount = GRID_DIMENSIONS[gridSize] * GRID_DIMENSIONS[gridSize];
  const [commands, setCommands] = useState<DevCommand[]>(value || DEFAULT_COMMANDS[gridSize]);

  useEffect(() => {
    setCommands(value || DEFAULT_COMMANDS[gridSize]);
  }, [gridSize, value]);

  const sync = useCallback((next: DevCommand[]) => {
    setCommands(next);
    markChanged();
    onFieldChange('commands', next);
    onChange(next);
  }, [markChanged, onChange, onFieldChange]);

  const updateCommand = useCallback((index: number, updates: Partial<DevCommand>) => {
    sync(commands.map((cmd, i) => i === index ? { ...cmd, ...updates } : cmd));
  }, [commands, sync]);

  const removeCommand = useCallback((index: number) => {
    sync(commands.filter((_, i) => i !== index));
  }, [commands, sync]);

  const addCommand = useCallback(() => {
    const next = commands.length + 1;
    sync([
      ...commands,
      {
        id: `cmd-${next}`,
        label: `Command ${next}`,
        icon: 'terminal',
        command: '',
      },
    ]);
  }, [commands, sync]);

  const resetToDefaults = useCallback(() => {
    sync(DEFAULT_COMMANDS[gridSize].map((c) => ({ ...c })));
  }, [gridSize, sync]);

  const listId = 'dev-commands-suggestions';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label variant="muted" size="sm">
          {commands.length} of {cellCount} tile slots configured. Extra commands are hidden.
        </Label>
        <Button variant="ghost" size="sm" onClick={resetToDefaults}>
          Reset
        </Button>
      </div>

      <datalist id={listId}>
        {COMMAND_SUGGESTIONS.map((s) => (
          <option key={s.command} value={s.command}>{s.label}</option>
        ))}
      </datalist>

      {commands.map((cmd, index) => (
        <div
          key={cmd.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid var(--vscode-panel-border, #454545)',
            background: 'color-mix(in srgb, var(--vscode-editorWidget-background, #252526) 85%, white 15%)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label size="sm" style={{ fontWeight: 700 }}>Tile {index + 1}</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeCommand(index)}
              style={{ minWidth: 'unset', padding: '4px 8px' }}
            >
              Remove
            </Button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <Label variant="muted" size="sm" style={{ display: 'block', marginBottom: '4px' }}>Label</Label>
              <Input
                type="text"
                value={cmd.label}
                placeholder="Terminal"
                onChange={(e) => updateCommand(index, { label: e.target.value })}
              />
            </div>
            <div>
              <Label variant="muted" size="sm" style={{ display: 'block', marginBottom: '4px' }}>Icon</Label>
              <Input
                type="text"
                value={cmd.icon || ''}
                placeholder="terminal or 🚀"
                onChange={(e) => updateCommand(index, { icon: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label variant="muted" size="sm" style={{ display: 'block', marginBottom: '4px' }}>Command</Label>
            <Input
              type="text"
              list={listId}
              value={cmd.command}
              placeholder="workbench.action.showCommands"
              onChange={(e) => updateCommand(index, { command: e.target.value })}
            />
          </div>
        </div>
      ))}

      <Button variant="secondary" size="sm" onClick={addCommand} disabled={commands.length >= cellCount}>
        Add Command {commands.length >= cellCount ? '(grid full)' : ''}
      </Button>
    </div>
  );
};

export const DevCommandsWidget: React.FC<ReactWidgetProps> = ({
  config,
  data,
  onUpdate,
}) => {
  const widgetConfig = useMemo(
    () => sanitizeConfig(config as unknown as DevCommandsWidgetConfig),
    [config],
  );
  const widgetData = data as DevCommandsWidgetData | undefined;

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<DevCommandsWidgetConfig>(widgetConfig);
  const [executionCounts, setExecutionCounts] = useState<Record<string, number>>(widgetData?.executionCounts || {});
  const [lastExecutedId, setLastExecutedId] = useState<string | undefined>(widgetData?.lastExecutedId);
  const [lastExecutedAt, setLastExecutedAt] = useState<string | undefined>(widgetData?.lastExecutedAt);
  const [pressedId, setPressedId] = useState<string | null>(null);

  useEffect(() => {
    setLocalConfig(widgetConfig);
  }, [widgetConfig]);

  useEffect(() => {
    setExecutionCounts(widgetData?.executionCounts || {});
    setLastExecutedId(widgetData?.lastExecutedId);
    setLastExecutedAt(widgetData?.lastExecutedAt);
  }, [widgetData?.executionCounts, widgetData?.lastExecutedId, widgetData?.lastExecutedAt]);

  const emitUpdate = useCallback((
    updatedData: DevCommandsWidgetData,
    updatedConfig?: DevCommandsWidgetConfig,
  ) => {
    const payload = {
      data: updatedData,
      config: updatedConfig || localConfig,
    };

    if (onUpdate) {
      onUpdate({ ...payload.data, _config: payload.config });
    }

    document.dispatchEvent(new CustomEvent('widget-update', {
      bubbles: true,
      detail: {
        type: 'data-change',
        ...payload,
        widgetId: (config as any).id,
      },
    }));
  }, [config, localConfig, onUpdate]);

  const handleClick = useCallback((cmd: DevCommand) => {
    if (!cmd.command) {
      return;
    }

    const now = new Date().toISOString();
    const nextCounts = {
      ...executionCounts,
      [cmd.id]: (executionCounts[cmd.id] || 0) + 1,
    };

    setExecutionCounts(nextCounts);
    setLastExecutedId(cmd.id);
    setLastExecutedAt(now);
    setPressedId(cmd.id);

    emitUpdate({
      executionCounts: nextCounts,
      lastExecutedId: cmd.id,
      lastExecutedAt: now,
    });

    document.dispatchEvent(new CustomEvent('button-action', {
      bubbles: true,
      detail: {
        actionType: 'vscode-command',
        action: cmd.id,
        value: cmd.label,
        data: {
          command: cmd.command,
          args: cmd.args || [],
        },
        widgetId: (config as any).id,
        timestamp: now,
      },
    }));

    window.setTimeout(() => {
      setPressedId((current) => current === cmd.id ? null : current);
    }, 180);
  }, [config, emitUpdate, executionCounts]);

  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const merged = { ...localConfig, ...newConfig } as DevCommandsWidgetConfig;
    const gridSizeChanged = isGridSize(newConfig.gridSize) && newConfig.gridSize !== localConfig.gridSize;
    const updated = sanitizeConfig({
      ...merged,
      commands: gridSizeChanged && newConfig.commands === undefined
        ? DEFAULT_COMMANDS[newConfig.gridSize as DevCommandsGridSize].map((c) => ({ ...c }))
        : merged.commands,
    });

    setLocalConfig(updated);
    emitUpdate({
      executionCounts,
      lastExecutedId,
      lastExecutedAt,
    }, updated);
  }, [emitUpdate, executionCounts, lastExecutedAt, lastExecutedId, localConfig]);

  const title = localConfig.title || 'Dev Commands';
  const gridSize = isGridSize(localConfig.gridSize) ? localConfig.gridSize : '4x4';
  const dimension = GRID_DIMENSIONS[gridSize];
  const cellCount = dimension * dimension;
  const commands = localConfig.commands || DEFAULT_COMMANDS[gridSize];

  const slots = useMemo(() => {
    const arr: Array<DevCommand | null> = [];
    for (let i = 0; i < cellCount; i += 1) {
      arr.push(commands[i] || null);
    }
    return arr;
  }, [cellCount, commands]);

  const containerWidth = CONTAINER_WIDTH[gridSize];
  const tileGap = gridSize === '6x6' ? '6px' : gridSize === '4x4' ? '8px' : '10px';
  const iconBubbleSize = gridSize === '6x6' ? 28 : gridSize === '4x4' ? 36 : 44;
  const labelFontSize = gridSize === '6x6' ? '9px' : gridSize === '4x4' ? '10px' : '11px';
  const tilePadding = gridSize === '6x6' ? '4px' : gridSize === '4x4' ? '6px' : '10px';
  const totalRuns = Object.values(executionCounts).reduce((sum, n) => sum + n, 0);
  const lastCommand = commands.find((c) => c.id === lastExecutedId);

  return (
    <Widget
      size="lg"
      design="default"
      style={{
        position: 'relative',
        gap: '10px',
        width: `${containerWidth}px`,
        minHeight: 'auto',
      }}
    >
      <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <WidgetTitle>{title}</WidgetTitle>
          <Label variant="muted" size="sm">{gridSize} grid</Label>
        </div>
        <SettingsToggle
          isOpen={isSettingsOpen}
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
        />
      </WidgetHeader>

      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Dev Commands Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
          onChildChange={(key, value) => {
            setLocalConfig((prev) => {
              const next: DevCommandsWidgetConfig = { ...prev, [key]: value };
              if (key === 'gridSize' && isGridSize(value)) {
                next.commands = DEFAULT_COMMANDS[value].map((c) => ({ ...c }));
              }
              return sanitizeConfig(next);
            });
          }}
        >
          <CommandsEditor
            value={localConfig.commands}
            gridSize={gridSize}
            onChange={(next) => {
              setLocalConfig((prev) => sanitizeConfig({ ...prev, commands: next }));
            }}
          />
        </WidgetSettingsPanel>
      )}

      <WidgetContent
        style={{
          alignItems: 'stretch',
          justifyContent: 'stretch',
          width: '100%',
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${dimension}, minmax(0, 1fr))`,
            gap: tileGap,
            width: '100%',
          }}
        >
          {slots.map((cmd, index) => {
            if (!cmd) {
              return (
                <div
                  key={`empty-${index}`}
                  style={{
                    aspectRatio: '1 / 1',
                    borderRadius: '12px',
                    border: '1px dashed rgba(127, 127, 127, 0.22)',
                    background: 'rgba(127, 127, 127, 0.04)',
                  }}
                />
              );
            }

            const isActive = pressedId === cmd.id;
            const wasLast = lastExecutedId === cmd.id;

            return (
              <button
                key={cmd.id}
                type="button"
                onClick={() => handleClick(cmd)}
                disabled={!cmd.command}
                title={cmd.command || 'No command configured'}
                aria-label={cmd.command ? `${cmd.label}: run ${cmd.command}` : `${cmd.label}: not configured`}
                style={{
                  aspectRatio: '1 / 1',
                  borderRadius: '12px',
                  border: `1px solid ${wasLast ? 'var(--vscode-focusBorder, #0e639c)' : 'rgba(127, 127, 127, 0.18)'}`,
                  padding: tilePadding,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: gridSize === '6x6' ? '4px' : '6px',
                  textAlign: 'center',
                  cursor: cmd.command ? 'pointer' : 'default',
                  transition: 'transform 0.12s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease',
                  transform: isActive ? 'scale(0.96)' : 'translateY(0)',
                  opacity: cmd.command ? 1 : 0.55,
                  background: 'color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 80%, white 20%)',
                  color: 'var(--vscode-editor-foreground, #cccccc)',
                  boxShadow: wasLast
                    ? '0 4px 14px rgba(14, 99, 156, 0.32)'
                    : '0 2px 6px rgba(0, 0, 0, 0.12)',
                  fontFamily: 'inherit',
                }}
              >
                <div
                  style={{
                    width: `${iconBubbleSize}px`,
                    height: `${iconBubbleSize}px`,
                    borderRadius: '999px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(127, 127, 127, 0.12)',
                  }}
                >
                  {renderIcon(cmd.icon)}
                </div>
                <span
                  style={{
                    fontSize: labelFontSize,
                    fontWeight: 600,
                    lineHeight: 1.1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                  }}
                >
                  {cmd.label}
                </span>
              </button>
            );
          })}
        </div>
      </WidgetContent>

      <WidgetFooter style={{ justifyContent: 'space-between', marginTop: '4px' }}>
        <Label variant="muted" size="sm">{cellCount} slots</Label>
        <Label variant="muted" size="sm">Runs: {totalRuns}</Label>
        <Label variant="muted" size="sm">
          {lastCommand ? `Last: ${lastCommand.label}` : 'Ready'}
        </Label>
      </WidgetFooter>
    </Widget>
  );
};
