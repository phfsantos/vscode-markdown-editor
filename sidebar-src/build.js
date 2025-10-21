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

console.log('✅ Sidebar build complete');
