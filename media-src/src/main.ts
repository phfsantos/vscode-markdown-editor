import "./preload";

import {
  fileToBase64,
  fixCut,
  fixDarkTheme,
  fixLinkClick,
  fixPanelHover,
  handleToolbarClick,
  saveVditorOptions,
} from "./utils";

import { merge } from "lodash";
import Vditor from "vditor";
import { format, set } from "date-fns";
import "vditor/dist/index.css";
import { t, lang } from "./lang";
import { toolbar } from "./toolbar";
import { fixTableIr } from "./fix-table-ir";
import words from "./words.en.txt";
import "./main.css";

function initVditor(msg) {
  const predictionary = window.Predictionary && window.Predictionary.instance();
  const dictionaryKey = "en_US";
  predictionary.parseWords(words, {
      elementSeparator: '\n',
      rankSeparator: ' ',
      wordPosition: 2,
      rankPosition: 0,
      addToDictionary: dictionaryKey
  });
  predictionary.useDictionaries([dictionaryKey]);
  let inputTimer;
  let defaultOptions: any = {
    hint: {
      extend: [{
        key: "{{",
        hint: (word) => {
          return predictionary.predict(word || "a", {maxPredictions: 5}).map((w) => ({html: w, value: w}));
        },
      }],
    }
  };
  if (msg.theme === "dark") {
    // vditor.setTheme('dark', 'dark')
    defaultOptions = merge(defaultOptions, {
      theme: "dark",
      preview: {
        theme: {
          current: "dark",
        },
      },
    });
  }
  defaultOptions = merge(defaultOptions, msg.options, {
    typewriterMode: true,
    preview: {
      math: {
        inlineDigit: true,
      },
      markdown: {
        mark: true,
        fixTermTypo: true,
      }
    },
  });
  if (window.vditor) {
    vditor.destroy();
    window.vditor = null;
  }
  window.vditor = new Vditor("app", {
    width: "100%",
    height: "100%",
    minHeight: "100%",
    lang,
    value: msg.content,
    mode: "ir",
    cache: { enable: false },
    toolbar,
    toolbarConfig: { pin: true },
    ...defaultOptions,
    after() {
      fixDarkTheme();
      handleToolbarClick();
      fixTableIr();
      fixPanelHover();
    },
    input() {
      inputTimer && clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        vscode.postMessage({ command: "edit", content: vditor.getValue() });
      }, 100);
    },
    upload: {
      url: "/fuzzy", // 没有 url 参数粘贴图片无法上传 see: https://github.com/Vanessa219/vditor/blob/d7628a0a7cfe5d28b055469bf06fb0ba5cfaa1b2/src/ts/util/fixBrowserBehavior.ts#L1409
      async handler(files) {
        // console.log('files', files)
        let fileInfos = await Promise.all(
          files.map(async (f) => {
            const d = new Date();
            return {
              base64: await fileToBase64(f),
              name: `${format(new Date(), "yyyyMMdd_HHmmss")}_${
                f.name
              }`.replace(/[^\w-_.]+/, "_"),
            };
          })
        );
        vscode.postMessage({
          command: "upload",
          files: fileInfos,
        });
      },
    },
    customRenders: [
      {
        language: "kanban-board",
        render: (code) => {
          return new Promise((resolve) => {
            const element = code.querySelector(
              "code.language-kanban-board"
            ) as HTMLElement;
            const ir__node = code.closest(".vditor-ir__node") as HTMLElement;
            const wysiwyg__node = code.closest(
              ".vditor-wysiwyg__block"
            ) as HTMLElement;
            const node = ir__node || wysiwyg__node;
            
            // Make sure the kanban-board is rendered only once
            if (element) {
              element.outerHTML = `<kanban-board class="language-kanban-board" data='${encodeURIComponent(element.textContent)}'></kanban-board>`;
            }

            if (node) {
              // Stop the event propagation for the kanban-board to function as intended
              const letItFocus = (e) => {
                e.stopPropagation();
              };
              code.addEventListener("click", letItFocus);
              code.addEventListener("mousedown", letItFocus);
              code.addEventListener("mouseup", letItFocus);
              code.addEventListener("mousemove", letItFocus);
              code.addEventListener("keydown", letItFocus);
              code.addEventListener("keypress", letItFocus);
              code.addEventListener("keyup", letItFocus);
              code.addEventListener("beforeinput", letItFocus);
              code.addEventListener("focus", letItFocus);
              code.addEventListener("focusin", letItFocus);
              code.addEventListener("input", letItFocus);

              const kanbanBoard = code.querySelector("kanban-board");
              // Should save to the vscode
              kanbanBoard.addEventListener("kanban-save", (e: CustomEvent) => {
                const content = JSON.stringify(e.detail);
                if (
                  node &&
                  node.checkVisibility({
                    checkOpacity: true,
                    checkVisibilityCSS: true,
                  }) &&
                  kanbanBoard
                ) {
                  const irElement = node.querySelector(
                    ".vditor-ir__marker--pre code.language-kanban-board"
                  ) as HTMLElement;
                  if (
                    content &&
                    irElement &&
                    content !== irElement.textContent
                  ) {
                    irElement.textContent = content;
                    irElement.innerHTML = content;
                    irElement.dispatchEvent(
                      new InputEvent("input", {
                        data: content,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        inputType: "insertText",
                      })
                    );
                  }
                  const wysiwygElement = node.querySelector(
                    ".vditor-wysiwyg__pre code.language-kanban-board"
                  ) as HTMLElement;
                  if (
                    content &&
                    wysiwygElement &&
                    content !== wysiwygElement.textContent
                  ) {
                    wysiwygElement.textContent = content;
                    wysiwygElement.innerHTML = content;
                    wysiwygElement.dispatchEvent(
                      new InputEvent("input", {
                        data: content,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        inputType: "insertText",
                      })
                    );
                  }
                }
              });
            } else {
              // Disable the kanban-board if it's in preview mode
              const kanbanBoard = code.querySelector("kanban-board");
              kanbanBoard.setAttribute(
                "style",
                "pointer-events: none; cursor: not-allowed; user-select: none;"
              );
            }

            resolve(true);
          });
        },
      },
    ],
  });
}

window.addEventListener("message", (e) => {
  const msg = e.data;
  // console.log('msg from vscode', msg)
  switch (msg.command) {
    case "update": {
      if (msg.type === "init") {
        if (msg.options && msg.options.useVscodeThemeColor) {
          document.body.setAttribute("data-use-vscode-theme-color", "1");
        } else {
          document.body.setAttribute("data-use-vscode-theme-color", "0");
        }
        try {
          initVditor(msg);
        } catch (error) {
          // reset options when error
          console.error(error);
          initVditor({ content: msg.content });
          saveVditorOptions();
        }
        console.log("initVditor");
      } else {
        vditor.setValue(msg.content);
        console.log("setValue");
      }
      break;
    }
    case "uploaded": {
      msg.files.forEach((f) => {
        if (f.endsWith(".wav")) {
          vditor.insertValue(
            `\n\n<audio controls="controls" src="${f}"></audio>\n\n`
          );
        } else {
          const i = new Image();
          i.src = f;
          i.onload = () => {
            vditor.insertValue(`\n\n![](${f})\n\n`);
          };
          i.onerror = () => {
            vditor.insertValue(`\n\n[${f.split("/").slice(-1)[0]}](${f})\n\n`);
          };
        }
      });
      break;
    }
    default:
      break;
  }
});

fixLinkClick();
fixCut();

vscode.postMessage({ command: "ready" });
