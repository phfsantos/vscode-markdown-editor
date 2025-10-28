/**
 * Build script to bundle sidebar files for webview
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'sidebar-dist');

// Create dist directory
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy compiled JS
const jsSource = path.join(__dirname, '..', 'sidebar-dist', 'sidebar.js');
const jsTarget = path.join(distDir, 'sidebar.js');
if (fs.existsSync(jsSource)) {
  fs.copyFileSync(jsSource, jsTarget);
  console.log('✅ Copied sidebar.js');
}

// Copy CSS
const cssSource = path.join(__dirname, 'sidebar.css');
const cssTarget = path.join(distDir, 'sidebar.css');
if (fs.existsSync(cssSource)) {
  fs.copyFileSync(cssSource, cssTarget);
  console.log('✅ Copied sidebar.css');
}

// Copy codicon font
const codiconTtfSource = path.join(__dirname, '..', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf');
const codiconTtfTarget = path.join(distDir, 'codicon.ttf');
if (fs.existsSync(codiconTtfSource)) {
  fs.copyFileSync(codiconTtfSource, codiconTtfTarget);
  console.log('✅ Copied codicon.ttf');
}

// Create codicon.css with local font reference
const codiconCssContent = `@font-face {
  font-family: "codicon";
  font-display: block;
  src: url("./codicon.ttf") format("truetype");
}

.codicon[class*='codicon-'] {
  font: normal normal normal 16px/1 codicon;
  display: inline-block;
  text-decoration: none;
  text-rendering: auto;
  text-align: center;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
}

/* Icon definitions */
.codicon-chevron-down:before { content: "\\eab4" }
.codicon-chevron-right:before { content: "\\eab6" }
.codicon-file-add:before { content: "\\ea7f" }
.codicon-tag:before { content: "\\ea66" }
.codicon-file-media:before { content: "\\eaea" }
.codicon-link-external:before { content: "\\eb14" }
.codicon-link:before { content: "\\eb15" }
.codicon-references:before { content: "\\eb36" }
.codicon-file-symlink-directory:before { content: "\\eaed" }
.codicon-graph:before { content: "\\eb03" }
.codicon-calendar:before { content: "\\eab0" }
.codicon-organization:before { content: "\\ea7e" }
.codicon-note:before { content: "\\eb26" }
.codicon-tasklist:before { content: "\\eb67" }
.codicon-refresh:before { content: "\\eb37" }
.codicon-warning:before { content: "\\ea6c" }
.codicon-close:before { content: "\\ea76" }
.codicon-file:before { content: "\\ea7b" }
.codicon-symbol-namespace:before { content: "\\ea8b" }
.codicon-check:before { content: "\\eab2" }
.codicon-info:before { content: "\\ea74" }
.codicon-screen-full:before { content: "\\eb3c" }
`;

const codiconCssTarget = path.join(distDir, 'codicon.css');
fs.writeFileSync(codiconCssTarget, codiconCssContent);
console.log('✅ Created codicon.css');

console.log('✅ Sidebar build complete');
