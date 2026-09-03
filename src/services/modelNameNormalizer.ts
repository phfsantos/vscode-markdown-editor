/**
 * Versions <= 0.4.15 shipped typo'd model ids ("gtp-4o", "gtp-4o-mini") in the
 * markdown-editor.ai.modelName enum, so users may have those persisted in
 * settings. Normalize them at read time instead of breaking saved configs.
 */
const LEGACY_MODEL_NAME_MAP: Record<string, string> = {
  'gtp-4o-mini': 'gpt-4o-mini',
  'gtp-4o': 'gpt-4o',
};

/** Auto-selection priority for inline suggestions (fastest first). */
export const PREFERRED_MODEL_ORDER = [
  'copilot-fast',
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1',
  'oswe-vscode-prime',
];

export function normalizeModelName(modelName: string | undefined): string {
  if (!modelName) {
    return 'auto';
  }

  return LEGACY_MODEL_NAME_MAP[modelName] ?? modelName;
}
