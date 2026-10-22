import { afterEach, describe, expect, test } from "vitest";
import "vditor/dist/index.css";
import "../packages/media/src/main.css";
import darkContentTheme from "vditor/dist/css/content-theme/dark.css?raw";

// Representative VS Code themes: GitHub Dark and Light Modern editor colours.
const THEMES = {
  dark: { "--vscode-editor-background": "#0d1117", "--vscode-editor-foreground": "#c9d1d9" },
  light: { "--vscode-editor-background": "#ffffff", "--vscode-editor-foreground": "#3b3b3b" },
};

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba {
  const parts = value.match(/[\d.]+/g)!.map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

// Composite translucent backgrounds from the element up to the first opaque one.
function effectiveBackground(element: Element): Rgba {
  const layers: Rgba[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (color[3] > 0) layers.push(color);
    if (color[3] === 1) break;
  }
  return layers.reduceRight<Rgba>(
    (base, [r, g, b, a]) => [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a), 1],
    [255, 255, 255, 1],
  );
}

function luminance([r, g, b]: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(element: Element): number {
  const fg = luminance(parseColor(getComputedStyle(element).color));
  const bg = luminance(effectiveBackground(element));
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

function renderTable(kind: keyof typeof THEMES) {
  for (const [name, value] of Object.entries(THEMES[kind])) {
    document.documentElement.style.setProperty(name, value);
  }
  document.body.innerHTML = `
    <div class="vditor ${kind === "dark" ? "vditor--dark" : ""}">
      <div class="vditor-ir">
        <pre class="vditor-reset">
          <table>
            <thead><tr><th>Pair / task</th></tr></thead>
            <tbody><tr><td>odd row</td></tr><tr><td>even row</td></tr></tbody>
          </table>
        </pre>
      </div>
    </div>`;
  return Array.from(document.querySelectorAll("th, td"));
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  document.getElementById("vditorContentTheme")?.remove();
});

describe("table contrast follows the VS Code theme", () => {
  for (const kind of ["dark", "light"] as const) {
    test(`header, odd and even cells are readable in a ${kind} theme`, () => {
      for (const cell of renderTable(kind)) {
        expect(contrast(cell), cell.textContent!).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("stays readable once vditor's dark content theme loads after our styles", () => {
    const style = document.createElement("style");
    style.id = "vditorContentTheme";
    style.textContent = darkContentTheme;
    document.head.appendChild(style);
    for (const cell of renderTable("dark")) {
      expect(contrast(cell), cell.textContent!).toBeGreaterThanOrEqual(4.5);
    }
  });
});
