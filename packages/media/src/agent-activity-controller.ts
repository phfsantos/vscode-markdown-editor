import { findChangedTasks, parseHostToWebviewMessage, parseTaskItems, type HostToWebviewMessage } from '@markdown-editor/core';

type Snapshot = Extract<HostToWebviewMessage, { command: 'agent-activity' }>;
type PendingEdits = Extract<HostToWebviewMessage, { command: 'pending-edits' }>;
interface Source { panelId: string; documentVersion: number; content: string }
const uiSelector = '.md-agent-activity-header, .md-agent-activity-status';
type TaskState = 'working' | 'waiting' | 'review';
/**
 * The indicator is drawn by the task checkbox's own ::before (a checkbox outline) and ::after (the state glyph),
 * through rules in a constructed stylesheet. It is laid out inside the checkbox, so it scrolls and reflows with the
 * page natively, and nothing is added to or changed in Vditor's DOM. Colours, the spin animation and the
 * reduced-motion and forced-colours variants are custom properties defined in agent-activity.css.
 */
const pseudo = 'content:"";position:absolute;box-sizing:border-box;pointer-events:none;';
const color = 'var(--md-agent-task-color)';
const glyph = (state: TaskState, checked: boolean): string => {
  // An indeterminate progress ring: a faint track with a quarter arc that spins.
  if (state === 'working') return `inset:1px;border:2px solid color-mix(in srgb,${color} 30%,transparent);border-top-color:${color};border-radius:50%;animation:var(--md-agent-task-spin);`;
  // Pause bars: the agent is waiting on the user.
  if (state === 'waiting') return `inset:0;background-image:linear-gradient(to right,transparent 26%,${color} 26% 43%,transparent 43% 57%,${color} 57% 74%,transparent 74%);background-size:100% 60%;background-position:center;background-repeat:no-repeat;`;
  // A dot: this checkbox has a change to review. On a ticked box it sits in the corner so the tick stays readable.
  return checked ? `width:7px;height:7px;top:-5px;right:-5px;border-radius:50%;background-color:${color};box-shadow:0 0 0 1.5px var(--md-agent-task-surface);`
    : `inset:30%;border-radius:50%;background-color:${color};`;
};
const taskRules = (selector: string, state: TaskState, checked: boolean, line: number): string =>
  `${selector}{position:relative;--md-agent-task-state:${state};--md-agent-task-line:${line};--md-agent-task-color:var(--md-agent-task-${state}-color);}`
  // The outline hides an unticked checkbox behind an opaque fill; a ticked one stays visible through it.
  + `${selector}::before{${pseudo}inset:-2px;border:1.5px solid ${color};border-radius:4px;background-color:${checked ? 'transparent' : 'var(--md-agent-task-surface)'};}`
  + `${selector}::after{${pseudo}${glyph(state, checked)}}`;
/** A selector that matches exactly `element`, as a child path from its editor root; undefined when it cannot. */
function pathSelector(scope: Document, root: Element, element: Element): string | undefined {
  const steps: string[] = [];
  for (let node = element; node !== root; node = node.parentElement) {
    if (!node.parentElement) return undefined;
    steps.unshift(`:nth-child(${Array.prototype.indexOf.call(node.parentElement.children, node) + 1})`);
  }
  const selector = `${root.closest('.vditor-ir') ? '.vditor-ir' : '.vditor-wysiwyg'} .vditor-reset > ${steps.join(' > ')}`;
  const matches = scope.querySelectorAll(selector);
  return matches.length === 1 && matches[0] === element ? selector : undefined;
}
const canonical = (text: string) => text.replace(/\r\n|\r/g, '\n').replace(/\n$/, '');

/** Pure projection: no mutations inside Vditor and no selection/focus operations; the indicators are stylesheet rules. */
export class AgentActivityController {
  private readonly scope: Document;
  private readonly sheet: CSSStyleSheet;
  private rules = '';
  private readonly header: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly observer: MutationObserver;
  private readonly resize: ResizeObserver;
  private source?: Source;
  private snapshot?: Snapshot;
  /** Host pending (not yet kept) edits, projected as 'review' markers on the checkboxes they change. */
  private pendingEdits?: PendingEdits;
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
    this.sheet = new this.scope.defaultView!.CSSStyleSheet(); this.scope.adoptedStyleSheets = [...this.scope.adoptedStyleSheets, this.sheet];
    this.header = create('md-agent-activity-header'); this.header.setAttribute('aria-hidden', 'true');
    this.status = create('md-agent-activity-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest(uiSelector)))) this.schedule();
    });
    this.observer.observe(this.scope.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['checked','class','style','contenteditable'] });
    this.resize = new ResizeObserver(this.schedule); this.resize.observe(this.scope.body);
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
    if (result.kind !== 'message' || this.disposed) return;
    if (result.message.command === 'pending-edits') { this.receivePendingEdits(result.message); return; }
    if (result.message.command !== 'agent-activity') return;
    const next = result.message; const source = this.source;
    if (!source || next.panelId !== source.panelId || next.documentVersion !== source.documentVersion || next.generation !== this.generation
      || next.content !== source.content || (this.snapshot?.panelId === next.panelId && next.sequence < this.snapshot.sequence)) return;
    this.snapshot = next; this.schedule();
  }
  private receivePendingEdits(next: PendingEdits): void {
    const source = this.source;
    // Full state, latest wins; like activity, it must describe the exact text the panel holds.
    if (!source || next.panelId !== source.panelId || next.documentVersion !== source.documentVersion
      || next.generation !== this.generation || next.content !== source.content) return;
    this.pendingEdits = next; this.schedule();
  }
  private isCurrent(message: { panelId: string; documentVersion: number; generation: number } | undefined): boolean {
    const source = this.source;
    return !!message && !!source && message.panelId === source.panelId && message.documentVersion === source.documentVersion && message.generation === this.generation;
  }
  private render(): void {
    const rules = this.project();
    if (rules !== this.rules) { this.rules = rules; this.sheet.replaceSync(rules); }
  }
  /** Updates the header and status text and returns the indicator rules; none whenever the editor and the text disagree. */
  private project(): string {
    const activity = this.isCurrent(this.snapshot) ? this.snapshot : undefined;
    const pendingEdits = this.isCurrent(this.pendingEdits) && this.pendingEdits!.edits.length > 0 ? this.pendingEdits : undefined;
    const summary = activity ? activity.summary : '';
    if (this.header.textContent !== summary) this.header.textContent = summary;
    this.header.hidden = !summary;
    const announce = (text: string) => { if (this.status.textContent !== text) this.status.textContent = text; };
    // Both messages were accepted only for the panel's exact text, so they agree when both are current.
    const content = activity?.content ?? pendingEdits?.content;
    if (content === undefined || this.pendingEdit || canonical(this.dependencies.renderSource?.(content) ?? content) !== canonical(this.dependencies.getMarkdown())) { announce(summary); return ''; }
    const roots = Array.from(this.scope.querySelectorAll<HTMLElement>('.vditor-ir .vditor-reset, .vditor-wysiwyg .vditor-reset')).filter(root => root.getBoundingClientRect().width > 0 && getComputedStyle(root).display !== 'none');
    if (roots.length !== 1) { announce(summary); return ''; }
    const root = roots[0];
    const checkboxes = Array.from(root.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]')).filter(input => !input.closest('.renderer-container, .widget-container, .vditor-ir__preview'));
    const tasks = parseTaskItems(content);
    // Full-document serialization and ordered cardinality must agree. No text-label search.
    if (tasks.length !== checkboxes.length || tasks.some((task,index) => task.checked !== checkboxes[index].checked)) { announce(summary); return ''; }
    const reviews: Snapshot['tasks'] = (pendingEdits?.edits ?? []).flatMap(edit => findChangedTasks(content, edit.compareContent)
      .map(task => ({ line: task.line, expectedLineText: task.text, state: 'review' as const, producerLabel: edit.sourceLabel })));
    const groups = new Map<number, Snapshot['tasks']>();
    for (const projection of [...(activity?.tasks ?? []), ...reviews]) {
      const task = tasks.find(task => task.line === projection.line && task.text === projection.expectedLineText);
      if (!task) continue;
      const group = groups.get(task.ordinal) ?? []; group.push(projection); groups.set(task.ordinal,group);
    }
    const descriptions: string[] = []; let rules = '';
    for (const [ordinal, group] of groups) {
      const selector = pathSelector(this.scope, root, checkboxes[ordinal]);
      if (!selector) continue;
      const state = (['working','waiting','review'] as const).find(state => group.some(p => p.state === state))!;
      rules += taskRules(selector, state, checkboxes[ordinal].checked, tasks[ordinal].line);
      descriptions.push(...group.map(p => `${p.producerLabel} ${p.state} on task ${p.line + 1}`));
    }
    announce([summary,...descriptions].filter(Boolean).join('. '));
    return rules;
  }
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.observer.disconnect(); this.resize.disconnect();
    if (this.frame !== undefined) this.scope.defaultView!.cancelAnimationFrame(this.frame);
    this.scope.removeEventListener('input',this.input,true); this.scope.removeEventListener('change',this.schedule,true);
    this.scope.defaultView!.removeEventListener('resize',this.schedule);
    this.scope.adoptedStyleSheets = this.scope.adoptedStyleSheets.filter(sheet => sheet !== this.sheet); this.header.remove(); this.status.remove();
  }
}
