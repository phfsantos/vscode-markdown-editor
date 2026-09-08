// Both the backend and browser suites must produce these same logical lines.
// Loose root text is normalized to paragraph HTML by the backend before rendering.
export const renderedLineFixtures = [
  {
    name: 'inline text and transparent wrappers',
    html: '<div data-block=""><p><span>Alpha <strong>beta</strong></span></p><div data-block=""><h2>Heading</h2></div></div>',
    lines: [['p', 'Alpha beta'], ['h2', 'Heading']],
  },
  {
    name: 'nested lists with owning and transparent items',
    html: '<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li><li><p>Paragraph item</p></li></ul>',
    lines: [['li', 'One'], ['li', 'TwoNested'], ['p', 'Paragraph item']],
  },
  {
    name: 'table cells and caption',
    html: '<table><caption>Caption</caption><thead><tr><th>Title</th></tr></thead><tbody><tr><td><span>Cell</span></td></tr><tr><td><p>Nested cell</p></td></tr></tbody></table>',
    lines: [['caption', 'Caption'], ['th', 'Title'], ['td', 'Cell'], ['p', 'Nested cell']],
  },
  {
    name: 'blockquote nesting',
    html: '<blockquote>Discarded parent text<p>Quote</p><blockquote><p>Deep quote</p></blockquote></blockquote><p>Tail</p>',
    lines: [['p', 'Quote'], ['p', 'Deep quote'], ['p', 'Tail']],
  },
  {
    name: 'explicit blanks and whitespace',
    html: '<p> A\n  B </p><p data-empty-line="true">&#8203;</p><p>\u200b</p><p><br></p><p>Tail</p>',
    lines: [['p', 'A B'], ['p', ''], ['p', 'Tail']],
  },
  {
    name: 'mixed data blocks and code containers',
    html: '<div data-block="">Lead <p>Child</p></div><div data-type="code-block" data-block=""><pre><code>one\ntwo</code></pre></div>',
    lines: [['div', 'Lead Child'], ['div', 'one two']],
  },
  {
    name: 'standalone media and rules',
    html: '<p>Before</p><img alt="image"><hr><svg><path></path></svg><p>After</p>',
    lines: [['p', 'Before'], ['img', ''], ['hr', ''], ['svg', ''], ['p', 'After']],
  },
  {
    name: 'definition lists and disclosure',
    html: '<dl><dt>Term</dt><dd>Definition</dd></dl><details><summary>Summary</summary><p>Details</p></details>',
    lines: [['dt', 'Term'], ['dd', 'Definition'], ['summary', 'Summary'], ['p', 'Details']],
  },
  {
    name: 'comments and empty structure',
    html: '<!-- ignored --><div data-block="">\n<!-- comment --><p>Visible</p></div><ul></ul><table><tbody><tr></tr></tbody></table>',
    lines: [['p', 'Visible']],
  },
];
