const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

function ensureSidebarAssets() {
  const distDir = path.join(__dirname, 'out', 'sidebar');
  fs.mkdirSync(distDir, { recursive: true });

  const codiconTtfSource = path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf');
  const codiconTtfTarget = path.join(distDir, 'codicon.ttf');
  if (fs.existsSync(codiconTtfSource)) {
    fs.copyFileSync(codiconTtfSource, codiconTtfTarget);
  }

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

  fs.writeFileSync(path.join(distDir, 'codicon.css'), codiconCssContent);
}

const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] extension bundle started');
    });

    build.onEnd((result) => {
      ensureSidebarAssets();

      for (const error of result.errors) {
        console.error(`✘ [ERROR] ${error.text}`);
        if (error.location) {
          console.error(
            `    ${error.location.file}:${error.location.line}:${error.location.column}:`
          );
        }
      }

      console.log('[watch] extension bundle finished');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node12',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    sourcemap: !production,
    sourcesContent: false,
    minify: production,
    keepNames: true,
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
    return;
  }

  await ctx.rebuild();
  await ctx.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});