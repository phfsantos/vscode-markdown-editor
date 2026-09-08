import { afterEach, expect, test, vi } from "vitest";
import { updateAIMarkdownUI, type AIMarkdownWebviewState } from "../packages/media/src/ai-markdown-ui";

function state(overrides: Partial<AIMarkdownWebviewState> = {}): AIMarkdownWebviewState {
  return {
    isAIMarkdown: true,
    kind: "agent",
    badgeLabel: "Agent",
    description: "Instructions for an AI agent.",
    suggestedSections: ["Role", "Instructions"],
    relativePath: ".github/agents/reviewer.agent.md",
    hasPendingChatEdits: false,
    availability: {
      enabled: true,
      affordancesEnabled: true,
      chatInteropEnabled: true,
      provider: "copilotChat",
      providerInstalled: true,
      status: "ready",
      statusLabel: "Copilot Chat ready.",
      detail: "Copy context or open chat to continue.",
    },
    ...overrides,
  };
}

function button(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(element, `Expected button: ${label}`).not.toBeNull();
  return element!;
}

function expand(): void {
  button("Open AI markdown tools").click();
}

afterEach(() => {
  // Reset persistent expansion through the public UI before removing its root.
  // Re-render first in case a hidden-state transition removed an expanded panel.
  updateAIMarkdownUI(state(), { postMessage: vi.fn() });
  document.querySelector<HTMLButtonElement>('button[aria-label="Collapse AI markdown tools"]')?.click();
  updateAIMarkdownUI(undefined, { postMessage: vi.fn() });
});

const hiddenStates: Array<[string, AIMarkdownWebviewState | undefined]> = [
  ["missing state", undefined],
  ["disabled affordances", state({ availability: { ...state().availability, affordancesEnabled: false } })],
  ["plain markdown with affordances enabled", state({ isAIMarkdown: false, kind: "markdown" })],
];

for (const [name, hiddenState] of hiddenStates) {
  test(`${name} does not render AI tools`, () => {
    const target = { postMessage: vi.fn() };
    updateAIMarkdownUI(hiddenState, target);
    expect(document.querySelector("#ai-markdown-panel")).toBeNull();
    expect(target.postMessage).not.toHaveBeenCalled();
  });

  test(`${name} removes previously visible AI tools`, () => {
    const target = { postMessage: vi.fn() };
    updateAIMarkdownUI(state(), target);
    expand();
    expect(document.querySelector('[aria-label="AI markdown tools"]')).not.toBeNull();
    updateAIMarkdownUI(hiddenState, target);
    expect(document.querySelector("#ai-markdown-panel")).toBeNull();
    expect(target.postMessage).not.toHaveBeenCalled();
  });
}

test("AI tools start collapsed and show document badge and provider status when opened", () => {
  const current = state();
  const target = { postMessage: vi.fn() };
  updateAIMarkdownUI(current, target);
  expect(button("Open AI markdown tools").getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector(".ai-markdown-header")).toBeNull();
  expand();
  expect(document.querySelector(".ai-markdown-badge")?.textContent).toBe(current.badgeLabel);
  expect(document.querySelector(".ai-markdown-title")?.textContent).toBe(current.relativePath);
  expect(document.querySelector(".ai-markdown-description")?.textContent).toBe(current.description);
  expect(document.querySelector(".ai-markdown-status")?.textContent).toBe(
    `${current.availability.statusLabel} ${current.availability.detail}`,
  );
  expect(document.querySelector(".ai-markdown-sections")?.textContent).toBe("Suggested sections: Role · Instructions");
  button("Collapse AI markdown tools").click();
  expect(document.querySelector(".ai-markdown-header")).toBeNull();
  expect(button("Open AI markdown tools").getAttribute("aria-expanded")).toBe("false");
  expect(target.postMessage).not.toHaveBeenCalled();
});

test("pending edits chip appears and disappears as chat edit state changes", () => {
  const target = { postMessage: vi.fn() };
  updateAIMarkdownUI(state(), target);
  expand();
  expect(document.querySelector(".ai-markdown-chip")).toBeNull();
  updateAIMarkdownUI(state({ hasPendingChatEdits: true }), target);
  expect(document.querySelectorAll(".ai-markdown-chip")).toHaveLength(1);
  expect(document.querySelector(".ai-markdown-chip")?.textContent).toBe("Pending AI edits detected in the current file.");
  updateAIMarkdownUI(state({ hasPendingChatEdits: false }), target);
  expect(document.querySelector(".ai-markdown-chip")).toBeNull();
});

test.each([
  ["Copy Context", "copyContext"],
  ["Insert Context", "insertContext"],
  ["Insert Template", "insertTemplate"],
  ["Open Chat", "openChat"],
  ["Open Graph", "openGraph"],
  ["Validate", "validate"],
])("%s dispatches its AI action once", (label, action) => {
  const target = { postMessage: vi.fn() };
  updateAIMarkdownUI(state(), target);
  expand();
  expect(target.postMessage).not.toHaveBeenCalled();
  button(label).click();
  expect(target.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "requestAiAction", action });
});
