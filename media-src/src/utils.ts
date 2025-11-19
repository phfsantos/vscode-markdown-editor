import { keyboard } from '@testing-library/user-event/dist/keyboard';
import {Webview} from 'vscode'
import $ from 'jquery';
require('jquery-confirm')(window, $);
import 'jquery-confirm/css/jquery-confirm.css';

import _ from 'lodash'
import Vditor from 'vditor'
window.vscode =
  (window as any).acquireVsCodeApi && (window as any).acquireVsCodeApi()
;(window as any).global = window

declare global {
  export const vditor: Vditor
  export const vscode: Webview
  interface Window {
    vditor: Vditor
    vscode: Webview
    global: Window
  }
}

export function confirm(msg, onOk) {
  $.confirm({
    title: '',
    animation: 'top',
    closeAnimation: 'top',
    animateFromElement: false,
    boxWidth: '300px',
    useBootstrap: false,
    content: msg,
    buttons: {
      cancel: {
        text: 'Cancel',
      },
      confirm: {
        text: 'Confirm',
        action: onOk,
      },
    },
  })
}
// 切换 content-theme 时自动修改 vditor theme
export function fixDarkTheme() {
  let $ct = document.querySelector('[data-type="content-theme"]')
  $ct.nextElementSibling.addEventListener('click', (e) => {
    if ((e.target as any).tagName !== 'BUTTON') return
    let type = (e.target as any).getAttribute('data-type')
    if (type === 'dark') {
      vditor.setTheme(type)
    } else {
      vditor.setTheme('classic')
    }
  })
}
// panel hover 加定时延迟
export function fixPanelHover() {
  $('.vditor-panel').each((i, e) => {
    let timer
    $(e)
      .on('mouseenter', (e) => {
        timer && clearTimeout(timer)
        e.currentTarget.classList.add('vditor-panel_hover')
      })
      .on('mouseleave', (e) => {
        let el = e.currentTarget
        timer = setTimeout(() => {
          el.classList.remove('vditor-panel_hover')
        }, 2000)
      })
  })
}
// 文件转base64用于传输
export const fileToBase64 = async (file) => {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = function (evt) {
      res(evt.target.result.toString().split(',')[1])
    }
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}
// 保存 vditor 配置到 vscode 同步存储
export function saveVditorOptions() {
  let vditorOptions = {
    theme: vditor.vditor.options.theme,
    mode: vditor.vditor.currentMode,
    preview: vditor.vditor.options.preview,
  }
  vscode.postMessage({
    command: 'save-options',
    options: vditorOptions,
  })
}
// toolbar 点击时保存配置
export function handleToolbarClick() {
  $(
    '.vditor-toolbar .vditor-panel--left button, .vditor-toolbar .vditor-panel--arrow button'
  ).on('click', (e) => {
    setTimeout(() => {
      saveVditorOptions()
    }, 500)
  })
}

export function fixLinkClick() {
  const openLink = async (url: string) => {
    vscode.postMessage({ command: 'open-link', href: url })
  }
  document.addEventListener('click', e=> {
    const el = e.target as HTMLAnchorElement
    if (el.tagName === 'A') {
      openLink(el.href)
    }
  })
  window.open = (url: string, ...args: any[]) => {
    openLink(url)
    return window
  }
}


/** error:
 We don't execute document.execCommand() this time, because it is called recursively.
(anonymous) @ main.js:32449
(anonymous) @ main.js:842
(anonymous) @ host.js:27
see: https://github.com/nwjs/nw.js/issues/3403 */
export function fixCut() {
  let _exec = document.execCommand.bind(document)
  document.execCommand = (cmd, ...args) => {
    if (cmd === 'delete') {
      setTimeout(() => {
        return _exec(cmd, ...args)
      })
    } else {
      return _exec(cmd, ...args)
    }
  }
}


/**
 * Clean HTML/markdown content by removing diagnostic and diff decoration artifacts
 * This avoids DOM manipulation and prevents text jumping
 * @param content The raw content from vditor.getValue()
 * @returns Cleaned content without diagnostic/diff decorations
 */
export function cleanContentForSave(content: string): string {
  if (!content) return content;

  // Remove diagnostic decoration spans and attributes
  let cleaned = content;

  // Remove diagnostic severity class spans (e.g., vscode-diagnostic-error-underline)
  // Handles class attribute anywhere in the span tag and diagnostic class anywhere in the class list
  // Apply multiple times to handle nested spans
  let prevCleaned = "";
  while (prevCleaned !== cleaned) {
    prevCleaned = cleaned;
    cleaned = cleaned.replace(
      /<span\s+(?:[^>]*\s+)?class="[^"]*\bvscode-diagnostic-[^"\s]*[^"]*"[^>]*>(.*?)<\/span>/g,
      "$1"
    );
  }

  // Remove diagnostic source attributes
  cleaned = cleaned.replace(/\s+data-diagnostic-source="[^"]*"/g, "");

  // Remove diff decoration spans (added, removed, modified)
  // Handles class attribute anywhere in the span tag and diff class anywhere in the class list
  // Apply multiple times to handle nested spans
  prevCleaned = "";
  while (prevCleaned !== cleaned) {
    prevCleaned = cleaned;
    cleaned = cleaned.replace(
      /<span\s+(?:[^>]*\s+)?class="[^"]*\bvscode-diff-(?:added|removed|modified)\b[^"]*"[^>]*>(.*?)<\/span>/g,
      "$1"
    );
  }

  // Remove lightbulb emoji characters
  cleaned = cleaned.replace(/💡/g, "");

  // Remove any inline styles added by decorations
  cleaned = cleaned.replace(
    /\s+style="[^"]*(?:text-decoration|background-color|border-bottom)[^"]*"/g,
    ""
  );

  // Remove diff spacer block markers
  cleaned = cleaned.replace(/<!--\s*vscode-diff-spacer:\s*\d+\s*-->/g, "");

  // Remove any empty spans that might be left over
  cleaned = cleaned.replace(/<span><\/span>/g, "");

  return cleaned;
}

/**
 * Get cleaned HTML content from Vditor instance
 * @param vditor The Vditor instance
 * @returns Cleaned HTML content
 */
export const getHTML = (vditor: IVditor) => {
  const currentHTML = vditor.ir.element.innerHTML;
  const cleanedHTML = cleanContentForSave(currentHTML);
  return vditor.lute.VditorIRDOM2HTML(cleanedHTML);
};

/**
 * Get cleaned markdown content from Vditor instance
 * @param vditor The Vditor instance
 * @returns Cleaned markdown content
 */
export const getValue = (vditor: IVditor) => {
  const currentHTML = vditor.ir.element.innerHTML;
  const cleanedHTML = cleanContentForSave(currentHTML);
  return vditor.lute.VditorIRDOM2Md(cleanedHTML);
};