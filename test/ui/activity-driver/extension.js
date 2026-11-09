// Isolated host driver; observes only public VS Code APIs and consumer commands.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
exports.activate = function(context) {
  const folder = process.env.MARKDOWN_UI_WORKSPACE;
  if (!folder) return;
  const uri = vscode.Uri.file(path.join(folder, 'tasks.md'));
  let sequence = 0;
  let operation = 'activation';
  let error;
  let coldActivation;
  let git;
  const snapshot = async () => {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    const value = await vscode.commands.executeCommand('markdown-editor.getActiveContext');
    const report = { sequence: ++sequence, operation, error, coldActivation, version: vscode.version, context: value ?? null,
      git,
      settings: Object.fromEntries(['workbench.editor.decorations.badges','workbench.editor.pinnedTabSizing','files.simpleDialog.enable'].map(key=>[key,vscode.workspace.getConfiguration().get(key)])),
      document: doc && {version:doc.version,dirty:doc.isDirty,text:doc.getText()},
      activeDocument: (()=>{const d=vscode.workspace.textDocuments.find(d=>d.uri.toString()===value?.uri);return d&&{uri:d.uri.toString(),version:d.version,dirty:d.isDirty,text:d.getText()};})(),
      tabs: vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => ({
        uri: tab.input?.uri?.toString(), custom: tab.input instanceof vscode.TabInputCustom,
        pinned:tab.isPinned, preview:tab.isPreview,
        viewType: tab.input?.viewType, active: tab.isActive, groupActive:group.isActive,
      }))),
      nativeEditors: vscode.window.visibleTextEditors.map(e=>e.document.uri.toString()),
      badges: vscode.workspace.getConfiguration('workbench.editor.decorations').get('badges') };
    fs.writeFileSync(path.join(folder,'activity.json'),JSON.stringify(report,null,2));
    return report;
  };
  const register = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand('activity-ui.'+id,async()=>{
    operation=id; error=undefined;
    try { await fn(); } catch(e) { error=String(e); }
    return snapshot();
  }));
  const consumer = async (name, options) => {
    await vscode.extensions.getExtension('markdown-studio-tests.agent-activity-consumer').activate();
    return vscode.commands.executeCommand('agent-activity-consumer.'+name,options);
  };
  const open = () => vscode.commands.executeCommand('vscode.openWith', uri, 'markdown-editor');
  register('open',open); register('snapshot',()=>{});
  register('exports',()=>consumer('report',{uri:uri.toString(),line:1,producer:'exports',label:'Export Agent'}));
  register('commands',()=>consumer('report',{uri:uri.toString(),line:1,transport:'commands',producer:'commands',label:'Command Agent'}));
  register('two',()=>consumer('report',{uri:uri.toString(),line:1,producer:'second',label:'Second Agent'}));
  register('clear',()=>consumer('clear'));
  register('clearCommands',()=>consumer('clear',{producer:'commands'}));
  register('stop',()=>consumer('stopHeartbeat'));
  register('split',()=>vscode.commands.executeCommand('workbench.action.splitEditorRight'));
  register('closeReopen',async()=>{
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor'); await open();
  });
  for (const [name,value] of [['badgesOff',false],['badgesOn',true]]) register(name,()=>vscode.workspace.getConfiguration('workbench.editor.decorations').update('badges',value,vscode.ConfigurationTarget.Global));
  register('editAbove',async()=>{const edit=new vscode.WorkspaceEdit(); edit.insert(uri,new vscode.Position(0,0),'Intro\n'); await vscode.workspace.applyEdit(edit);});
  register('editTask',async()=>{const doc=await vscode.workspace.openTextDocument(uri);const line=doc.getText().split('\n').findLastIndex(x=>x==='- [ ] Same');const edit=new vscode.WorkspaceEdit();edit.replace(uri,new vscode.Range(line,3,line,4),'x');await vscode.workspace.applyEdit(edit);});
  register('compact',async()=>{
    await vscode.workspace.getConfiguration().update('git.decorations.enabled',true,vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration().update('workbench.editor.pinnedTabSizing','compact',vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri),vscode.ViewColumn.Beside);
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    await open();
  });
  register('git',async()=>{
    const extension=vscode.extensions.getExtension('vscode.git');
    const api=(await extension.activate()).getAPI(1);
    const repo=api.repositories.find(r=>r.rootUri.fsPath===folder);
    if(!repo) throw new Error('Isolated Git repository unavailable');
    await repo.status();
    git={version:extension.packageJSON.version,changes:repo.state.workingTreeChanges.map(c=>({uri:c.uri.toString(),status:c.status}))};
  });
  register('resetTabs',async()=>{await vscode.workspace.saveAll(false);for(const group of vscode.window.tabGroups.all) await vscode.window.tabGroups.close([...group.tabs],true);await open();});
  register('saveAs',async()=>{ await vscode.commands.executeCommand('workbench.action.files.saveAs'); });
  register('exportsSaved',()=>consumer('report',{uri:vscode.Uri.file(path.join(folder,'saved.md')).toString(),line:1,producer:'saved',label:'Saved Agent'}));
  register('rename',async()=>{const edit=new vscode.WorkspaceEdit();edit.renameFile(uri,vscode.Uri.file(path.join(folder,'renamed.md')));await vscode.workspace.applyEdit(edit);});
  void (async () => {
    const provider = vscode.extensions.getExtension('phfsantos.markdown-editor');
    const wasActive = provider.isActive;
    const credentials = await vscode.commands.executeCommand('markdown-editor.agentActivity.startSession', {id:'cold',label:'Cold activation'});
    await vscode.commands.executeCommand('markdown-editor.agentActivity.endSession', credentials);
    coldActivation = {wasActive, activated:provider.isActive, ended:true};
    return provider.activate();
  })().then(api=>{
    context.subscriptions.push(api.onDidChangeActiveContext(()=>{void snapshot();})); void snapshot();
  });
};
