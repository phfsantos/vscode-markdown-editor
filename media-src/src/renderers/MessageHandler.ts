/**
 * MessageHandler - Handles communication between webview and extension host
 */

import type { IMessageHandler, IRendererMessage } from './types';

export class MessageHandler implements IMessageHandler {
  private listeners: Map<string, Set<(payload: any) => void>> = new Map();
  
  constructor() {
    // Listen for messages from extension host
    window.addEventListener('message', this.handleMessage.bind(this));
  }
  
  /**
   * Send a message to the extension host
   */
  send(command: string, payload: any): void {
    const message: IRendererMessage = {
      command,
      ...payload
    };
    
    if ((window as any).vscode) {
      (window as any).vscode.postMessage(message);
      console.log(`📤 MESSAGE: Sent '${command}'`, payload);
    } else {
      console.error('❌ MESSAGE: VS Code API not available');
    }
  }
  
  /**
   * Listen for messages from extension host
   * @returns Disposable to remove listener
   */
  on(command: string, handler: (payload: any) => void): () => void {
    if (!this.listeners.has(command)) {
      this.listeners.set(command, new Set());
    }
    
    this.listeners.get(command)!.add(handler);
    console.log(`👂 MESSAGE: Added listener for '${command}'`);
    
    // Return disposable
    return () => {
      const handlers = this.listeners.get(command);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.listeners.delete(command);
        }
        console.log(`🔇 MESSAGE: Removed listener for '${command}'`);
      }
    };
  }
  
  /**
   * Handle incoming messages from extension host
   */
  private handleMessage(event: MessageEvent): void {
    const message: IRendererMessage = event.data;
    
    if (!message.command) {
      return;
    }
    
    console.log(`📥 MESSAGE: Received '${message.command}'`, message);
    
    const handlers = this.listeners.get(message.command);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error(`❌ MESSAGE: Error in handler for '${message.command}'`, error);
        }
      });
    }
  }
  
  /**
   * Send a message and wait for a response
   * @param command Command to send
   * @param payload Payload to send
   * @param responseCommand Expected response command
   * @param timeout Timeout in ms (default 5000)
   */
  sendAndWait<T = any>(
    command: string, 
    payload: any, 
    responseCommand: string,
    timeout: number = 5000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(2, 15);
      let timeoutHandle: NodeJS.Timeout;
      
      // Listen for response
      const removeListener = this.on(responseCommand, (response: any) => {
        if (response.requestId === requestId) {
          clearTimeout(timeoutHandle);
          removeListener();
          
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.payload || response);
          }
        }
      });
      
      // Set timeout
      timeoutHandle = setTimeout(() => {
        removeListener();
        reject(new Error(`Timeout waiting for '${responseCommand}'`));
      }, timeout);
      
      // Send message
      this.send(command, { ...payload, requestId });
    });
  }
  
  /**
   * Remove all listeners
   */
  dispose(): void {
    this.listeners.clear();
    console.log('🧹 MESSAGE: Disposed all listeners');
  }
}

// Singleton instance
let messageHandlerInstance: MessageHandler | null = null;

/**
 * Get the global message handler instance
 */
export function getMessageHandler(): MessageHandler {
  if (!messageHandlerInstance) {
    messageHandlerInstance = new MessageHandler();
  }
  return messageHandlerInstance;
}
