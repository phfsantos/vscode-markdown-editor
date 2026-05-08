/**
 * MacroBoardWidget - Stream Deck style macro launcher.
 *
 * Features:
 * - Grid of single-level macro buttons
 * - Customizable rows, columns, labels, and icons
 * - VS Code command and macro execution via existing widget action bridge
 * - Lightweight execution history persistence
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Widget,
  WidgetHeader,
  WidgetTitle,
  WidgetContent,
  WidgetFooter,
  Label,
  Button,
  Input,
  Select,
  SettingsToggle,
  WidgetSettingsPanel,
  useSettingsContext,
} from '../ui';
import type { SettingsField } from '../ui/WidgetSettingsPanel';
import type { ReactWidgetProps } from '../core/ReactWidgetWrapper';
import type { WidgetSize } from '../ui/Widget';

type MacroBoardTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/**
 * Single macro button definition.
 * Only first-level button properties are supported; nested folders are ignored.
 */
export interface MacroBoardButton {
  /** Stable button identifier used for persistence. */
  id: string;
  /** Visible button label. */
  label: string;
  /** Icon keyword or emoji/text shown above the label. */
  icon?: string;
  /** VS Code command or macro command identifier to execute. */
  command?: string;
  /** Optional command arguments forwarded to the extension host. */
  args?: unknown[];
  /** Optional visual emphasis for a tile. */
  tone?: MacroBoardTone;
}

/**
 * Persisted widget configuration.
 */
export interface MacroBoardWidgetConfig {
  /** Optional header title. */
  title?: string;
  /** Widget container size. */
  size?: WidgetSize;
  /** Number of rows to display. */
  rows?: number;
  /** Number of columns to display. */
  columns?: number;
  /** Flat list of macro buttons shown in the grid. */
  buttons?: MacroBoardButton[];
}

/**
 * Persisted runtime data.
 */
export interface MacroBoardWidgetData {
  /** Per-button execution counters. */
  executionCounts?: Record<string, number>;
  /** Most recently executed button identifier. */
  lastExecutedButtonId?: string;
  /** ISO timestamp for the last execution. */
  lastExecutedAt?: string;
}

const settingsFields: SettingsField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Macro Board' },
  {
    key: 'size',
    label: 'Size',
    type: 'select',
    options: [
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Medium' },
      { value: 'lg', label: 'Large' },
    ],
    defaultValue: 'md',
  },
  {
    key: 'rows',
    label: 'Rows',
    type: 'number',
    min: 1,
    max: 6,
    defaultValue: 3,
  },
  {
    key: 'columns',
    label: 'Columns',
    type: 'number',
    min: 1,
    max: 6,
    defaultValue: 3,
  },
];

const DEFAULT_BUTTONS: MacroBoardButton[] = [
  { id: 'commands', label: 'Commands', icon: 'bolt', command: 'workbench.action.showCommands', tone: 'danger' },
  { id: 'daily-note', label: 'Daily Note', icon: 'calendar', command: 'markdown-editor.openDailyNote' },
  { id: 'quick-open', label: 'Quick Open', icon: 'search', command: 'workbench.action.quickOpen' },
  { id: 'sidebar', label: 'Sidebar', icon: 'layers', command: 'workbench.action.toggleSidebarVisibility' },
  { id: 'graph', label: 'Graph View', icon: 'sparkles', command: 'markdown-editor.openGraphView', tone: 'success' },
  { id: 'notes', label: 'Open Note', icon: 'chat', command: 'markdown-editor.quickOpenNote' },
  { id: 'terminal', label: 'Terminal', icon: 'code', command: 'workbench.action.terminal.toggleTerminal' },
  { id: 'settings', label: 'Settings', icon: 'sliders', command: 'workbench.action.openSettings' },
  { id: 'save-all', label: 'Save All', icon: 'camera', command: 'workbench.action.files.saveAll' },
];

const COMMAND_SUGGESTIONS = [
  { label: 'Command Palette', command: 'workbench.action.showCommands' },
  { label: 'Quick Open', command: 'workbench.action.quickOpen' },
  { label: 'Daily Note', command: 'markdown-editor.openDailyNote' },
  { label: 'Quick Open Note', command: 'markdown-editor.quickOpenNote' },
  { label: 'Graph View', command: 'markdown-editor.openGraphView' },
  { label: 'Open Settings', command: 'workbench.action.openSettings' },
  { label: 'Toggle Sidebar', command: 'workbench.action.toggleSidebarVisibility' },
  { label: 'Toggle Terminal', command: 'workbench.action.terminal.toggleTerminal' },
  { label: 'Save All', command: 'workbench.action.files.saveAll' },
];

const ICON_OPTIONS = [
  { value: 'bolt', label: 'Bolt' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'search', label: 'Search' },
  { value: 'layers', label: 'Layers' },
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'chat', label: 'Chat' },
  { value: 'code', label: 'Code' },
  { value: 'sliders', label: 'Sliders' },
  { value: 'camera', label: 'Camera' },
];

const toneSet = new Set<MacroBoardTone>(['neutral', 'accent', 'success', 'warning', 'danger']);

const clamp = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
};

const sanitizeButtons = (value: unknown): MacroBoardButton[] => {
  let parsedValue = value;

  if (typeof parsedValue === 'string' && parsedValue.trim()) {
    try {
      parsedValue = JSON.parse(parsedValue);
    } catch {
      return DEFAULT_BUTTONS.map((button) => ({ ...button }));
    }
  }

  if (!Array.isArray(parsedValue)) {
    return DEFAULT_BUTTONS.map((button) => ({ ...button }));
  }

  return parsedValue.map((rawButton, index) => {
    const candidate = rawButton && typeof rawButton === 'object'
      ? rawButton as Partial<MacroBoardButton>
      : {};

    const tone = candidate.tone && toneSet.has(candidate.tone)
      ? candidate.tone
      : 'neutral';

    return {
      id: typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `macro-${index + 1}`,
      label: typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label.trim()
        : `Button ${index + 1}`,
      icon: typeof candidate.icon === 'string' && candidate.icon.trim()
        ? candidate.icon.trim()
        : undefined,
      command: typeof candidate.command === 'string' && candidate.command.trim()
        ? candidate.command.trim()
        : undefined,
      args: Array.isArray(candidate.args) ? candidate.args : [],
      tone,
    };
  });
};

const sanitizeConfig = (value: MacroBoardWidgetConfig): MacroBoardWidgetConfig => {
  return {
    ...value,
    size: value.size || 'md',
    rows: clamp(value.rows, 1, 6, 3),
    columns: clamp(value.columns, 1, 6, 3),
    buttons: value.buttons === undefined
      ? DEFAULT_BUTTONS.map((button) => ({ ...button }))
      : sanitizeButtons(value.buttons),
  };
};

const baseIconStyle: React.CSSProperties = {
  width: '18px',
  height: '18px',
  stroke: 'currentColor',
  fill: 'none',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const iconRegistry: Record<string, React.ReactNode> = {
  bolt: (
    <svg viewBox="0 0 24 24" style={baseIconStyle}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" style={baseIconStyle}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" style={baseIconStyle}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" style={baseIconStyle}>
      <path d="m12 4 8 5-8 5-8-5 8-5Z" />
      <path d="m4 14 8 5 8-5" />
    </svg>
  ),
  sparkles: (
    <svg viewBox="0 0 24 24" style={baseIconStyle}>
      <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
      <path d="m18.5 15 0.8 2.2 2.2 0.8-2.2 0.8-0.8 2.2-0.8-2.2-2.2-0.8 2.2-0.8 0.8-2.2Z" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" style={baseIconStyle}>
      <path d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
      <path d="M8 11h8M8 15h5" />
    </svg>
  ),
  code: (
    <svg viewBox="0 0 24 24" style={baseIconStyle}>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />
    </svg>
  ),
  sliders: (
    <svg viewBox="0 0 24 24" style={baseIconStyle}>
      <path d="M4 21v-7M4 10V3M12 21v-4M12 13V3M20 21v-9M20 8V3" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="15" r="2" />
      <circle cx="20" cy="10" r="2" />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" style={baseIconStyle}>
      <path d="M4 8h4l2-2h4l2 2h4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
};

const renderIcon = (icon: string | undefined): React.ReactNode => {
  if (!icon) {
    return iconRegistry.bolt;
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

const createTileTone = (tone: MacroBoardTone, active: boolean): React.CSSProperties => {
  if (tone === 'danger' || active) {
    return {
      background: 'var(--vscode-testing-iconPassed, #12833a)',
      borderColor: 'rgba(18, 131, 58, 0.55)',
      color: '#ffffff',
      boxShadow: '0 10px 22px rgba(18, 131, 58, 0.28)',
    };
  }

  if (tone === 'accent') {
    return {
      background: 'var(--vscode-button-background, #0e639c)',
      borderColor: 'rgba(14, 99, 156, 0.45)',
      color: 'var(--vscode-button-foreground, #ffffff)',
      boxShadow: '0 10px 22px rgba(14, 99, 156, 0.22)',
    };
  }

  if (tone === 'success') {
    return {
      background: 'rgba(18, 131, 58, 0.12)',
      borderColor: 'rgba(18, 131, 58, 0.25)',
      color: 'var(--vscode-editor-foreground, #cccccc)',
      boxShadow: '0 8px 18px rgba(18, 131, 58, 0.12)',
    };
  }

  if (tone === 'warning') {
    return {
      background: 'rgba(210, 153, 34, 0.12)',
      borderColor: 'rgba(210, 153, 34, 0.24)',
      color: 'var(--vscode-editor-foreground, #cccccc)',
      boxShadow: '0 8px 18px rgba(210, 153, 34, 0.10)',
    };
  }

  return {
    background: 'color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 88%, white 12%)',
    borderColor: 'rgba(127, 127, 127, 0.18)',
    color: 'var(--vscode-editor-foreground, #cccccc)',
    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.10)',
  };
};

interface ButtonsEditorProps {
  value: MacroBoardButton[] | undefined;
  onChange: (buttons: MacroBoardButton[]) => void;
}

const ButtonsEditor: React.FC<ButtonsEditorProps> = ({ value, onChange }) => {
  const { onFieldChange, markChanged } = useSettingsContext();
  const [buttons, setButtons] = useState<MacroBoardButton[]>(value || DEFAULT_BUTTONS);

  useEffect(() => {
    setButtons(value || DEFAULT_BUTTONS);
  }, [value]);

  const syncButtons = useCallback((nextButtons: MacroBoardButton[]) => {
    setButtons(nextButtons);
    markChanged();
    onFieldChange('buttons', nextButtons);
    onChange(nextButtons);
  }, [markChanged, onChange, onFieldChange]);

  const updateButton = useCallback((index: number, updates: Partial<MacroBoardButton>) => {
    const nextButtons = buttons.map((button, buttonIndex) => {
      if (buttonIndex !== index) {
        return button;
      }

      return {
        ...button,
        ...updates,
      };
    });

    syncButtons(nextButtons);
  }, [buttons, syncButtons]);

  const addButton = useCallback(() => {
    const nextIndex = buttons.length + 1;
    syncButtons([
      ...buttons,
      {
        id: `macro-${nextIndex}`,
        label: `Button ${nextIndex}`,
        icon: 'bolt',
        command: '',
        tone: 'neutral',
      },
    ]);
  }, [buttons, syncButtons]);

  const removeButton = useCallback((index: number) => {
    syncButtons(buttons.filter((_, buttonIndex) => buttonIndex !== index));
  }, [buttons, syncButtons]);

  const applySuggestion = useCallback((index: number, suggestion: { label: string; command: string }) => {
    updateButton(index, {
      label: buttons[index]?.label?.trim() ? buttons[index].label : suggestion.label,
      command: suggestion.command,
    });
  }, [buttons, updateButton]);

  const commandListId = 'macro-board-command-suggestions';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <Label variant="muted" size="sm">
        Configure each deck button directly. Pick an icon, set the label, and choose a VS Code command.
      </Label>

      <datalist id={commandListId}>
        {COMMAND_SUGGESTIONS.map((suggestion) => (
          <option key={suggestion.command} value={suggestion.command}>
            {suggestion.label}
          </option>
        ))}
      </datalist>

      {buttons.map((button, index) => (
        <div
          key={button.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid var(--vscode-panel-border, #454545)',
            background: 'color-mix(in srgb, var(--vscode-editorWidget-background, #252526) 85%, white 15%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <Label size="sm" style={{ fontWeight: 700 }}>
              Button {index + 1}
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeButton(index)}
              disabled={buttons.length === 0}
              style={{ minWidth: 'unset', padding: '4px 8px' }}
            >
              Remove
            </Button>
          </div>

          <div style={{ display: 'grid', gap: '8px' }}>
            <div>
              <Label variant="muted" size="sm" style={{ marginBottom: '4px', display: 'block' }}>
                Label
              </Label>
              <Input
                type="text"
                value={button.label}
                placeholder="Go Live"
                onChange={(event) => updateButton(index, { label: event.target.value })}
              />
            </div>

            <div>
              <Label variant="muted" size="sm" style={{ marginBottom: '4px', display: 'block' }}>
                Command
              </Label>
              <Input
                type="text"
                list={commandListId}
                value={button.command || ''}
                placeholder="workbench.action.showCommands"
                onChange={(event) => updateButton(index, { command: event.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '8px', alignItems: 'end' }}>
              <div>
                <Label variant="muted" size="sm" style={{ marginBottom: '4px', display: 'block' }}>
                  Custom Icon
                </Label>
                <Input
                  type="text"
                  value={button.icon || ''}
                  placeholder="bolt or 🎥"
                  onChange={(event) => updateButton(index, { icon: event.target.value })}
                />
              </div>

              <div>
                <Label variant="muted" size="sm" style={{ marginBottom: '4px', display: 'block' }}>
                  Tone
                </Label>
                <Select
                  value={button.tone || 'neutral'}
                  onChange={(event) => updateButton(index, { tone: event.target.value as MacroBoardTone })}
                >
                  <option value="neutral">Neutral</option>
                  <option value="accent">Accent</option>
                  <option value="success">Success</option>
                  <option value="warning">Warning</option>
                  <option value="danger">Danger</option>
                </Select>
              </div>
            </div>

            <div>
              <Label variant="muted" size="sm" style={{ marginBottom: '6px', display: 'block' }}>
                Icon Picker
              </Label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '6px' }}>
                {ICON_OPTIONS.map((iconOption) => {
                  const selected = (button.icon || '').trim().toLowerCase() === iconOption.value;

                  return (
                    <Button
                      key={iconOption.value}
                      variant={selected ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => updateButton(index, { icon: iconOption.value })}
                      style={{ minWidth: 'unset', padding: '6px 4px', flexDirection: 'column', height: 'auto', gap: '4px' }}
                      title={iconOption.label}
                    >
                      {renderIcon(iconOption.value)}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label variant="muted" size="sm" style={{ marginBottom: '6px', display: 'block' }}>
                Command Suggestions
              </Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {COMMAND_SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={`${button.id}-${suggestion.command}`}
                    variant={button.command === suggestion.command ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => applySuggestion(index, suggestion)}
                    style={{ minWidth: 'unset', padding: '4px 8px' }}
                  >
                    {suggestion.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}

      <Button variant="secondary" size="sm" onClick={addButton}>
        Add Button
      </Button>
    </div>
  );
};

export const MacroBoardWidget: React.FC<ReactWidgetProps> = ({
  config,
  data,
  onUpdate,
}) => {
  const widgetConfig = sanitizeConfig(config as unknown as MacroBoardWidgetConfig);
  const widgetData = data as MacroBoardWidgetData | undefined;

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<MacroBoardWidgetConfig>(widgetConfig);
  const [executionCounts, setExecutionCounts] = useState<Record<string, number>>(widgetData?.executionCounts || {});
  const [lastExecutedButtonId, setLastExecutedButtonId] = useState<string | undefined>(widgetData?.lastExecutedButtonId);
  const [lastExecutedAt, setLastExecutedAt] = useState<string | undefined>(widgetData?.lastExecutedAt);
  const [pressedButtonId, setPressedButtonId] = useState<string | null>(null);

  useEffect(() => {
    setLocalConfig(widgetConfig);
  }, [widgetConfig]);

  useEffect(() => {
    setExecutionCounts(widgetData?.executionCounts || {});
    setLastExecutedButtonId(widgetData?.lastExecutedButtonId);
    setLastExecutedAt(widgetData?.lastExecutedAt);
  }, [widgetData?.executionCounts, widgetData?.lastExecutedButtonId, widgetData?.lastExecutedAt]);

  const emitUpdate = useCallback((
    updatedData: MacroBoardWidgetData,
    updatedConfig?: MacroBoardWidgetConfig
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

  const handleButtonClick = useCallback((button: MacroBoardButton) => {
    if (!button.command) {
      return;
    }

    const now = new Date().toISOString();
    const nextCounts = {
      ...executionCounts,
      [button.id]: (executionCounts[button.id] || 0) + 1,
    };

    setExecutionCounts(nextCounts);
    setLastExecutedButtonId(button.id);
    setLastExecutedAt(now);
    setPressedButtonId(button.id);

    emitUpdate({
      executionCounts: nextCounts,
      lastExecutedButtonId: button.id,
      lastExecutedAt: now,
    });

    document.dispatchEvent(new CustomEvent('button-action', {
      bubbles: true,
      detail: {
        actionType: 'vscode-command',
        action: button.id,
        value: button.label,
        data: {
          command: button.command,
          args: button.args || [],
        },
        widgetId: (config as any).id,
        timestamp: now,
      },
    }));

    window.setTimeout(() => {
      setPressedButtonId((currentValue) => currentValue === button.id ? null : currentValue);
    }, 180);
  }, [config, emitUpdate, executionCounts]);

  const handleSettingsSave = useCallback((newConfig: Record<string, any>) => {
    const updatedConfig = sanitizeConfig({
      ...localConfig,
      ...newConfig,
    } as MacroBoardWidgetConfig);

    setLocalConfig(updatedConfig);
    emitUpdate({
      executionCounts,
      lastExecutedButtonId,
      lastExecutedAt,
    }, updatedConfig);
  }, [emitUpdate, executionCounts, lastExecutedAt, lastExecutedButtonId, localConfig]);

  const title = localConfig.title || 'Macro Board';
  const size = localConfig.size || 'md';
  const rows = clamp(localConfig.rows, 1, 6, 3);
  const columns = clamp(localConfig.columns, 1, 6, 3);
  const buttons = sanitizeButtons(localConfig.buttons);
  const slotCount = rows * columns;
  const slots: Array<MacroBoardButton | null> = [];
  for (let index = 0; index < slotCount; index += 1) {
    slots.push(buttons[index] || null);
  }

  const gridGap = size === 'lg' ? '14px' : '12px';
  const iconBubbleSize = size === 'lg' ? 54 : size === 'md' ? 46 : 38;
  const labelFontSize = size === 'lg' ? '12px' : '11px';
  const footerExecutionTotal = Object.values(executionCounts).reduce((total, count) => total + count, 0);
  const lastExecutedButton = buttons.find((button) => button.id === lastExecutedButtonId);

  return (
    <Widget size={size} design="default" style={{ position: 'relative', gap: '10px' }}>
      <WidgetHeader style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <WidgetTitle>{title}</WidgetTitle>
          <Label variant="muted" size="sm">
            {rows} x {columns} deck
          </Label>
        </div>
        <SettingsToggle
          isOpen={isSettingsOpen}
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
        />
      </WidgetHeader>

      {isSettingsOpen && (
        <WidgetSettingsPanel
          title="Macro Board Settings"
          fields={settingsFields}
          values={localConfig as Record<string, any>}
          onSave={handleSettingsSave}
          onClose={() => setIsSettingsOpen(false)}
          onChildChange={(key, value) => {
            setLocalConfig((previousValue) => sanitizeConfig({
              ...previousValue,
              [key]: value,
            }));
          }}
        >
          <ButtonsEditor
            value={localConfig.buttons}
            onChange={(nextButtons) => {
              setLocalConfig((previousValue) => sanitizeConfig({
                ...previousValue,
                buttons: nextButtons,
              }));
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
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: gridGap,
            width: '100%',
            alignContent: 'stretch',
          }}
        >
          {slots.map((button, index) => {
            if (!button) {
              return (
                <div
                  key={`empty-${index}`}
                  style={{
                    aspectRatio: '1 / 1',
                    borderRadius: '24px',
                    border: '1px dashed rgba(127, 127, 127, 0.25)',
                    background: 'rgba(127, 127, 127, 0.05)',
                  }}
                />
              );
            }

            const isActive = pressedButtonId === button.id || lastExecutedButtonId === button.id;
            const toneStyle = createTileTone(button.tone || 'neutral', isActive);
            const iconBubbleBackground = toneStyle.color === '#ffffff'
              ? 'rgba(255, 255, 255, 0.18)'
              : 'rgba(127, 127, 127, 0.14)';

            return (
              <button
                key={button.id}
                type="button"
                onClick={() => handleButtonClick(button)}
                disabled={!button.command}
                aria-label={button.command
                  ? `${button.label}: run ${button.command}`
                  : `${button.label}: not configured`}
                title={button.command || 'No command configured'}
                style={{
                  aspectRatio: '1 / 1',
                  borderRadius: '24px',
                  border: '1px solid transparent',
                  padding: size === 'lg' ? '14px 10px' : '10px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: size === 'lg' ? '12px' : '10px',
                  textAlign: 'center',
                  cursor: button.command ? 'pointer' : 'default',
                  transition: 'transform 0.12s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease',
                  transform: pressedButtonId === button.id ? 'scale(0.98)' : 'translateY(0)',
                  opacity: button.command ? 1 : 0.58,
                  ...toneStyle,
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
                    background: iconBubbleBackground,
                  }}
                >
                  {renderIcon(button.icon)}
                </div>
                <span
                  style={{
                    fontSize: labelFontSize,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    lineHeight: 1.15,
                  }}
                >
                  {button.label}
                </span>
              </button>
            );
          })}
        </div>
      </WidgetContent>

      <WidgetFooter style={{ justifyContent: 'space-between', marginTop: '4px' }}>
        <Label variant="muted" size="sm">
          {slotCount} slots
        </Label>
        <Label variant="muted" size="sm">
          Runs: {footerExecutionTotal}
        </Label>
        <Label variant="muted" size="sm">
          {lastExecutedButton
            ? `Last: ${lastExecutedButton.label}`
            : lastExecutedAt
              ? 'Last run saved'
              : 'Ready'}
        </Label>
      </WidgetFooter>
    </Widget>
  );
};