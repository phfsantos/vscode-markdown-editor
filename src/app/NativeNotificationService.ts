import * as vscode from "vscode";
import * as os from "os";
import { execFile } from "child_process";
import { logger } from "../utils/Logger";

/**
 * Native OS notification support for widget events (timers, alarms).
 *
 * Extracted from EditorPanel: routes widget notification messages to the
 * platform's native notifier (notify-send/kdialog/zenity on Linux, osascript
 * on macOS, PowerShell toasts on Windows, with a WSL->Windows bridge) and
 * falls back to VS Code notifications when no backend is available.
 */
export class NativeNotificationService {
  /**
   * @param getPanelTitleHint Supplies the host panel's title (used to focus
   * the right VS Code window from a Windows toast activation).
   */
  constructor(private readonly getPanelTitleHint: () => string) {}

  /**
   * Show widget notifications as native OS notifications.
   * Falls back to VS Code notifications if the platform command is unavailable.
   */
  public async handleWidgetNotification(message: any): Promise<void> {
    const isWarningType =
      message.type === "timer-completed" || message.type === "alarm-triggered";

    const fallbackMessage =
      message.message ||
      (message.type === "timer-completed"
        ? "Timer completed!"
        : message.type === "alarm-triggered"
          ? "Alarm!"
          : "Widget notification");

    const fallbackDetail =
      message.type === "timer-completed"
        ? message.detail || ""
        : message.type === "alarm-triggered"
          ? `From: ${message.title || "Alarms"}`
          : "";

    const nativeTitle = message.title || "Markdown Editor";
    const nativeBody = fallbackDetail
      ? `${fallbackMessage}\n${fallbackDetail}`
      : fallbackMessage;

    const shown = await this.showNativeNotification(nativeTitle, nativeBody);
    if (shown) {
      return;
    }

    // Fallback to in-app VS Code notifications if native notification failed.
    if (isWarningType) {
      vscode.window.showWarningMessage(fallbackMessage, { detail: fallbackDetail });
    } else {
      vscode.window.showInformationMessage(fallbackMessage, { detail: fallbackDetail });
    }
  }

  private async showNativeNotification(
    title: string,
    body: string
  ): Promise<boolean> {
    const safeTitle = String(title || "Markdown Editor").trim() || "Markdown Editor";
    const safeBody = String(body || "Widget notification").trim() || "Widget notification";
    const windowsContext = this.getWindowsNotificationContext();

    try {
      if (process.platform === "linux") {
        // In WSL, prefer bridging to Windows notifications first so the Windows taskbar/Action Center is used.
        if (this.isWslEnvironment()) {
          const wslShown = await this.tryWslWindowsNotification(
            safeTitle,
            safeBody,
            windowsContext
          );
          if (wslShown) {
            return true;
          }
        }

        // Try multiple Linux backends because notify-send is not always installed (for example, minimal containers).
        const linuxCandidates: Array<{ command: string; args: string[] }> = [
          {
            command: "notify-send",
            args: [
              "--app-name=Visual Studio Code",
              "--urgency=normal",
              safeTitle,
              safeBody,
            ],
          },
          {
            command: "kdialog",
            args: ["--title", safeTitle, "--passivepopup", safeBody, "5"],
          },
          {
            command: "zenity",
            args: ["--notification", `--text=${safeTitle}\n${safeBody}`],
          },
        ];

        for (const candidate of linuxCandidates) {
          try {
            await this.execFileAsync(candidate.command, candidate.args);
            return true;
          } catch (candidateError) {
            const err = candidateError as NodeJS.ErrnoException;
            if (err?.code === "ENOENT") {
              continue;
            }

            logger.warn(
              `Native notification command failed (${candidate.command}), trying next backend`,
              candidateError
            );
          }
        }

        logger.warn(
          "No supported Linux notification backend found. Install one of: libnotify-bin (notify-send), kdialog, or zenity"
        );
        return false;
      }

      if (process.platform === "darwin") {
        const esc = (value: string) =>
          value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = `display notification "${esc(safeBody)}" with title "${esc(
          safeTitle
        )}"`;

        await this.execFileAsync("osascript", ["-e", script]);
        return true;
      }

      if (process.platform === "win32") {
        return this.tryWindowsNativeNotification(
          safeTitle,
          safeBody,
          windowsContext
        );
      }
    } catch (error) {
      logger.warn("Native widget notification failed, using VS Code fallback", error);
    }

    return false;
  }

  private isWslEnvironment(): boolean {
    const remoteName = (vscode.env.remoteName || "").toLowerCase();
    const hasWslEnvVars =
      !!process.env.WSL_DISTRO_NAME ||
      !!process.env.WSL_INTEROP ||
      !!process.env.WSLENV;
    const kernelRelease = process.platform === "linux" ? os.release().toLowerCase() : "";
    const kernelLooksLikeWsl = kernelRelease.includes("microsoft");

    if (remoteName === "wsl" || remoteName.startsWith("wsl+")) {
      return true;
    }

    if (hasWslEnvVars) {
      return true;
    }

    if (process.platform !== "linux") {
      return false;
    }

    // Some VS Code remote hosts sanitize env vars; kernel release still typically contains "microsoft" on WSL.
    return kernelLooksLikeWsl;
  }

  private getWindowsNotificationContext(): {
    notifierAppId: string;
    protocolUri: string;
    processNameHint: string;
    appTitleHint: string;
    workspaceHint: string;
    panelTitleHint: string;
  } {
    const appName = String(vscode.env.appName || "Visual Studio Code");
    const isInsiders = /insiders/i.test(appName);

    return {
      notifierAppId: isInsiders
        ? "Microsoft.VisualStudioCodeInsiders"
        : "Microsoft.VisualStudioCode",
      protocolUri: isInsiders ? "vscode-insiders:///" : "vscode:///",
      processNameHint: isInsiders ? "Code - Insiders" : "Code",
      appTitleHint: isInsiders ? "Visual Studio Code - Insiders" : "Visual Studio Code",
      workspaceHint: vscode.workspace.name || "",
      panelTitleHint: this.getPanelTitleHint(),
    };
  }

  private async tryWindowsNativeNotification(
    title: string,
    body: string,
    context: {
      notifierAppId: string;
      protocolUri: string;
      processNameHint: string;
      appTitleHint: string;
      workspaceHint: string;
      panelTitleHint: string;
    }
  ): Promise<boolean> {
    const script = this.buildWindowsNotificationScript(title, body, context);
    const scriptBase64 = Buffer.from(script, "utf16le").toString("base64");
    const candidates: Array<{ command: string; args: string[] }> = [
      {
        command: "powershell",
        args: ["-NoProfile", "-EncodedCommand", scriptBase64],
      },
      {
        command: "pwsh",
        args: ["-NoProfile", "-EncodedCommand", scriptBase64],
      },
      {
        command: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        args: ["-NoProfile", "-EncodedCommand", scriptBase64],
      },
      {
        command: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        args: ["-NoProfile", "-EncodedCommand", scriptBase64],
      },
      {
        command: "cmd",
        args: [
          "/d",
          "/c",
          "powershell",
          "-NoProfile",
          "-EncodedCommand",
          scriptBase64,
        ],
      },
    ];

    for (const candidate of candidates) {
      try {
        await this.execFileAsync(candidate.command, candidate.args);
        return true;
      } catch (error) {
        const err = error as NodeJS.ErrnoException & {
          stderr?: string;
          stdout?: string;
        };
        if (err?.code === "ENOENT") {
          continue;
        }

        logger.warn(
          `Windows notification command failed (${candidate.command}), trying next backend`,
          {
            code: err?.code,
            message: err?.message,
            stderr: err?.stderr?.slice(0, 500),
            stdout: err?.stdout?.slice(0, 500),
            cmd: (err as any)?.cmd,
          }
        );
      }
    }

    return false;
  }

  private async tryWslWindowsNotification(
    title: string,
    body: string,
    context: {
      notifierAppId: string;
      protocolUri: string;
      processNameHint: string;
      appTitleHint: string;
      workspaceHint: string;
      panelTitleHint: string;
    }
  ): Promise<boolean> {
    const script = this.buildWindowsNotificationScript(title, body, context);
    const scriptBase64 = Buffer.from(script, "utf16le").toString("base64");
    const candidates: Array<{ command: string; args: string[] }> = [
      {
        command: "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
        args: ["-NoProfile", "-EncodedCommand", scriptBase64],
      },
      {
        command: "/mnt/c/Program Files/PowerShell/7/pwsh.exe",
        args: ["-NoProfile", "-EncodedCommand", scriptBase64],
      },
      {
        command: "/mnt/c/Windows/System32/cmd.exe",
        args: [
          "/d",
          "/c",
          "powershell.exe",
          "-NoProfile",
          "-EncodedCommand",
          scriptBase64,
        ],
      },
      {
        command: "powershell.exe",
        args: ["-NoProfile", "-EncodedCommand", scriptBase64],
      },
      {
        command: "pwsh.exe",
        args: ["-NoProfile", "-EncodedCommand", scriptBase64],
      },
      {
        command: "cmd.exe",
        args: [
          "/d",
          "/c",
          "powershell.exe",
          "-NoProfile",
          "-EncodedCommand",
          scriptBase64,
        ],
      },
    ];

    for (const candidate of candidates) {
      try {
        await this.execFileAsync(candidate.command, candidate.args);
        return true;
      } catch (error) {
        const err = error as NodeJS.ErrnoException & {
          stderr?: string;
          stdout?: string;
        };
        if (err?.code === "ENOENT") {
          logger.warn(
            `WSL Windows notification command failed (${candidate.command}), command not found, trying next command`,
            error
          );
          continue;
        }

        logger.warn(
          `WSL Windows notification command failed (${candidate.command}), trying next command`,
          {
            code: err?.code,
            message: err?.message,
            stderr: err?.stderr?.slice(0, 500),
            stdout: err?.stdout?.slice(0, 500),
            cmd: (err as any)?.cmd,
          }
        );
      }
    }
    logger.warn(
      `WSL Windows notification command failed, trying next backend`
    );
    return false;
  }

  private buildWindowsNotificationScript(
    title: string,
    body: string,
    context: {
      notifierAppId: string;
      protocolUri: string;
      processNameHint: string;
      appTitleHint: string;
      workspaceHint: string;
      panelTitleHint: string;
    }
  ): string {
    const psEscape = (value: string) => value.replace(/'/g, "''");
    const xmlEscape = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    const actionLabel = context.appTitleHint || "Visual Studio Code";

    const toastXml = [
      `<toast scenario="alarm" duration="long" launch="${xmlEscape(
        context.protocolUri
      )}">`,
      '<visual><binding template="ToastGeneric">',
      `<text>${xmlEscape(title)}</text>`,
      `<text>${xmlEscape(body)}</text>`,
      "</binding></visual>",
      `<actions><action content="Open ${xmlEscape(
        actionLabel
      )}" activationType="protocol" arguments="${xmlEscape(
        context.protocolUri
      )}"/><action content="Dismiss" activationType="system" arguments="dismiss"/></actions>`,
      '<audio src="ms-winsoundevent:Notification.Looping.Alarm2" loop="true"/>',
      "</toast>",
    ].join("");

    return [
      "$ErrorActionPreference = 'Stop'",
      `$title = '${psEscape(title)}'`,
      `$body = '${psEscape(body)}'`,
      `$xml = '${psEscape(toastXml)}'`,
      `$appId = '${psEscape(context.notifierAppId)}'`,
      `$processNameHint = '${psEscape(context.processNameHint)}'`,
      `$appTitleHint = '${psEscape(context.appTitleHint)}'`,
      `$workspaceHint = '${psEscape(context.workspaceHint)}'`,
      `$panelTitleHint = '${psEscape(context.panelTitleHint)}'`,
      "try {",
      "  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
      "  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
      "  $xmlDoc = New-Object Windows.Data.Xml.Dom.XmlDocument",
      "  $xmlDoc.LoadXml($xml)",
      "  $toast = [Windows.UI.Notifications.ToastNotification]::new($xmlDoc)",
      "  $toast.Tag = 'markdown-editor-widget'",
      "  $toast.Group = 'markdown-editor'",
      "  $shown = $false",
      "  $appIdCandidates = @($appId, 'Microsoft.VisualStudioCodeInsiders', 'Microsoft.VisualStudioCode', 'Visual Studio Code') | Select-Object -Unique",
      "  foreach ($candidateId in $appIdCandidates) {",
      "    try {",
      "      $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($candidateId)",
      "      $notifier.Show($toast)",
      "      $shown = $true",
      "      break",
      "    } catch { }",
      "  }",
      "  if (-not $shown) { throw 'No toast notifier accepted the app IDs' }",
      "} catch {",
      "  Add-Type -AssemblyName System.Windows.Forms",
      "  Add-Type -AssemblyName System.Drawing",
      "  $fallback = New-Object System.Windows.Forms.NotifyIcon",
      "  $fallback.Icon = [System.Drawing.SystemIcons]::Information",
      "  $fallback.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info",
      "  $fallback.BalloonTipTitle = $title",
      "  $fallback.BalloonTipText = $body",
      "  $fallback.Visible = $true",
      "  $fallback.ShowBalloonTip(30000)",
      "  Start-Sleep -Milliseconds 30500",
      "  $fallback.Dispose()",
      "}",
      "try {",
      "  $flashType = 'using System;using System.Runtime.InteropServices;namespace MarkdownEditorWin32 { [StructLayout(LayoutKind.Sequential)] public struct FLASHWINFO { public UInt32 cbSize; public IntPtr hwnd; public UInt32 dwFlags; public UInt32 uCount; public UInt32 dwTimeout; } public static class NativeMethods { [DllImport(\"user32.dll\")] public static extern bool FlashWindowEx(ref FLASHWINFO pwfi); } }'",
      "  Add-Type -TypeDefinition $flashType -Language CSharp",
      "  $windows = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }",
      "  if ($processNameHint) {",
      "    $nameFiltered = $windows | Where-Object { $_.ProcessName -eq $processNameHint -or $_.ProcessName -like ($processNameHint + '*') }",
      "    if ($nameFiltered) { $windows = $nameFiltered }",
      "  }",
      "  $vscode = $null",
      "  if ($workspaceHint) { $vscode = $windows | Where-Object { $_.MainWindowTitle -like ('*' + $workspaceHint + '*') } | Select-Object -First 1 }",
      "  if (-not $vscode -and $panelTitleHint) { $vscode = $windows | Where-Object { $_.MainWindowTitle -like ('*' + $panelTitleHint + '*') } | Select-Object -First 1 }",
      "  if (-not $vscode -and $appTitleHint) { $vscode = $windows | Where-Object { $_.MainWindowTitle -like ('*' + $appTitleHint + '*') } | Select-Object -First 1 }",
      "  if (-not $vscode) { $vscode = $windows | Select-Object -First 1 }",
      "  if ($vscode) {",
      "    $flash = [MarkdownEditorWin32.FLASHWINFO]::new()",
      "    $flash.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($flash)",
      "    $flash.hwnd = $vscode.MainWindowHandle",
      "    $flash.dwFlags = 14",
      "    $flash.uCount = 5",
      "    $flash.dwTimeout = 0",
      "    [MarkdownEditorWin32.NativeMethods]::FlashWindowEx([ref]$flash) | Out-Null",
      "  }",
      "} catch { }",
    ].join(";");
  }

  private execFileAsync(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(command, args, (error, stdout, stderr) => {
        if (error) {
          const execError = error as NodeJS.ErrnoException & {
            stdout?: string;
            stderr?: string;
          };
          execError.stdout = stdout;
          execError.stderr = stderr;
          reject(execError);
          return;
        }
        resolve();
      });
    });
  }
}
