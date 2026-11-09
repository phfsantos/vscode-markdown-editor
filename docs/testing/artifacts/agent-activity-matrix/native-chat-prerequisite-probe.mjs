import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/Users/pedrosantos/www/vscode-markdown-editor';
if (!process.argv.includes('--clean')) {
 const dir=fs.mkdtempSync('/private/tmp/native-chat-prerequisite-');
 for(const n of ['home','workspace','extensions','probe','chromedriver-mac-x64'])fs.mkdirSync(path.join(dir,n));
 fs.copyFileSync(root+'/.extest/activity/chromedriver-mac-x64/chromedriver',dir+'/chromedriver-mac-x64/chromedriver');
 fs.writeFileSync(dir+'/workspace/tasks.md','- [ ] Same\n- [ ] Same\n');
 fs.writeFileSync(dir+'/probe/package.json',JSON.stringify({name:'native-chat-prerequisite',publisher:'markdown-studio-tests',version:'0.0.1',engines:{vscode:'^1.95.0'},main:'extension.js',activationEvents:['onStartupFinished']}));
 fs.writeFileSync(dir+'/probe/extension.js',`const vscode=require('vscode'),fs=require('fs');exports.activate=async()=>{const report={version:vscode.version,extensions:vscode.extensions.all.filter(e=>/copilot|chat|authentication/.test(e.id)).map(e=>({id:e.id,version:e.packageJSON.version,isActive:e.isActive})),commands:(await vscode.commands.getCommands(true)).filter(x=>/chat.*open$|chat.*session|chat.*edit/i.test(x))};try{await vscode.commands.executeCommand('workbench.action.chat.open');report.openChat='completed'}catch(e){report.openChat=String(e)}fs.writeFileSync(process.env.CHAT_PROBE_DIR+'/api-report.json',JSON.stringify(report,null,2));};`);
 const env=Object.fromEntries(Object.entries(process.env).filter(([n])=>n!=='ELECTRON_RUN_AS_NODE'&&!n.startsWith('VSCODE_')));
 const result=spawnSync(process.execPath,[import.meta.filename,'--clean'],{stdio:'inherit',env:{...env,HOME:dir+'/home',USERPROFILE:dir+'/home',TEST_RESOURCES:dir,EXTENSIONS_FOLDER:dir+'/extensions',EXTENSION_DEV_PATH:dir+'/probe',CHAT_PROBE_DIR:dir},timeout:90000});
 console.log(JSON.stringify({dir,status:result.status,signal:result.signal,error:result.error?.message}));process.exit(result.status??1);
}
const require=createRequire('/Users/pedrosantos/www/ProjectMind/package.json');
const {VSBrowser,ReleaseQuality,By}=require('vscode-extension-tester');
const dir=process.env.CHAT_PROBE_DIR;
const code='/Users/pedrosantos/www/ProjectMind/.extest/Visual Studio Code.app/Contents/MacOS/Code';
const metadata=JSON.parse(fs.readFileSync(path.resolve(path.dirname(code),'../Resources/app/product.json')));
const browser=new VSBrowser('1.140.0',ReleaseQuality.Stable,{'workbench.startupEditor':'none','security.workspace.trust.enabled':false,'window.restoreWindows':'none','update.mode':'none','telemetry.telemetryLevel':'off','extensions.autoUpdate':false,'extensions.autoCheckUpdates':false,'markdown-editor.ai.enable':false,'markdown-editor.ai.enableInlineSuggestions':false});
try{
 await browser.start(code,[dir+'/workspace']); await browser.waitForWorkbench();
 await browser.driver.wait(()=>fs.existsSync(dir+'/api-report.json'),30000);
 await browser.driver.wait(async()=>{
  const text=await browser.driver.findElement(By.css('body')).getText();
  return text.includes('Build with Agent')&&text.includes('Sign In');
 },20000);
 const body=await browser.driver.findElement(By.css('body')).getText();
 fs.writeFileSync(dir+'/ui-text.txt',body);
 fs.writeFileSync(dir+'/screenshot.png',await browser.driver.takeScreenshot(),'base64');
 const api=JSON.parse(fs.readFileSync(dir+'/api-report.json'));
 const workspaceBytes=fs.readFileSync(dir+'/workspace/tasks.md','utf8');
 assert.equal(api.version,'1.140.0','runtime host version');
 assert.equal(api.openChat,'completed','native Chat command completion');
 assert.ok(body.includes('Build with Agent'),'native Chat empty session UI');
 assert.ok(body.includes('Sign In'),'native host Sign In UI');
 assert.equal(workspaceBytes,'- [ ] Same\n- [ ] Same\n','disposable fixture preservation');
 const report={version:api.version,commit:metadata.commit,isolatedProfile:true,authenticationQueried:false,modelRequestsSent:false,chatOpened:api.openChat,uiText:body,api,workspaceBytes,settings:JSON.parse(fs.readFileSync(dir+'/settings/User/settings.json')),checks:['runtime host version is 1.140.0','native Chat command completed','Build with Agent and Sign In UI visible','disposable fixture bytes unchanged'],result:'prerequisite inspection only; no actual native chat edit session created'};
 fs.writeFileSync(dir+'/result.json',JSON.stringify(report,null,2)); console.log(JSON.stringify({dir,chatOpened:api.openChat,uiText:body}));
}finally{await browser.quit();}
