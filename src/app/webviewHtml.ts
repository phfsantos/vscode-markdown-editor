import * as vscode from "vscode";
import * as NodePath from "path";

/**
 * Panel state needed to render the editor webview's HTML shell.
 */
export interface WebviewHtmlContext {
  extensionUri: vscode.Uri;
  config: vscode.WorkspaceConfiguration;
  fsPath: string;
}

export function getHtmlForWebview(webview: vscode.Webview, ctx: WebviewHtmlContext) {
  const toUri = (f: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, f));
  const baseHref =
    NodePath.dirname(
      webview.asWebviewUri(vscode.Uri.file(ctx.fsPath)).toString()
    ) + "/";
  const toMediaPath = (f: string) => `out/media/${f}`;
  const JsFiles = ["main.js"].map(toMediaPath).map(toUri);
  const CssFiles = ["main.css"].map(toMediaPath).map(toUri);

  // Add Vditor dependencies that need to execute before main.js
  // These set window.VditorI18n and insert SVG icons into the DOM
  const VditorDepsFiles = [
    "dist/js/i18n/en_US.js",
    "dist/js/icons/ant.js",
    "dist/js/icons/material.js",
  ]
    .map(toMediaPath)
    .map(toUri);

  // Add widget system bundle
  const widgetBundleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(ctx.extensionUri, "out", "widgets", "index.js")
  );

  // Add codicon CSS from out/sidebar (same as sidebar)
  const codiconsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(ctx.extensionUri, "out", "sidebar", "codicon.css")
  );

  return `<!DOCTYPE html>
          <html lang="en" style="height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden;">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
                webview.cspSource
              } 'unsafe-inline'; script-src ${
    webview.cspSource
  } 'unsafe-inline' 'unsafe-eval'; img-src ${
    webview.cspSource
  } https: data: blob:; font-src ${webview.cspSource} data:; media-src ${
    webview.cspSource
  } https: data:; connect-src ${webview.cspSource} https:;">
              <base href="${baseHref}" />
              <link href="${codiconsUri}" rel="stylesheet">
              ${CssFiles.map(
                (f) => `<link href="${f}" rel="stylesheet">`
              ).join("\n")}
              <title>markdown editor</title>
              <style>
                  /* Inline critical styles for immediate effect */
                  html, body {
                      height: 100vh !important;
                      width: 100vw !important;
                      margin: 0 !important;
                      padding: 0 !important;
                      overflow: hidden !important;
                      position: fixed !important;
                      top: 0 !important;
                      left: 0 !important;
                      right: 0 !important;
                      bottom: 0 !important;
                  }
                  #app {
                      height: 100vh !important;
                      width: 100vw !important;
                      margin: 0 !important;
                      padding: 0 !important;
                      overflow: hidden !important;
                      position: absolute !important;
                      top: 0 !important;
                      left: 0 !important;
                      right: 0 !important;
                      bottom: 0 !important;
                  }
                  ${ctx.config.get<string>("customCss") || ""}
              </style>
          </head>
          <body style="height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden; position: fixed; top: 0; left: 0; right: 0; bottom: 0;">
              <div id="app" style="height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden; position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
              <!-- Load Vditor dependencies first (i18n and icons) -->
              ${VditorDepsFiles.map(
                (f) => `<script src="${f}"></script>`
              ).join("\n")}
              <!-- Load widget system bundle -->
              <script src="${widgetBundleUri}"></script>
              <!-- Load main application bundle -->
              ${JsFiles.map((f) => `<script src="${f}"></script>`).join("\n")}

              <!-- Inline handler for openEmbedPreview so overlay works without rebuilding the bundle -->
              <script>
              (function(){
                window.addEventListener('message', function(e){
                  var msg = e.data || {};
                  if (msg.command !== 'openEmbedPreview') return;
                  try {
                    var embed = msg.embed || {};
                    var overlay = document.getElementById('vscode-embed-preview-overlay');
                    if (!overlay) {
                      overlay = document.createElement('div');
                      overlay.id = 'vscode-embed-preview-overlay';
                      overlay.style.position = 'fixed';
                      overlay.style.right = '20px';
                      overlay.style.bottom = '20px';
                      overlay.style.zIndex = '20000';
                      overlay.style.maxWidth = '40vw';
                      overlay.style.maxHeight = '60vh';
                      overlay.style.overflow = 'auto';
                      overlay.style.background = 'rgba(0,0,0,0.85)';
                      overlay.style.border = '1px solid #333';
                      overlay.style.borderRadius = '6px';
                      overlay.style.padding = '8px';
                      overlay.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6)';
                      overlay.style.color = '#ddd';
                      document.body.appendChild(overlay);
                    }
                    overlay.innerHTML = '';
                    var hdr = document.createElement('div');
                    hdr.style.display = 'flex';
                    hdr.style.justifyContent = 'space-between';
                    hdr.style.alignItems = 'center';
                    hdr.style.marginBottom = '6px';
                    var title = document.createElement('div');
                    title.textContent = embed.fileName || (embed.path ? embed.path.split('/').slice(-1)[0] : 'Embed');
                    title.style.fontWeight = '600';
                    var closeBtn = document.createElement('button');
                    closeBtn.textContent = 'Close';
                    closeBtn.className = 'vscode-quickfix-button';
                    closeBtn.addEventListener('click', function(){ overlay && overlay.remove(); });
                    hdr.appendChild(title);
                    hdr.appendChild(closeBtn);
                    overlay.appendChild(hdr);

                    if (embed.dataUrl && (embed.mimeType || '').startsWith('image/')) {
                      var img = document.createElement('img');
                      img.src = embed.dataUrl;
                      img.style.maxWidth = '100%';
                      img.style.height = 'auto';
                      overlay.appendChild(img);
                    } else if (embed.text) {
                      var pre = document.createElement('pre');
                      pre.style.whiteSpace = 'pre-wrap';
                      pre.style.wordBreak = 'break-word';
                      pre.textContent = embed.text.substring(0, 20000);
                      overlay.appendChild(pre);
                    } else if (embed.dataUrl) {
                      var link = document.createElement('a');
                      link.href = embed.dataUrl;
                      link.textContent = embed.fileName || 'Download';
                      link.target = '_blank';
                      overlay.appendChild(link);
                    } else if (embed.path) {
                      var info = document.createElement('div');
                      info.textContent = 'Path: ' + embed.path;
                      overlay.appendChild(info);
                    } else {
                      var info2 = document.createElement('div');
                      info2.textContent = 'No preview available for this embed';
                      overlay.appendChild(info2);
                    }
                    // If we have an inline dataUrl, add a Download link
                    if (embed.dataUrl) {
                      var dlRow2 = document.createElement('div');
                      dlRow2.style.display = 'flex';
                      dlRow2.style.justifyContent = 'flex-end';
                      dlRow2.style.marginTop = '8px';
                      var dlLink2 = document.createElement('a');
                      dlLink2.href = embed.dataUrl;
                      dlLink2.textContent = 'Download';
                      dlLink2.target = '_blank';
                      dlLink2.className = 'vscode-quickfix-button';
                      dlLink2.style.marginRight = '8px';
                      dlRow2.appendChild(dlLink2);
                      overlay.appendChild(dlRow2);
                    }
                    // If the extension chose not to embed the file (too large), show the note and Open button
                    if (embed.note) {
                      var note = document.createElement('div');
                      note.style.marginTop = '8px';
                      note.style.fontSize = '12px';
                      note.style.opacity = '0.9';
                      note.textContent = embed.note;
                      overlay.appendChild(note);
                    }

                    if (embed.path) {
                      var openRow = document.createElement('div');
                      openRow.style.display = 'flex';
                      openRow.style.justifyContent = 'flex-end';
                      openRow.style.marginTop = '8px';
                      var openBtn = document.createElement('button');
                      openBtn.textContent = 'Open';
                      openBtn.className = 'vscode-quickfix-button';
                      openBtn.addEventListener('click', function(){
                        try {
                          // Use acquireVsCodeApi if available, else fallback to vscode global
                          var api = (window).acquireVsCodeApi ? (window).acquireVsCodeApi() : (window).vscode;
                          if (api && api.postMessage) {
                            api.postMessage({ command: 'openFile', path: embed.path });
                          } else if (window && window.postMessage) {
                            // last resort
                            window.postMessage({ command: 'openFile', path: embed.path }, '*');
                          }
                        } catch (err) {
                          // Note: This is in HTML template, errors logged in browser console
                          if (window.console) window.console.error('Open button failed', err);
                        }
                      });
                      openRow.appendChild(openBtn);
                      overlay.appendChild(openRow);
                    }
                  } catch (err) {
                    // Note: This is in HTML template, errors logged in browser console
                    if (window.console) window.console.error('openEmbedPreview overlay failed', err);
                  }
                });
              })();
              </script>
          </body>
          </html>`;
}
