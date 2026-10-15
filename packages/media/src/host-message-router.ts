import {
  parseHostToWebviewMessage,
  type HostToWebviewCommand,
  type HostToWebviewMessage,
  type MessageOf,
} from "@markdown-editor/core";

export type HostMessage<C extends HostToWebviewCommand> = MessageOf<HostToWebviewMessage, C>;

export type HostMessageRoute<C extends HostToWebviewCommand> = (message: HostMessage<C>) => void;

/** A cohesive set of handlers for the host commands one webview feature owns. */
export type HostMessageRoutes = {
  [C in HostToWebviewCommand]?: HostMessageRoute<C>;
};

export type HostRouteOutcome = "handled" | "ignored" | "rejected";

export interface HostMessageRouterOptions {
  routeGroups: HostMessageRoutes[];
  /** Called for a known host command whose payload violates the contract. */
  reportMalformed(command: string, issues: string[]): void;
}

/**
 * Parse host messages against the shared protocol and dispatch each one to the
 * route group that owns its command. Messages for other listeners (diff
 * visualizer, widgets) are ignored rather than rejected.
 */
export function createHostMessageRouter(
  options: HostMessageRouterOptions,
): (raw: unknown) => HostRouteOutcome {
  const routes = new Map<HostToWebviewCommand, (message: HostToWebviewMessage) => void>();
  for (const group of options.routeGroups) {
    for (const command of Object.keys(group) as HostToWebviewCommand[]) {
      if (routes.has(command)) {
        throw new Error(`Host command "${command}" is routed by more than one group`);
      }
      routes.set(command, group[command] as (message: HostToWebviewMessage) => void);
    }
  }

  return (raw) => {
    const parsed = parseHostToWebviewMessage(raw);
    if (parsed.kind === "malformed") {
      options.reportMalformed(parsed.command, parsed.issues);
      return "rejected";
    }
    if (parsed.kind === "unknown") {
      return "ignored";
    }

    const route = routes.get(parsed.message.command);
    if (!route) {
      return "ignored";
    }
    route(parsed.message);
    return "handled";
  };
}
