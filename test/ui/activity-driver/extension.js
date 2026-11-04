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
  const snapshot = async () => {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    const value = await vscode.commands.executeCommand('markdown-editor.getActiveContext');
    const report = { sequence: ++sequence, operation, error, version: vscode.version, context: value ?? null,
      document: doc && {version:doc.version,dirty:doc.isDirty,text:doc.getText()},
      tabs: vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => ({
        uri: tab.input?.uri?.toString(), custom: tab.input instanceof vscode.TabInputCustom,
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
  register('stop',()=>consumer('stopHeartbeat'));
  register('split',()=>vscode.commands.executeCommand('workbench.action.splitEditorRight'));
  register('closeReopen',async()=>{
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor'); await open();
  });
  for (const [name,value] of [['badgesOff',false],['badgesOn',true]]) register(name,()=>vscode.workspace.getConfiguration('workbench.editor.decorations').update('badges',value,vscode.ConfigurationTarget.Global));
  register('editAbove',async()=>{const edit=new vscode.WorkspaceEdit(); edit.insert(uri,new vscode.Position(0,0),'Intro\n'); await vscode.workspace.applyEdit(edit);});
  register('editTask',async()=>{const doc=await vscode.workspace.openTextDocument(uri);const line=doc.getText().split('\n').findLastIndex(x=>x==='- [ ] Same');const edit=new vscode.WorkspaceEdit();edit.replace(uri,new vscode.Range(line,3,line,4),'x');await vscode.workspace.applyEdit(edit);});
  register('rename',async()=>{const edit=new vscode.WorkspaceEdit();edit.renameFile(uri,vscode.Uri.file(path.join(folder,'renamed.md')));await vscode.workspace.applyEdit(edit);});
  void vscode.extensions.getExtension('phfsantos.markdown-editor').activate().then(api=>{
    context.subscriptions.push(api.onDidChangeActiveContext(()=>{void snapshot();})); void snapshot();
  });
};
