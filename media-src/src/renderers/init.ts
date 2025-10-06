/**
 * Renderer initialization and setup
 * 
 * This module handles initialization of the renderer system,
 * registration of built-in renderers, and integration with Vditor.
 */

import { getRendererRegistry, getMessageHandler, getFileSystemHelper } from './index';
import { KanbanRenderer } from './builtin/KanbanRenderer';
import { TableRenderer } from './builtin/TableRenderer';
import { PlaygroundRenderer } from './builtin/PlaygroundRenderer';
import type { IRenderContext } from './types';
import type Vditor from 'vditor';

/**
 * Initialize the renderer system
 * Registers all built-in renderers
 */
export function initializeRendererSystem(): void {
  console.log('🚀 RENDERER SYSTEM: Initializing...');
  
  const registry = getRendererRegistry();
  
  // Register built-in renderers
  const kanbanRenderer = new KanbanRenderer();
  registry.register(kanbanRenderer, 'builtin');
  
  const tableRenderer = new TableRenderer();
  registry.register(tableRenderer, 'builtin');
  
  const playgroundRenderer = new PlaygroundRenderer();
  registry.register(playgroundRenderer, 'builtin');
  
  console.log(`✅ RENDERER SYSTEM: Initialized with ${registry.count} renderer(s)`);
}

/**
 * Generate Vditor customRenders array from registry
 * This bridges the renderer system with Vditor's API
 */
export function generateVditorCustomRenders(documentUri: string, vditor: Vditor): any[] {
  const registry = getRendererRegistry();
  const messageHandler = getMessageHandler();
  const fileSystemHelper = getFileSystemHelper();
  
  const customRenders: any[] = [];
  
  for (const renderer of registry.getAll()) {
    console.log(`🔧 RENDERER SYSTEM: Creating Vditor render function for '${renderer.id}'`);
    
    customRenders.push({
      language: renderer.language,
      render: (code: HTMLElement) => {
        return new Promise(async (resolve) => {
          try {
            // CRITICAL: Check if already rendered to prevent re-rendering on every keystroke
            // Check for the actual interactive container, not just an attribute
            const existingContainer = code.querySelector(`.interactive-table-container, .kanban-board-container, .playground-container`);
            if (existingContainer) {
              console.log(`✅ RENDERER SYSTEM: '${renderer.id}' has interactive container, already rendered, skipping...`);
              resolve(true);
              return;
            }
            
            // Also check the data attribute as backup
            if (code.hasAttribute(`data-${renderer.language}-rendered`)) {
              console.log(`✅ RENDERER SYSTEM: '${renderer.id}' has render attribute, skipping...`);
              resolve(true);
              return;
            }
            
            // Check if code element itself has the container class
            if (code.classList.contains('interactive-table-container') || 
                code.classList.contains('kanban-board-container') ||
                code.classList.contains('playground-container')) {
              console.log(`✅ RENDERER SYSTEM: '${renderer.id}' code element IS container, skipping...`);
              resolve(true);
              return;
            }
            
            // Check for generic container class based on language
            const hasGenericContainer = code.querySelector(`.${renderer.language}-container`);
            if (hasGenericContainer) {
              console.log(`✅ RENDERER SYSTEM: '${renderer.id}' has ${renderer.language}-container, skipping...`);
              resolve(true);
              return;
            }
            
            // Mark as being rendered to prevent concurrent renders
            code.setAttribute(`data-${renderer.language}-rendered`, 'true');
            
            // Generate unique instance ID
            const instanceId = Math.random().toString(36).substring(2, 15);
            
            // Extract board ID from code element
            // The 'code' parameter IS the code element itself OR contains it as child
            let codeElement: HTMLElement | null = null;
            
            if (code.classList.contains(`language-${renderer.language}`)) {
              // code IS the code element
              codeElement = code;
            } else {
              // code is a wrapper, find the actual code element
              codeElement = code.querySelector(`code.language-${renderer.language}`) as HTMLElement;
            }
            
            // Use renderer's extractId method to get the ID
            // Each renderer implements its own ID extraction logic
            const boardId = codeElement ? renderer.extractId(codeElement) : 'default';
            
            console.log(`🔍 RENDERER SYSTEM: Extracted boardId='${boardId}' from code element`, { 
              hasCodeElement: !!codeElement,
              codeTagName: code.tagName,
              codeClasses: Array.from(code.classList || [])
            });
            
            // Create render context
            const context: IRenderContext = {
              documentUri,
              instanceId,
              boardId,
              vditor,
              messageHandler,
              fileSystemHelper
            };
            
            console.log(`🎨 RENDERER SYSTEM: Rendering '${renderer.id}' (board: ${boardId}, instance: ${instanceId})`);
            
            // Load renderer dependencies if needed
            if (renderer.onLoad) {
              await renderer.onLoad(context);
            }
            
            // Render
            await renderer.render(code, vditor, context);
            
            resolve(true);
          } catch (error) {
            console.error(`❌ RENDERER SYSTEM: Error rendering '${renderer.id}'`, error);
            code.innerHTML = `
              <div class="renderer-error" style="
                padding: 16px;
                border: 2px solid var(--vscode-errorForeground, #f48771);
                border-radius: 4px;
                background: var(--vscode-inputValidation-errorBackground, rgba(244, 135, 113, 0.1));
                color: var(--vscode-errorForeground, #f48771);
                font-family: var(--vscode-font-family);
              ">
                <strong>⚠️ Renderer Error (${renderer.name})</strong><br>
                ${error instanceof Error ? error.message : String(error)}
              </div>
            `;
            resolve(true);
          }
        });
      }
    });
  }
  
  console.log(`✅ RENDERER SYSTEM: Generated ${customRenders.length} Vditor custom render(s)`);
  return customRenders;
}

/**
 * Get renderer by language
 * Convenience function for looking up renderers
 */
export function getRendererByLanguage(language: string) {
  return getRendererRegistry().getByLanguage(language);
}
