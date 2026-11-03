/**
 * Forwards calendar widget DOM events to the extension host. Host replies come
 * back through main.ts's calendar routes as `calendar-*` window events.
 */

type PostToHost = (message: Record<string, unknown>) => void;

const SIGN_OUT_PROVIDERS = ["google", "outlook"];

export function installCalendarBridge(target: EventTarget, post: PostToHost): () => void {
  const listeners: Record<string, (detail: Record<string, any>) => void> = {
    "calendar-request": ({ provider, date, requestId }) => {
      post({
        command: "calendar-request",
        provider: provider || "all",
        date: date || new Date().toISOString().split("T")[0],
        requestId,
      });
    },
    "calendar-auth": ({ provider, requestId }) => {
      post({
        command: "calendar-auth",
        provider: provider || "outlook", // Default to Outlook as it's better supported
        requestId,
      });
    },
    "calendar-signout": ({ provider, requestId }) => {
      // The host would reject this as malformed and never answer, so the
      // widget gets its failure outcome here instead.
      if (!SIGN_OUT_PROVIDERS.includes(provider)) {
        target.dispatchEvent(new CustomEvent("calendar-signout-result", {
          detail: { requestId, provider, success: false, error: "A calendar provider is required to sign out" },
          bubbles: true,
        }));
        return;
      }
      post({ command: "calendar-signout", provider, requestId });
    },
    "calendar-event-action": ({ action, eventData }) => {
      if (action === "join" && eventData?.link) {
        post({ command: "open-link", href: eventData.link });
      }
    },
  };

  const installed = Object.entries(listeners).map(([type, handle]) => {
    const listener = (event: Event) => handle((event as CustomEvent).detail || {});
    target.addEventListener(type, listener);
    return () => target.removeEventListener(type, listener);
  });

  return () => installed.forEach((remove) => remove());
}
