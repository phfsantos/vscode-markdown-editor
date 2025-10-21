import { task, desc, option, fs, setGlobalOptions, exec, spawn } from 'foy'
setGlobalOptions({ loading: false, strict: true })
task('watch', async (ctx) => {
  // Your build tasks
  await Promise.all([
    ctx.exec('tsc -w -p ./'),
    ctx.cd('./media-src').exec('yarn start'),
    spawn('yarn', ['watch'], { cwd: './sidebar-src', stdio: 'inherit' }),
  ])
})

task('build', async (ctx) => {
  await ctx.exec('tsc -p ./')
  await ctx.cd('./media-src').exec('yarn build')
  await spawn('yarn', ['build'], { cwd: './sidebar-src', stdio: 'inherit' })
  await ctx.exec('git add -A')
})
