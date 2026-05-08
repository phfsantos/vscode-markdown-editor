/**
 * FileSystemHelper - Standardized file operations for renderers
 * 
 * This helper provides a consistent API for renderers to persist data
 * to files in the workspace.
 */

import type { IFileSystemHelper } from './types';
import { getMessageHandler } from './MessageHandler';
import { vscodeLogError } from '../webview-logger';

export class FileSystemHelper implements IFileSystemHelper {
  private messageHandler = getMessageHandler();
  
  /**
   * Load data for a renderer instance
   */
  async loadRendererData(rendererId: string, boardId: string): Promise<any> {
    try {
      const response = await this.messageHandler.sendAndWait(
        'renderer-load-data',
        { rendererId, boardId },
        'renderer-data-loaded'
      );
      
      return response.data;
    } catch (error) {
      vscodeLogError(`❌ FILE SYSTEM: Failed to load data for ${rendererId}/${boardId}`, error);
      throw error;
    }
  }
  
  /**
   * Save data for a renderer instance
   */
  async saveRendererData(rendererId: string, boardId: string, data: any): Promise<void> {
    try {
      await this.messageHandler.sendAndWait(
        'renderer-save-data',
        { rendererId, boardId, data },
        'renderer-data-saved'
      );
    } catch (error) {
      vscodeLogError(`❌ FILE SYSTEM: Failed to save data for ${rendererId}/${boardId}`, error);
      throw error;
    }
  }
  
  /**
   * Check if renderer data file exists
   */
  async hasRendererData(rendererId: string, boardId: string): Promise<boolean> {
    try {
      const response = await this.messageHandler.sendAndWait(
        'renderer-check-data',
        { rendererId, boardId },
        'renderer-data-exists'
      );
      
      return response.exists;
    } catch (error) {
      vscodeLogError(`❌ FILE SYSTEM: Failed to check data for ${rendererId}/${boardId}`, error);
      return false;
    }
  }
}

// Singleton instance
let fileSystemHelperInstance: FileSystemHelper | null = null;

/**
 * Get the global file system helper instance
 */
export function getFileSystemHelper(): FileSystemHelper {
  if (!fileSystemHelperInstance) {
    fileSystemHelperInstance = new FileSystemHelper();
  }
  return fileSystemHelperInstance;
}
