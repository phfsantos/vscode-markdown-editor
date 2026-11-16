import Vditor from "vditor";
import "vditor/dist/index.css";
import "vditor/dist/js/i18n/en_US.js";
import "vditor/dist/js/lute/lute.min.js";
import { buildRenderedLineMap } from "../../packages/media/src/diff-line-dom-mapper";

/** Boot a real IR-mode Vditor (pinned local assets, no CDN) inside a sized host. */
export async function mountRealVditor(markdown: string, size = { width: 900, height: 600 }): Promise<{
  editor: Vditor;
  host: HTMLDivElement;
  content: HTMLElement;
  dispose(): void;
}> {
  for (const id of ["vditorLuteScript", "vditorIconScript"]) {
    if (!document.getElementById(id)) {
      const script = document.createElement("script");
      script.id = id;
      document.head.appendChild(script);
    }
  }
  const host = document.createElement("div");
  host.style.cssText = `width:${size.width}px;height:${size.height}px;position:relative`;
  document.body.appendChild(host);
  const editor = await new Promise<Vditor>((resolve) => {
    const instance: Vditor = new Vditor(host, {
      after: () => resolve(instance),
      cache: { enable: false },
      icon: "",
      i18n: (window as any).VditorI18n,
      mode: "ir",
      toolbar: [],
      undoDelay: 0,
      height: size.height,
      value: markdown,
      preview: { hljs: { enable: false }, math: { engine: "KaTeX" } as any },
    });
  });
  const content = host.querySelector<HTMLElement>(".vditor-ir pre.vditor-reset")!;
  return {
    editor,
    host,
    content,
    dispose() {
      try { editor.destroy(); } catch { /* already gone */ }
      host.remove();
    },
  };
}

/** Rendered (diff) line index of the first line element whose text includes `text`. */
export function renderedLineOf(content: HTMLElement, text: string): number {
  for (const [line, element] of buildRenderedLineMap(content as any)) {
    if ((element as unknown as HTMLElement).textContent?.includes(text)) return line;
  }
  throw new Error(`No rendered line contains "${text}"`);
}

export function renderedLineElement(content: HTMLElement, line: number): HTMLElement {
  const element = buildRenderedLineMap(content as any).get(line);
  if (!element) throw new Error(`No rendered line ${line}`);
  return element as unknown as HTMLElement;
}
