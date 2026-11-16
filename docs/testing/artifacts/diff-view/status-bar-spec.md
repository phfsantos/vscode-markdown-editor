# Diff status bar specification

Replaces the old sticky diff header. Findings issue 3: the header was 37 px tall,
positioned `sticky; top:0; z-index:1000`, painted over the 36 px Vditor toolbar,
used emoji labels and inline styles. Before:
[before/header-over-toolbar.png](before/header-over-toolbar.png).

## Placement

- The bar is a **block in normal flow inside `.vditor`, directly after
  `.vditor-toolbar`** and before `.vditor-content`. It is never positioned over
  anything, so it cannot cover the toolbar at any width.
- It has a fixed height of **24 px** (`--md-diff-statusbar-height`), which keeps it
  inside the 28 px budget. While a diff is active, `.vditor-content` shrinks by the
  same 24 px (`body.md-diff-active`), so the page never scrolls as a whole.
- On a **read-only side** the toolbar is **disabled, not removed**. It is `inert`
  and `aria-disabled`, dimmed to 40 % with `pointer-events: none`, so neither
  pointer nor keyboard can operate it. It keeps its height, so both panes start at
  the same y and aligned rows sit level across the split. Hiding it was tried
  first: it shifted the read-only pane about 52 px and is rejected.
- In the single-view pending-edit mode the bar sits under the toolbar of the
  editable document.

## Contents, left to right

| Element | Content | Notes |
| --- | --- | --- |
| Role | `Original` / `Modified` / `Pending changes` | Plain text, weight 600, `--vscode-foreground`. It is the first item and truncates with an ellipsis. |
| Read-only badge | `Read-only` | Badge tokens (`--vscode-badge-*`) with a `--vscode-contrastBorder` outline in high contrast. Shown only on a read-only side. |
| Message | `Comparing…` while loading, or the error text | `--vscode-errorForeground` when `data-diff-state="error"`. It replaces the counts. |
| Counts | `+a −d ~m` | Pushed right (`margin-left:auto`), tabular figures. Coloured with `gitDecoration.added/deleted/modifiedResourceForeground`. Each count has `aria-label="N added"` etc. |
| Navigation | ▲ / ▼ (inline SVG chevrons) | 20×20 buttons labelled *Previous change* / *Next change*. `--vscode-toolbar-hoverBackground` on hover and `--vscode-focusBorder` on focus. Disabled when there are no changes or the diff is not ready. |

- **No emoji.**
- The bar is a `role="status"`, `aria-live="polite"` region, so role, state and
  counts are announced once when they change.
- `data-diff-statusbar`, `data-diff-role` (`original|modified|pending`),
  `data-diff-state` (`loading|ready|error`) and `data-read-only` are the stable
  test hooks.

## Theme tokens

- **Background:** `--vscode-editorWidget-background`, falling back to
  `--vscode-editor-background`.
- **Bottom border:** `--vscode-panel-border`.
- **Base text:** `--vscode-descriptionForeground`.
- **Font:** 12 px `--vscode-font-family`.
- **Hard-coded colours:** only as `var()` fallbacks.
- **Light, dark and high contrast:** all follow from the tokens. The two
  high-contrast themes also outline the previous-version rows
  (`--vscode-contrastBorder`).

## Narrow widths

- **≤ 420 px:** the read-only badge text is dropped (read-only is still implied
  by the missing toolbar) and the padding tightens.
- **Always kept:** the role, counts and navigation.
- **No wrapping:** the bar never wraps (`white-space: nowrap; overflow: hidden`).
  The role and message truncate first.
- **Verified at:** 1280 px and 600 px pane widths by the UI suite.

## Error state

When the host reports `diff-view-failed` (a render timeout, or an editor that
could not return its content), the bar shows `data-diff-state="error"` with the
reason instead of counts. A missing diff is never silent.

## Evidence

- **Before:** [before/header-over-toolbar.png](before/header-over-toolbar.png)
- **After:** `after/*.png` from `yarn test:ui --grep "Diff view"` (see the UI
  results in [../../diff-view-findings.md](../../diff-view-findings.md)).
