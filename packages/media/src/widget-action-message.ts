import type { MessageOf, WebviewToHostMessage } from "@markdown-editor/core";

export type WidgetActionMessage = MessageOf<WebviewToHostMessage, "widget-action">;

/** The `button-action` DOM event detail dispatched by interactive widgets. */
export interface WidgetActionDetail {
  actionType?: string;
  action?: unknown;
  value?: unknown;
  data?: unknown;
  targetWidget?: string;
  widgetId?: unknown;
  timestamp?: string;
}

/**
 * Build the host-bound `widget-action` message from a widget's `button-action`
 * event. This is the only path widget actions take to the extension host.
 */
export function toWidgetActionMessage(detail: WidgetActionDetail): WidgetActionMessage {
  return {
    command: "widget-action",
    actionType: detail.actionType as WidgetActionMessage["actionType"],
    action: detail.action,
    value: detail.value,
    data: detail.data,
    targetWidget: detail.targetWidget,
    widgetId: detail.widgetId,
  };
}
