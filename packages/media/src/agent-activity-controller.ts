import { parseHostToWebviewMessage, parseTaskItems, type HostToWebviewMessage } from '@markdown-editor/core';

type Snapshot = Extract<HostToWebviewMessage, { command: 'agent-activity' }>;
interface Source { panelId: string; documentVersion: number; content: string }
const uiSelector = '.md-agent-activity-layer, .md-agent-activity-header, .md-agent-activity-status';
const canonical = (text: string) => text.replace(/\r\n|\r/g, '\n').replace(/\n$/, '');

/** Pure projection: no mutations inside Vditor and no selection/focus operations. */
export class AgentActivityController {
  private readonly scope: Document;
  private readonly layer: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly observer: MutationObserver;
  private readonly resize: ResizeObserver;
  private source?: Source;
  private snapshot?: Snapshot;
  private generation = -1;
  private frame?: number;
  private pendingEdit = false;
  private disposed = false;
  private readonly schedule = () => {
    if (this.disposed || this.frame !== undefined) return;
    this.frame = this.scope.defaultView!.requestAnimationFrame(() => { this.frame = undefined; this.render(); });
  };
  private readonly input = (event: Event) => {
    if ((event.target as Element)?.closest?.('.vditor-reset')) { this.pendingEdit = true; this.schedule(); }
  };
  public constructor(private readonly dependencies: { scope?: Document; getMarkdown(): string; renderSource?(source: string): string }) {
    this.scope = dependencies.scope ?? document;
    const create = (className: string) => { const el = this.scope.createElement('div'); el.className = className; el.dataset.agentActivity = 'true'; this.scope.body.append(el); return el; };
    this.layer = create('md-agent-activity-layer'); this.layer.setAttribute('aria-hidden', 'true');
    this.header = create('md-agent-activity-header'); this.header.setAttribute('aria-hidden', 'true');
    this.status = create('md-agent-activity-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest(uiSelector)))) this.schedule();
    });
    this.observer.observe(this.scope.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['checked','class','style','contenteditable'] });
    this.resize = new ResizeObserver(this.schedule); this.resize.observe(this.scope.body);
    this.scope.addEventListener('scroll', this.schedule, true);
    this.scope.addEventListener('input', this.input, true);
    this.scope.addEventListener('change', this.schedule, true);
    this.scope.defaultView!.addEventListener('resize', this.schedule);
  }
  public setSource(source: Source): void {
    if (this.source?.panelId === source.panelId && this.source.documentVersion > source.documentVersion) return;
    this.source = { ...source }; this.pendingEdit = false; this.schedule();
  }
  public setGeneration(generation: number | undefined): void {
    if (generation !== undefined && generation >= this.generation) { this.generation = generation; this.schedule(); }
  }
  public receive(value: unknown): void {
    const result = parseHostToWebviewMessage(value);
    if (result.kind !== 'message' || result.message.command !== 'agent-activity' || this.disposed) return;
    const next = result.message; const source = this.source;
    if (!source || next.panelId !== source.panelId || next.documentVersion !== source.documentVersion || next.generation !== this.generation
      || next.content !== source.content || (this.snapshot?.panelId === next.panelId && next.sequence < this.snapshot.sequence)) return;
    this.snapshot = next; this.schedule();
  }
  private render(): void {
    const snapshot = this.snapshot; const source = this.source;
    this.layer.replaceChildren();
    const current = snapshot && source && snapshot.panelId === source.panelId && snapshot.documentVersion === source.documentVersion && snapshot.generation === this.generation;
    const summary = current ? snapshot.summary : '';
    if (this.header.textContent !== summary) this.header.textContent = summary;
    this.header.hidden = !summary;
    const announce = (text: string) => { if (this.status.textContent !== text) this.status.textContent = text; };
    if (!current || this.pendingEdit || canonical(this.dependencies.renderSource?.(snapshot.content) ?? snapshot.content) !== canonical(this.dependencies.getMarkdown())) { announce(summary); return; }
    const roots = Array.from(this.scope.querySelectorAll<HTMLElement>('.vditor-ir .vditor-reset, .vditor-wysiwyg .vditor-reset')).filter(root => root.getBoundingClientRect().width > 0 && getComputedStyle(root).display !== 'none');
    if (roots.length !== 1) { announce(summary); return; }
    const root = roots[0];
    const checkboxes = Array.from(root.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]')).filter(input => !input.closest('.renderer-container, .widget-container, .vditor-ir__preview'));
    const tasks = parseTaskItems(snapshot.content);
    // Full-document serialization and ordered cardinality must agree. No text-label search.
    if (tasks.length !== checkboxes.length || tasks.some((task,index) => task.checked !== checkboxes[index].checked)) { announce(summary); return; }
    const groups = new Map<number, Snapshot['tasks']>();
    for (const projection of snapshot.tasks) {
      const task = tasks.find(task => task.line === projection.line && task.text === projection.expectedLineText);
      if (!task) continue;
      const group = groups.get(task.ordinal) ?? []; group.push(projection); groups.set(task.ordinal,group);
    }
    const descriptions: string[] = [];
    for (const [ordinal, group] of groups) {
      const checkbox = checkboxes[ordinal]; const rect = checkbox.getBoundingClientRect(); const bounds = root.getBoundingClientRect();
      if (!rect.width || rect.bottom < Math.max(0,bounds.top) || rect.top > Math.min(this.scope.defaultView!.innerHeight,bounds.bottom)) continue;
      const state = (['working','waiting','review'] as const).find(state => group.some(p => p.state === state))!;
      const marker = this.scope.createElement('span'); marker.className = 'md-agent-task-indicator'; marker.dataset.agentActivity = 'true';
      marker.dataset.state = state; marker.dataset.taskLine = String(tasks[ordinal].line);
      marker.style.left = `${rect.left - 2}px`; marker.style.top = `${rect.top - 2}px`; marker.style.width = `${rect.width + 4}px`; marker.style.height = `${rect.height + 4}px`;
      this.layer.append(marker);
      descriptions.push(...group.map(p => `${p.producerLabel} ${p.state} on task ${p.line + 1}`));
    }
    announce([summary,...descriptions].filter(Boolean).join('. '));
  }
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.observer.disconnect(); this.resize.disconnect();
    if (this.frame !== undefined) this.scope.defaultView!.cancelAnimationFrame(this.frame);
    this.scope.removeEventListener('scroll',this.schedule,true); this.scope.removeEventListener('input',this.input,true); this.scope.removeEventListener('change',this.schedule,true);
    this.scope.defaultView!.removeEventListener('resize',this.schedule);
    this.layer.remove(); this.header.remove(); this.status.remove();
  }
}
