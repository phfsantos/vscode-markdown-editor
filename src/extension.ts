import * as vscode from 'vscode';
const KeyVditorOptions = 'vditor.options';
import { PreviewCustomEditorProvider } from './app/PreviewCustomEditorProvider';
import { EditorPanel } from './app/EditorPanel';
import { debug } from './app/_utils';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.openEditor',
      (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        EditorPanel.createOrShow(context, uri)
      }
    )
  )

  context.globalState.setKeysForSync([KeyVditorOptions])

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'markdown-editor',
      new PreviewCustomEditorProvider(context),
    ),
  );
}
