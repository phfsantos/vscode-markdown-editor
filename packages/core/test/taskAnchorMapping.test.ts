import { describe, expect, it } from 'vitest';
import { parseTaskItems, resolveTaskAnchor, remapTaskAnchor } from '../src/taskAnchorMapping';
describe('source task anchors', () => {
  it('parses source positions, nested markers, checked tasks and duplicate labels', () => {
    const source = '- [ ] Same\r\n  * [x] Same\r\n+ [ ] 😀\r\n';
    const tasks = parseTaskItems(source);
    expect(tasks.map(t => [t.line, t.checked, t.ordinal])).toEqual([[0,false,0],[1,true,1],[2,false,2]]);
    expect(resolveTaskAnchor(source, 1, {documentVersion:1,line:1,expectedLineText:'  * [x] Same'})?.line).toBe(1);
    expect(resolveTaskAnchor(source, 2, {documentVersion:1,line:1,expectedLineText:'  * [x] Same'})).toBeUndefined();
  });
  it('excludes fences, nested fences, HTML and indented code', () => {
    const source = '```md\n- [ ] code\n```\n- parent\n  ~~~\n  - [ ] code\n  ~~~\n\n    - [ ] code\n\n- [ ] Real';
    expect(parseTaskItems(source).map(t => t.text)).toEqual(['- [ ] Real']);
  });
  it('remaps only through disjoint original-coordinate changes', () => {
    const source = '- [ ] Same\n- [ ] Same\n';
    const anchor = resolveTaskAnchor(source, 1, { documentVersion:1,line:1,expectedLineText:'- [ ] Same' })!;
    const next = 'Intro\n' + source;
    expect(remapTaskAnchor(source,next,2,anchor,[{rangeOffset:0,rangeLength:0,text:'Intro\n'}])?.line).toBe(2);
    expect(remapTaskAnchor(source,source.replace(/Same/g,'Done'),2,anchor,[{rangeOffset:0,rangeLength:source.length,text:source.replace(/Same/g,'Done')}])).toBeUndefined();
    expect(remapTaskAnchor(source,'- [ ] Same\n',2,anchor,[{rangeOffset:11,rangeLength:11,text:''}])).toBeUndefined();
    expect(remapTaskAnchor(source,source.replaceAll('[ ]','[x]'),2,anchor,[{rangeOffset:13,rangeLength:3,text:'[x]'}])).toBeUndefined();
  });
  it('invalidates adjacent structural changes and ambiguous change batches', () => {
    const source = '- [ ] Task\n'; const a = resolveTaskAnchor(source,1,{documentVersion:1,line:0,expectedLineText:'- [ ] Task'})!;
    expect(remapTaskAnchor(source,'```\n'+source,2,a,[{rangeOffset:0,rangeLength:0,text:'```\n'}])).toBeUndefined();
    expect(remapTaskAnchor(source,source,2,a,[{rangeOffset:0,rangeLength:2,text:'- '},{rangeOffset:1,rangeLength:2,text:' ['}])).toBeUndefined();
  });
});
it('does not accept tasks inside a fence opened on a list marker', () => {
  const source = '- ```md\n  - [ ] code\n  ```\n\n- [ ] Real';
  expect(parseTaskItems(source).map(t => t.text)).toEqual(['- [ ] Real']);
});
it('fails closed for unsupported quote/HTML containers rather than shifting task ordinals', () => {
  expect(parseTaskItems('> - [ ] quoted\n- [ ] real')).toEqual([]);
  expect(parseTaskItems('<div>\n\n- [ ] not markdown\n</div>\n\n- [ ] real')).toEqual([]);
});
