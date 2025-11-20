import { task, desc, option, fs, setGlobalOptions, exec, spawn } from 'foy'
setGlobalOptions({ loading: false, strict: true })
task('watch', async (ctx) => {
  // Your build tasks
  await Promise.all([
    ctx.exec('tsc -w -p ./'),
    ctx.cd('./packages/media').exec('yarn start'),
    spawn('yarn', ['watch'], { cwd: './packages/sidebar', stdio: 'inherit' }),
  ])
})

task('build', async (ctx) => {
  // Check for TypeScript errors in our source code (skip node_modules)
  try {
    await ctx.exec('tsc --noEmit -p ./ --skipLibCheck')
    await spawn('yarn', ['tsc', '--noEmit', '--skipLibCheck'], { cwd: './packages/sidebar', stdio: 'inherit' })
  } catch (error) {
    console.error('TypeScript errors found. Fix them before building.')
    throw error
  }
  
  // Build if no errors in our code
  await ctx.exec('tsc -p ./')
  await ctx.cd('./packages/media').exec('yarn build')
  await spawn('yarn', ['build'], { cwd: './packages/sidebar', stdio: 'inherit' })
  await ctx.exec('git add -A')
})
