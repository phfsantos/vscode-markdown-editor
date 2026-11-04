const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const tools = createRequire(path.join(process.env.MARKDOWN_UI_TOOLS ?? __dirname,'package.json'));
const {describe,it,afterEach} = tools('mocha');
const {By,Key,VSBrowser,WebView} = tools('vscode-extension-tester');
const workspace = process.env.MARKDOWN_UI_WORKSPACE;
const report=()=>JSON.parse(fs.readFileSync(path.join(workspace,'activity.json'),'utf8'));
const driver=()=>VSBrowser.instance.driver;
async function eventually(check,timeout=20000) {
  let last;
  try {await driver().wait(async()=>{try{await check();return true;}catch(error){last=error;return false;}},timeout,undefined,150);}
  catch{throw last;}
}
async function command(title,operation) {
  await eventually(async()=>{
    await driver().switchTo().defaultContent();
    await driver().findElement(By.css('.monaco-workbench .part.sidebar')).click();
    await driver().actions().sendKeys(Key.ESCAPE,Key.F1).perform();
    const input=await driver().wait(async()=>{
      for(const input of await driver().findElements(By.css('.quick-input-widget .quick-input-box input')))if(await input.isDisplayed())return input;
      return false;
    },2000);
    await input.click();await input.sendKeys(Key.chord(Key.META,'a'),'>'+title);
    await driver().wait(async()=>{
      for(const row of await driver().findElements(By.css('.quick-input-list .monaco-list-row')))if((await row.getText()).includes(title))return true;
      return false;
    },2000);
    await input.sendKeys(Key.ENTER);
  });
  if(operation) await eventually(()=>{assert.equal(report().operation,operation);assert.equal(report().error,undefined);});
}
async function inEditor(action){const view=new WebView();try{await view.switchToFrame(15000);return await action(view);}finally{await view.switchBack();}}
async function editorState(){return inEditor(()=>driver().executeScript(`
  const root=document.querySelector('.vditor-ir .vditor-reset');
  const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height};};
  return {markers:[...document.querySelectorAll('.md-agent-task-indicator')].map(e=>({line:Number(e.dataset.taskLine),state:e.dataset.state,rect:rect(e)})),
    boxes:[...root.querySelectorAll('input[type=checkbox]')].map(rect),
    header:document.querySelector('.md-agent-activity-header')?.textContent,
    status:document.querySelector('.md-agent-activity-status')?.textContent,
    inside:!!root.querySelector('.md-agent-task-indicator'),text:root.textContent};
`));}
async function statusVisible(){
  const items=await driver().findElements(By.css('.statusbar-item'));
  for(const item of items)if((await item.getText()).includes('Agent working')&&await item.isDisplayed())return true;
  return false;
}
async function badgePresent(){return driver().executeScript(`return [...document.querySelectorAll('.tabs-container .tab *')].some(e=>['::after','::before'].some(p=>getComputedStyle(e,p).content.replaceAll('"','').trim()==='A'));`);}
const original='- [ ] Same\n- [ ] Same\n';
describe('Markdown Studio activity API in real VS Code',function(){
  this.timeout(155000);
  afterEach(async function(){if(this.currentTest.state==='failed')await VSBrowser.instance.takeScreenshot(this.currentTest.title);});
  it('independent exports producer decorates only the second duplicate checkbox without changing source',async()=>{
    await command('Activity UI: Open Tasks','open');
    await eventually(async()=>assert.equal((await editorState()).boxes.length,2));
    const before=report().document;
    await command('Activity UI: Report Exports','exports');
    await eventually(async()=>{
      const state=await editorState();
      assert.equal(state.markers.length,Number(process.env.MARKDOWN_ACTIVITY_EXPECT_MARKERS??1));
      assert.equal(state.markers[0].line,1);assert.equal(state.markers[0].state,'working');
      assert.ok(Math.abs((state.markers[0].rect.top+state.markers[0].rect.height/2)-(state.boxes[1].top+state.boxes[1].height/2))<6);
      assert.equal(state.inside,false);assert.match(state.status,/Export Agent/);
    });
    await command('Activity UI: Snapshot','snapshot');
    assert.deepEqual(report().document,before);assert.equal(report().document.dirty,false);
    assert.equal(fs.readFileSync(path.join(workspace,'tasks.md'),'utf8'),original);
    assert.deepEqual(report().nativeEditors,[]);
    assert.ok(report().tabs.some(t=>t.custom&&t.active&&t.viewType==='markdown-editor'&&t.uri===report().context.uri));
    await eventually(async()=>{assert.equal(await statusVisible(),true);assert.equal(await badgePresent(),true);});
    await VSBrowser.instance.takeScreenshot('activity-exports-second-checkbox');
  });
  it('JSON commands and a second producer share one task indicator and clear immediately',async()=>{
    await command('Activity UI: Clear Producers','clear');
    await eventually(async()=>assert.equal((await editorState()).markers.length,0));
    await command('Activity UI: Report Commands','commands');
    await command('Activity UI: Report Second Producer','two');
    await eventually(async()=>{const s=await editorState();assert.equal(s.markers.length,1);assert.match(s.status,/Command Agent/);assert.match(s.status,/Second Agent/);});
    await command('Activity UI: Clear Producers','clear');
    await eventually(async()=>{assert.equal((await editorState()).markers.length,0);assert.equal(await statusVisible(),false);assert.equal(await badgePresent(),false);});
  });
  it('honors disabled badge settings while retaining checkbox and header/status fallbacks',async()=>{
    await command('Activity UI: Report Exports','exports');
    await command('Activity UI: Disable Badges','badgesOff');
    assert.equal(report().badges,false);
    const settings=JSON.parse(fs.readFileSync(path.join(process.env.TEST_RESOURCES,'settings/User/settings.json'),'utf8'));
    assert.equal(settings['workbench.editor.decorations.badges'],false);
    await eventually(async()=>{assert.equal(await badgePresent(),false);assert.equal(await statusVisible(),true);const s=await editorState();assert.equal(s.markers.length,1);assert.match(s.header,/working/);});
    await VSBrowser.instance.takeScreenshot('activity-badges-disabled-fallback');
    await command('Activity UI: Enable Badges','badgesOn');
    await eventually(async()=>assert.equal(await badgePresent(),true));
  });
  it('keeps resource identity across split tabs and closed/reopened renderer subscriptions',async()=>{
    await command('Activity UI: Split Tasks','split');
    await eventually(()=>assert.equal(report().tabs.filter(t=>t.custom&&t.uri===report().context.uri).length,2));
    await eventually(async()=>assert.equal((await editorState()).markers.length,1));
    await command('Activity UI: Close Reopen Tasks','closeReopen');
    await eventually(async()=>{assert.equal((await editorState()).markers.length,1);assert.equal(await statusVisible(),true);});
    await VSBrowser.instance.takeScreenshot('activity-split-reopened');
    await command('Activity UI: Clear Producers','clear');
  });
  it('remaps insertion above the target and invalidates an edited checkbox while keeping file activity',async()=>{
    await command('Activity UI: Report Exports','exports');
    await command('Activity UI: Edit Above Tasks','editAbove');
    await eventually(async()=>{const s=await editorState();assert.equal(s.markers.length,1);assert.equal(s.markers[0].line,2);});
    await command('Activity UI: Edit Target Task','editTask');
    await eventually(async()=>{assert.equal((await editorState()).markers.length,0);assert.equal(await statusVisible(),true);});
    await command('Activity UI: Clear Producers','clear');
  });
  it('reload clears producer activity instead of persisting working state',async()=>{
    await command('Activity UI: Report Exports','exports');
    await eventually(async()=>assert.equal(await statusVisible(),true));
    const previous=report().context.panelId;
    await command('Developer: Reload Window');await VSBrowser.instance.waitForWorkbench();
    await eventually(()=>assert.notEqual(report().context?.panelId,previous));
    await command('Activity UI: Snapshot','snapshot');
    await eventually(async()=>{assert.equal(await statusVisible(),false);assert.equal((await editorState()).markers.length,0);});
  });
  it('expires a producer after heartbeats stop within the 120-second lease tolerance',async()=>{
    await command('Activity UI: Report Exports','exports');
    await command('Activity UI: Stop Heartbeat','stop');
    const start=Date.now();
    await eventually(async()=>assert.equal(await statusVisible(),true));
    await eventually(async()=>assert.equal(await statusVisible(),false),125000);
    assert.ok(Date.now()-start<125000);
    await eventually(async()=>assert.equal((await editorState()).markers.length,0));
    await command('Activity UI: Clear Producers','clear');
  });
});
