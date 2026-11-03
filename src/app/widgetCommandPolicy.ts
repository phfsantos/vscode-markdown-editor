import * as vscode from "vscode";

/** Setting listing widget-triggered commands that may run without a prompt. */
export const ALLOWED_WIDGET_COMMANDS_SETTING = "widgets.allowedCommands";

export type WidgetCommandDecision = "allowed" | "untrusted" | "declined";

export interface WidgetCommandConfirmation {
  command: string;
  args: unknown[];
  /** Only argument-free commands can be added to the allowlist. */
  canAlwaysAllow: boolean;
}

export interface WidgetCommandPolicyPorts {
  isWorkspaceTrusted(): boolean;
  allowedCommands(): readonly string[];
  confirm(request: WidgetCommandConfirmation): Promise<"run" | "always" | undefined>;
  allowAlways(command: string): Promise<void>;
}

const COMMAND_ID = /^[A-Za-z0-9_.\-]+$/;

/**
 * Widget commands come from user-authored Markdown, so they never run in an
 * untrusted workspace, and only allowlisted, argument-free commands skip the
 * confirmation prompt. Args always prompt because they can change what an
 * otherwise harmless command does.
 */
export async function authorizeWidgetCommand(
  command: string,
  args: unknown[],
  ports: WidgetCommandPolicyPorts,
): Promise<WidgetCommandDecision> {
  if (!ports.isWorkspaceTrusted()) {
    return "untrusted";
  }
  if (!COMMAND_ID.test(command)) {
    return "declined";
  }
  if (args.length === 0 && ports.allowedCommands().includes(command)) {
    return "allowed";
  }

  const canAlwaysAllow = args.length === 0;
  const choice = await ports.confirm({ command, args, canAlwaysAllow });
  if (choice === "always" && canAlwaysAllow) {
    await ports.allowAlways(command);
    return "allowed";
  }
  return choice === "run" ? "allowed" : "declined";
}

/**
 * The allowlist is read from user settings only (the setting is
 * application-scoped), so a repository cannot widen it through its own
 * workspace settings.
 */
export function createVscodeWidgetCommandPolicyPorts(): WidgetCommandPolicyPorts {
  const configuration = () => vscode.workspace.getConfiguration("markdown-editor");

  return {
    isWorkspaceTrusted: () => vscode.workspace.isTrusted !== false,
    allowedCommands: () => {
      const inspected = configuration().inspect<string[]>(ALLOWED_WIDGET_COMMANDS_SETTING);
      const value = inspected?.globalValue ?? inspected?.defaultValue ?? [];
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    },
    confirm: async ({ command, args, canAlwaysAllow }) => {
      const run = "Run";
      const always = "Always Allow";
      const detail = args.length > 0
        ? `Arguments: ${JSON.stringify(args)}`
        : "Only run commands from documents you trust.";
      const items = canAlwaysAllow ? [run, always] : [run];
      const choice = await vscode.window.showWarningMessage(
        `A widget in this document wants to run the VS Code command "${command}".`,
        { modal: true, detail },
        ...items,
      );
      if (choice === always) return "always";
      if (choice === run) return "run";
      return undefined;
    },
    allowAlways: async (command) => {
      const current = configuration().inspect<string[]>(ALLOWED_WIDGET_COMMANDS_SETTING);
      const list = current?.globalValue ?? current?.defaultValue ?? [];
      if (list.includes(command)) return;
      await configuration().update(
        ALLOWED_WIDGET_COMMANDS_SETTING,
        [...list, command],
        vscode.ConfigurationTarget.Global,
      );
    },
  };
}
