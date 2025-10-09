/**
 * RendererRegistry - Central registry for all code renderers
 * 
 * This class manages registration, discovery, and retrieval of renderers.
 * It serves as the single source of truth for available renderers.
 */

import type { IRenderer, IRendererRegistration } from './types';

export class RendererRegistry {
  private renderers: Map<string, IRendererRegistration> = new Map();
  
  /**
   * Register a new renderer
   * @param renderer The renderer to register
   * @param source Where this renderer came from
   * @returns Disposable to unregister
   */
  register(
    renderer: IRenderer, 
    source: 'builtin' | 'extension' | 'user' = 'builtin'
  ): () => void {
    const registration: IRendererRegistration = {
      renderer,
      registeredAt: new Date(),
      source
    };
    
    this.renderers.set(renderer.id, registration);
    
    // Return disposable
    return () => this.unregister(renderer.id);
  }
  
  /**
   * Unregister a renderer
   */
  unregister(id: string): boolean {
    return this.renderers.delete(id);
  }
  
  /**
   * Get a renderer by its ID
   */
  get(id: string): IRenderer | undefined {
    return this.renderers.get(id)?.renderer;
  }
  
  /**
   * Get a renderer by language identifier
   */
  getByLanguage(language: string): IRenderer | undefined {
    for (const registration of this.renderers.values()) {
      if (registration.renderer.language === language) {
        return registration.renderer;
      }
    }
    return undefined;
  }
  
  /**
   * Get all registered renderers
   */
  getAll(): IRenderer[] {
    return Array.from(this.renderers.values()).map(reg => reg.renderer);
  }
  
  /**
   * Get all renderers from a specific source
   */
  getBySource(source: 'builtin' | 'extension' | 'user'): IRenderer[] {
    return Array.from(this.renderers.values())
      .filter(reg => reg.source === source)
      .map(reg => reg.renderer);
  }
  
  /**
   * Check if a renderer is registered
   */
  has(id: string): boolean {
    return this.renderers.has(id);
  }
  
  /**
   * Get registration info for a renderer
   */
  getRegistration(id: string): IRendererRegistration | undefined {
    return this.renderers.get(id);
  }
  
  /**
   * Clear all renderers (useful for testing)
   */
  clear(): void {
    this.renderers.clear();
  }
  
  /**
   * Get count of registered renderers
   */
  get count(): number {
    return this.renderers.size;
  }
}

// Singleton instance
let registryInstance: RendererRegistry | null = null;

/**
 * Get the global renderer registry instance
 */
export function getRendererRegistry(): RendererRegistry {
  if (!registryInstance) {
    registryInstance = new RendererRegistry();
  }
  return registryInstance;
}
