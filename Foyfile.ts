import { task, desc, option, fs, setGlobalOptions, exec, spawn } from 'foy'
setGlobalOptions({ loading: false, strict: true })
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
    await spawn('npm', ['run', 'type-check'], { cwd: './packages/widgets', stdio: 'inherit' })
  } catch (error) {
    console.error('TypeScript errors found. Fix them before building.')
    throw error
  }
  
  // Build if no errors in our code
  await ctx.exec('yarn build:extension')
  await ctx.cd('./packages/media').exec('yarn build')
  await spawn('npm', ['run', 'build'], { cwd: './packages/widgets', stdio: 'inherit' })
  await ctx.exec('git add -A')
})
