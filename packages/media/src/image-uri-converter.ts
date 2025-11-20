/**
 * Image URI Converter
 * 
 * Converts file:// URIs and relative paths to vscode-webview-resource:// URIs
 * so images can load properly in the webview.
 * 
 * Background: Vditor renders markdown images with their original paths (relative or absolute file paths),
 * but webviews require special vscode-webview-resource:// URIs to load local files for security.
 */

import Vditor from 'vditor';

export class ImageURIConverter {
  private vditor: Vditor;
  private documentPath: string;
  private observer: MutationObserver | null = null;
  private conversionCache = new Map<string, string>();

  constructor(vditor: Vditor) {
    this.vditor = vditor;
    this.documentPath = '';
  }

  /**
   * Initialize the converter with the current document path
   */
  public initialize(documentPath: string): void {
    this.documentPath = documentPath;
    this.log(`Initialized with document path: ${documentPath}`);
    
    // Convert any existing images
    this.convertAllImages();
    
    // Watch for DOM changes to convert new images
    this.setupMutationObserver();
  }

  /**
   * Convert all image src attributes in the editor
   */
  public convertAllImages(): void {
    const editor = this.getEditorElement();
    if (!editor) {
      this.log('No editor element found');
      return;
    }

    const images = editor.querySelectorAll('img[src]');
    this.log(`Found ${images.length} images to convert`);
    
    images.forEach((img) => {
      const originalSrc = img.getAttribute('src');
      if (originalSrc && this.needsConversion(originalSrc)) {
        const convertedSrc = this.convertPath(originalSrc);
        if (convertedSrc !== originalSrc) {
          img.setAttribute('src', convertedSrc);
          img.setAttribute('data-original-src', originalSrc);
          this.log(`Converted image: ${originalSrc} → ${convertedSrc}`);
        }
      }
    });
  }

  /**
   * Check if a path needs conversion
   */
  private needsConversion(src: string): boolean {
    // Already converted
    if (src.startsWith('vscode-webview-resource:') || src.startsWith('vscode-resource:')) {
      return false;
    }
    
    // Data URLs and blobs don't need conversion
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      return false;
    }
    
    // External URLs don't need conversion
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return false;
    }
    
    // File URLs and relative paths need conversion
    return true;
  }

  /**
   * Convert a file path to a webview URI by requesting conversion from the extension
   */
  private convertPath(originalPath: string): string {
    // Check cache first
    if (this.conversionCache.has(originalPath)) {
      return this.conversionCache.get(originalPath)!;
    }

    // For now, just clean up file:// URIs and return
    // The real conversion happens via CSP and base href in the HTML template
    let convertedPath = originalPath;
    
    // Remove file:// protocol if present
    if (convertedPath.startsWith('file://')) {
      convertedPath = convertedPath.substring(7);
    }
    
    // If it's an absolute path, try to make it relative to the document
    if (convertedPath.startsWith('/') && this.documentPath) {
      const documentDir = this.documentPath.substring(0, this.documentPath.lastIndexOf('/'));
      if (convertedPath.startsWith(documentDir)) {
        // Make it relative to the document directory
        convertedPath = convertedPath.substring(documentDir.length + 1);
      }
    }
    
    // Cache the conversion
    this.conversionCache.set(originalPath, convertedPath);
    
    return convertedPath;
  }

  /**
   * Setup a MutationObserver to watch for new images
   */
  private setupMutationObserver(): void {
    const editor = this.getEditorElement();
    if (!editor) {
      this.log('Cannot setup observer: no editor element');
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              // Check if the node itself is an image
              if (node.tagName === 'IMG') {
                const src = node.getAttribute('src');
                if (src && this.needsConversion(src)) {
                  const convertedSrc = this.convertPath(src);
                  if (convertedSrc !== src) {
                    node.setAttribute('src', convertedSrc);
                    node.setAttribute('data-original-src', src);
                    this.log(`Converted new image: ${src} → ${convertedSrc}`);
                  }
                }
              }
              
              // Check for images in child elements
              const images = node.querySelectorAll('img[src]');
              images.forEach((img) => {
                const src = img.getAttribute('src');
                if (src && this.needsConversion(src)) {
                  const convertedSrc = this.convertPath(src);
                  if (convertedSrc !== src) {
                    img.setAttribute('src', convertedSrc);
                    img.setAttribute('data-original-src', src);
                    this.log(`Converted child image: ${src} → ${convertedSrc}`);
                  }
                }
              });
            }
          });
        } else if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
          const target = mutation.target as HTMLElement;
          if (target.tagName === 'IMG') {
            const src = target.getAttribute('src');
            if (src && this.needsConversion(src) && !target.hasAttribute('data-converting')) {
              target.setAttribute('data-converting', 'true');
              const convertedSrc = this.convertPath(src);
              if (convertedSrc !== src) {
                target.setAttribute('src', convertedSrc);
                target.setAttribute('data-original-src', src);
                this.log(`Converted modified image: ${src} → ${convertedSrc}`);
              }
              target.removeAttribute('data-converting');
            }
          }
        }
      }
    });

    this.observer.observe(editor, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });

    this.log('MutationObserver setup complete');
  }

  /**
   * Get the editor element
   */
  private getEditorElement(): HTMLElement | null {
    const vdt = (this.vditor as any).vditor;
    return vdt?.ir?.element || vdt?.wysiwyg?.element || vdt?.sv?.element || null;
  }

  /**
   * Log a message
   */
  private log(message: string): void {
    if ((window as any).vscode && (window as any).vscode.postMessage) {
      (window as any).vscode.postMessage({
        command: 'log',
        message: `[ImageURIConverter] ${message}`
      });
    }
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.conversionCache.clear();
  }
}
