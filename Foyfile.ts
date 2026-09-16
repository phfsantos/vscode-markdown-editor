import { task, desc, option, fs, setGlobalOptions, exec, spawn } from 'foy'
import assert from 'assert'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
setGlobalOptions({ loading: false, strict: true })

function assertBuildArtifacts() {
  const requiredArtifacts = [
    'dist/extension.js',
    'out/media/main.js',
    'out/media/main.css',
    'out/media/dist/js/i18n/en_US.js',
    'out/media/dist/js/icons/ant.js',
    'out/media/dist/js/icons/material.js',
    'out/media/dist/css/content-theme/light.css',
    'out/widgets/index.js',
  ];

  for (const relativePath of requiredArtifacts) {
    assert.ok(
      existsSync(join(process.cwd(), relativePath)),
      `Expected build artifact ${relativePath}`,
    );
  }

  const webviewHtml = readFileSync(join(process.cwd(), 'src/app/webviewHtml.ts'), 'utf8');
  const widgetScript = webviewHtml.indexOf('<script src="${widgetBundleUri}"></script>');
  const mediaScript = webviewHtml.indexOf('${JsFiles.map((f) => `<script src="${f}"></script>`).join("\\n")}');
  assert.ok(widgetScript >= 0, 'Expected the webview HTML to load the widget bundle');
  assert.ok(mediaScript >= 0, 'Expected the webview HTML to load the media bundle');
  assert.ok(widgetScript < mediaScript, 'The widget bundle must load before the media bundle');
}
task('watch', async (ctx) => {
  // Your build tasks
  await Promise.all([
    ctx.exec('yarn watch:types'),
    ctx.exec('yarn watch:extension'),
    ctx.cd('./packages/media').exec('yarn start'),
    spawn('npm', ['run', 'dev'], { cwd: './packages/widgets', stdio: 'inherit' }),
  ])
})

task('build', async (ctx) => {
  // Check for TypeScript errors in our source code (skip node_modules)
  try {
    await ctx.exec('yarn check-types')
  } catch (error) {
    console.error('TypeScript errors found. Fix them before building.')
    throw error
  }
  
  // Build if no errors in our code
  await ctx.exec('yarn build:core')
  await ctx.exec('yarn build:extension')
  await ctx.cd('./packages/media').exec('yarn build')
  await spawn('npm', ['run', 'build'], { cwd: './packages/widgets', stdio: 'inherit' })
  assertBuildArtifacts()
})
