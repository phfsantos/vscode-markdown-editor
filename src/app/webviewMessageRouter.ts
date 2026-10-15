import {
  createMessageRejection,
  parseWebviewToHostMessage,
  type MessageOf,
  type MessageRejection,
  type WebviewToHostCommand,
  type WebviewToHostMessage,
} from "@markdown-editor/core";

export type WebviewMessage<C extends WebviewToHostCommand> = MessageOf<WebviewToHostMessage, C>;

export type WebviewMessageRoute<C extends WebviewToHostCommand> = (
  message: WebviewMessage<C>,
) => unknown;

/**
 * A cohesive set of handlers for the webview commands one feature owns.
 * Each feature controller exposes its own group; EditorPanel only composes them.
 */
export type WebviewMessageRoutes = {
  [C in WebviewToHostCommand]?: WebviewMessageRoute<C>;
};

/**
 * Handles webview input owned by a separate contract (for example renderer
 * persistence). Returns true when it consumed the message.
 */
export type WebviewMessageDelegate = (raw: unknown) => Promise<boolean>;

export type WebviewRouteOutcome = "handled" | "ignored" | "rejected";

export interface WebviewMessageRouterOptions {
  routeGroups: WebviewMessageRoutes[];
  delegates?: WebviewMessageDelegate[];
  /** Report a malformed known command back to its sender. */
  reject(rejection: MessageRejection): void;
}

export function createWebviewMessageRouter(
  options: WebviewMessageRouterOptions,
): (raw: unknown) => Promise<WebviewRouteOutcome> {
  const routes = mergeRouteGroups(options.routeGroups);
  const delegates = options.delegates ?? [];

  return async (raw) => {
    for (const delegate of delegates) {
      if (await delegate(raw)) {
        return "handled";
      }
    }

    const parsed = parseWebviewToHostMessage(raw);
    if (parsed.kind === "malformed") {
      options.reject(createMessageRejection(parsed.command, parsed.issues));
      return "rejected";
    }
    if (parsed.kind === "unknown") {
      return "ignored";
    }

    const route = routes.get(parsed.message.command);
    if (!route) {
      return "ignored";
    }
    await route(parsed.message);
    return "handled";
  };
}

function mergeRouteGroups(
  groups: WebviewMessageRoutes[],
): Map<WebviewToHostCommand, (message: WebviewToHostMessage) => unknown> {
  const routes = new Map<WebviewToHostCommand, (message: WebviewToHostMessage) => unknown>();
  for (const group of groups) {
    for (const command of Object.keys(group) as WebviewToHostCommand[]) {
      if (routes.has(command)) {
        throw new Error(`Webview command "${command}" is routed by more than one group`);
      }
      const route = group[command] as ((message: WebviewToHostMessage) => unknown) | undefined;
      if (route) {
        routes.set(command, route);
      }
    }
  }
  return routes;
}
