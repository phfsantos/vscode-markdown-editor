/**
 * Save-path cleaning: strips transient decorations (diagnostics, diff, gutters,
 * inline suggestions) from the IR DOM before Lute converts it to Markdown.
 * Kept free of webview globals so browser and unit tests import the shipped code.
 *
 * Diff artifacts are removed structurally on a detached clone (whole nodes and
 * owned attributes), never by regex over serialized HTML: a non-greedy regex
 * stops at the first closing tag and leaks nested deleted content (findings S5).
 */

/** Nodes the diff view (or its legacy spacer path) may have left inside the editable DOM. */
const DIFF_ARTIFACT_SELECTOR = "[data-diff-artifact], [data-diff-previous], [data-diff-spacer], .diff-spacer-block, [data-temp-measurement]";
/** Attributes the diff view writes onto Vditor's own nodes. */
const DIFF_ATTRIBUTES = ["data-diff-line", "data-diff-type", "data-diff-gap", "data-decoration-id", "data-diff-spacer"];

/** Remove every diff-owned node and attribute from a detached copy of `root` and return its HTML. */
export function cleanDiffArtifactsFromDom(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll(DIFF_ARTIFACT_SELECTOR).forEach((node) => node.remove());
  const owned = DIFF_ATTRIBUTES.map((name) => `[${name}]`).join(",");
  for (const element of [clone, ...Array.from(clone.querySelectorAll(owned))]) {
    for (const name of DIFF_ATTRIBUTES) element.removeAttribute(name);
  }
  return clone.innerHTML;
}

// Regex patterns for content cleaning - extracted for performance and maintainability
const REGEX_DIAGNOSTIC_SPAN = /<span\s+(?:[^>]*\s+)?class="[^"]*\bvscode-diagnostic-[^"\s]*[^"]*"[^>]*>(.*?)<\/span>/g;
const REGEX_DIAGNOSTIC_SOURCE_ATTR = /\s+data-diagnostic-source="[^"]*"/g;
const REGEX_DIFF_SPAN = /<span\s+(?:[^>]*\s+)?class="[^"]*\bvscode-diff-(?:added|removed|modified)\b[^"]*"[^>]*>(.*?)<\/span>/g;
const REGEX_LINE_NUMBER_GUTTER = /<div[^>]*\bdata-vditor-line-number-gutter="true"[^>]*>[\s\S]*?<\/div>/g;
const REGEX_INLINE_SUGGESTION_MARKER = /<span[^>]*\bdata-inline-suggestion-marker="true"[^>]*>[\s\S]*?<\/span>/g;
const REGEX_TOOL_SELECTOR_WIDGET = /<span[^>]*\bdata-tool-selector-widget="true"[^>]*>[\s\S]*?<\/span>/g;
const REGEX_DATA_INLINE_SUGGESTION = /\s+data-inline-suggestion="[^"]*"/g;
const REGEX_DATA_INLINE_SUGGESTION_MARKER = /\s+data-inline-suggestion-marker="[^"]*"/g;
const REGEX_DATA_LINE_NUMBER = /\s+data-line-number="[^"]*"/g;
const REGEX_DATA_SOURCE_LINE = /\s+data-source-line="[^"]*"/g;
const REGEX_DATA_RENDERED_LINE_NUMBER = /\s+data-rendered-line-number="[^"]*"/g;
const REGEX_DATA_LINE_TARGET_DEPTH = /\s+data-line-target-depth="[^"]*"/g;
const REGEX_DATA_LINE_NUMBER_ANCHOR = /\s+data-line-number-anchor="[^"]*"/g;
const REGEX_DATA_HAS_LINE_NUMBERS = /\s+data-has-line-numbers="[^"]*"/g;
const REGEX_DATA_VDITOR_LINE_NUMBER = /\s+data-vditor-line-number="[^"]*"/g;
const REGEX_DATA_VDITOR_LINE_NUMBER_GUTTER = /\s+data-vditor-line-number-gutter="[^"]*"/g;
const REGEX_LIGHTBULB_EMOJI = /💡/g;
const REGEX_LOCK_EMOJI = /🔒/g;
const REGEX_DECORATION_STYLES = /\s+style="[^"]*(?:text-decoration|background-color|border-bottom|border-left|padding-left|padding-bottom|pointer-events|user-select|cursor|opacity|display|background|position|min-height|top:|height:)[^"]*"/g;
const REGEX_SPACER_COMMENT = /<!--\s*vscode-diff-spacer:\s*\d+\s*-->/g;
const REGEX_CONTENTEDITABLE_FALSE = /\s+contenteditable="false"/g;
const REGEX_EMPTY_SPAN = /<span><\/span>/g;

function replaceUntilStable(value: string, pattern: RegExp, replacement: string): string {
  let previous = "";
  let current = value;
  while (previous !== current) {
    previous = current;
    current = current.replace(pattern, replacement);
  }
  return current;
}

/**
 * Clean HTML/markdown content by removing diagnostic and decoration artifacts.
 * Diff artifacts must already be gone (cleanDiffArtifactsFromDom); this pass
 * handles the remaining transient markup.
 * @param content The raw IR HTML
 * @returns Cleaned content without transient decorations
 */
export function cleanContentForSave(content: string): string {
  if (!content) return content;

  let cleaned = content;
  // String callers: drop diff artifacts structurally too, in an inert document (no loads, no scripts).
  if (typeof document !== "undefined" && /data-diff-|diff-spacer|data-temp-measurement/.test(cleaned)) {
    const container = document.implementation.createHTMLDocument("").createElement("div");
    container.innerHTML = cleaned;
    cleaned = cleanDiffArtifactsFromDom(container);
  }
  // Activity UI belongs outside Vditor; defense against accidental transient markup.
  cleaned = cleaned.replace(/<(span|div)[^>]*\bdata-agent-activity="true"[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/\s+data-agent-activity(?:-[\w-]+)?="[^"]*"/g, "");

  cleaned = replaceUntilStable(cleaned, REGEX_DIAGNOSTIC_SPAN, "$1");
  cleaned = cleaned.replace(REGEX_DIAGNOSTIC_SOURCE_ATTR, "");
  cleaned = replaceUntilStable(cleaned, REGEX_LINE_NUMBER_GUTTER, "");
  cleaned = replaceUntilStable(cleaned, REGEX_INLINE_SUGGESTION_MARKER, "");
  cleaned = replaceUntilStable(cleaned, REGEX_TOOL_SELECTOR_WIDGET, "");

  cleaned = cleaned.replace(REGEX_DATA_INLINE_SUGGESTION, "");
  cleaned = cleaned.replace(REGEX_DATA_INLINE_SUGGESTION_MARKER, "");
  cleaned = cleaned.replace(REGEX_DATA_LINE_NUMBER, "");
  cleaned = cleaned.replace(REGEX_DATA_SOURCE_LINE, "");
  cleaned = cleaned.replace(REGEX_DATA_RENDERED_LINE_NUMBER, "");
  cleaned = cleaned.replace(REGEX_DATA_LINE_TARGET_DEPTH, "");
  cleaned = cleaned.replace(REGEX_DATA_LINE_NUMBER_ANCHOR, "");
  cleaned = cleaned.replace(REGEX_DATA_HAS_LINE_NUMBERS, "");
  cleaned = cleaned.replace(REGEX_DATA_VDITOR_LINE_NUMBER, "");
  cleaned = cleaned.replace(REGEX_DATA_VDITOR_LINE_NUMBER_GUTTER, "");

  cleaned = replaceUntilStable(cleaned, REGEX_DIFF_SPAN, "$1");
  cleaned = cleaned.replace(REGEX_LIGHTBULB_EMOJI, "");
  cleaned = cleaned.replace(REGEX_LOCK_EMOJI, "");
  cleaned = cleaned.replace(REGEX_DECORATION_STYLES, "");
  cleaned = cleaned.replace(REGEX_SPACER_COMMENT, "");
  cleaned = cleaned.replace(REGEX_CONTENTEDITABLE_FALSE, "");
  cleaned = cleaned.replace(REGEX_EMPTY_SPAN, "");

  return cleaned;
}

/** The IR DOM as save-ready HTML: diff artifacts removed structurally, then transient markup. */
export function cleanEditorHtmlForSave(root: Element): string {
  return cleanContentForSave(cleanDiffArtifactsFromDom(root));
}

/**
 * Get cleaned HTML content from Vditor instance
 * @param vditor The Vditor instance
 * @returns Cleaned HTML content
 */
export const getHTML = (vditor: IVditor) => {
  return vditor.lute.VditorIRDOM2HTML(cleanEditorHtmlForSave(vditor.ir.element));
};

/**
 * Get cleaned markdown content from Vditor instance
 * @param vditor The Vditor instance
 * @returns Cleaned markdown content
 */
export const getValue = (vditor: IVditor) => {
  return vditor.lute.VditorIRDOM2Md(cleanEditorHtmlForSave(vditor.ir.element));
};
