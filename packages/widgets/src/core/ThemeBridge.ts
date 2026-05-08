/**
 * ThemeBridge - VSCode theme integration
 * 
 * Injects VSCode theme colors as CSS custom properties for widget styling.
 * Listens for theme changes and updates widget styles automatically.
 */

import type { IWidgetTheme } from './types';

export class ThemeBridge {
  private static instance: ThemeBridge;
  private currentTheme: IWidgetTheme | null = null;
  private observers: Set<(theme: IWidgetTheme) => void> = new Set();
  private styleElement: HTMLStyleElement | null = null;
  
  private constructor() {
    this.initializeStyleElement();
    this.listenForThemeChanges();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): ThemeBridge {
    if (!ThemeBridge.instance) {
      ThemeBridge.instance = new ThemeBridge();
    }
    return ThemeBridge.instance;
  }
  
  /**
   * Initialize style element for CSS variables
   */
  private initializeStyleElement(): void {
    this.styleElement = document.createElement('style');
    this.styleElement.id = 'widget-theme-bridge';
    document.head.appendChild(this.styleElement);
  }
  
  /**
   * Listen for theme changes from VSCode
   */
  private listenForThemeChanges(): void {
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'theme-changed') {
        this.setTheme(message.theme);
      }
    });
    
    // Request initial theme
    this.requestTheme();
  }
  
  /**
   * Request theme from VSCode
   */
  private requestTheme(): void {
    if (window.acquireVsCodeApi) {
      const vscode = window.acquireVsCodeApi();
      vscode.postMessage({ type: 'get-theme' });
    }
  }
  
  /**
   * Set theme and update CSS variables
   */
  setTheme(theme: IWidgetTheme): void {
    this.currentTheme = theme;
    this.updateCSSVariables(theme);
    this.notifyObservers(theme);
    
    console.log('[ThemeBridge] Theme updated:', theme.type);
  }
  
  /**
   * Get current theme
   */
  getTheme(): IWidgetTheme | null {
    return this.currentTheme;
  }
  
  /**
   * Update CSS variables with theme colors
   */
  private updateCSSVariables(theme: IWidgetTheme): void {
    if (!this.styleElement) return;
    
    const cssVars = [
      `:root {`,
      `  /* Widget Theme Type */`,
      `  --widget-theme: ${theme.type};`,
      ``,
      `  /* Primary Colors */`,
      `  --widget-foreground: ${theme.colors.foreground};`,
      `  --widget-background: ${theme.colors.background};`,
      `  --widget-primary: ${theme.colors.primary};`,
      `  --widget-secondary: ${theme.colors.secondary};`,
      `  --widget-accent: ${theme.colors.accent};`,
      ``,
      `  /* State Colors */`,
      `  --widget-success: ${theme.colors.success};`,
      `  --widget-warning: ${theme.colors.warning};`,
      `  --widget-error: ${theme.colors.error};`,
      `  --widget-info: ${theme.colors.info};`,
      ``,
      `  /* UI Element Colors */`,
      `  --widget-border: ${theme.colors.border};`,
      `  --widget-hover: ${theme.colors.hover};`,
      `  --widget-active: ${theme.colors.active};`,
      `  --widget-disabled: ${theme.colors.disabled};`,
      `  --widget-selection: ${theme.colors.selection};`,
      ``,
      `  /* Semantic Colors */`,
      `  --widget-text-primary: ${theme.colors.textPrimary};`,
      `  --widget-text-secondary: ${theme.colors.textSecondary};`,
      `  --widget-text-muted: ${theme.colors.textMuted};`,
      `  --widget-link: ${theme.colors.link};`,
      `  --widget-link-hover: ${theme.colors.linkHover};`,
      ``,
      `  /* Component Colors */`,
      `  --widget-card-bg: ${theme.colors.cardBackground};`,
      `  --widget-input-bg: ${theme.colors.inputBackground};`,
      `  --widget-input-border: ${theme.colors.inputBorder};`,
      `  --widget-button-bg: ${theme.colors.buttonBackground};`,
      `  --widget-button-fg: ${theme.colors.buttonForeground};`,
      `  --widget-button-hover: ${theme.colors.buttonHoverBackground};`,
      ``,
      `  /* Shadow and Overlay */`,
      `  --widget-shadow: ${theme.colors.shadow};`,
      `  --widget-overlay: ${theme.colors.overlay};`,
      `}`,
      ``,
      `/* Widget Container Base Styles */`,
      `.widget-container {`,
      `  color: var(--widget-foreground);`,
      `  background: var(--widget-background);`,
      `  border: 1px solid var(--widget-border);`,
      `  border-radius: 4px;`,
      `  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);`,
      `  font-size: var(--vscode-font-size, 13px);`,
      `}`,
      ``,
      `/* Loading State */`,
      `.widget-loading {`,
      `  opacity: 0.6;`,
      `  pointer-events: none;`,
      `}`,
      ``,
      `/* Error State */`,
      `.widget-error {`,
      `  color: var(--widget-error);`,
      `  background: var(--widget-background);`,
      `  border: 1px solid var(--widget-error);`,
      `  padding: 8px;`,
      `  margin: 4px 0;`,
      `  border-radius: 4px;`,
      `}`,
      ``,
      `/* Link Styles */`,
      `.widget-link {`,
      `  color: var(--widget-link);`,
      `  text-decoration: none;`,
      `}`,
      ``,
      `.widget-link:hover {`,
      `  color: var(--widget-link-hover);`,
      `  text-decoration: underline;`,
      `}`,
      ``,
      `/* Button Styles */`,
      `.widget-button {`,
      `  background: var(--widget-button-bg);`,
      `  color: var(--widget-button-fg);`,
      `  border: 1px solid var(--widget-border);`,
      `  padding: 6px 12px;`,
      `  border-radius: 4px;`,
      `  cursor: pointer;`,
      `  font-size: inherit;`,
      `  font-family: inherit;`,
      `}`,
      ``,
      `.widget-button:hover {`,
      `  background: var(--widget-button-hover);`,
      `}`,
      ``,
      `.widget-button:disabled {`,
      `  opacity: 0.5;`,
      `  cursor: not-allowed;`,
      `}`,
      ``,
      `/* Input Styles */`,
      `.widget-input {`,
      `  background: var(--widget-input-bg);`,
      `  color: var(--widget-foreground);`,
      `  border: 1px solid var(--widget-input-border);`,
      `  padding: 4px 8px;`,
      `  border-radius: 2px;`,
      `  font-size: inherit;`,
      `  font-family: inherit;`,
      `}`,
      ``,
      `.widget-input:focus {`,
      `  outline: 1px solid var(--widget-primary);`,
      `  border-color: var(--widget-primary);`,
      `}`,
      ``,
      `/* Card Styles */`,
      `.widget-card {`,
      `  background: var(--widget-card-bg);`,
      `  border: 1px solid var(--widget-border);`,
      `  border-radius: 4px;`,
      `  padding: 12px;`,
      `  margin: 8px 0;`,
      `}`,
      ``,
      `/* Scrollbar Styles */`,
      `.widget-scrollable::-webkit-scrollbar {`,
      `  width: 10px;`,
      `  height: 10px;`,
      `}`,
      ``,
      `.widget-scrollable::-webkit-scrollbar-track {`,
      `  background: var(--widget-background);`,
      `}`,
      ``,
      `.widget-scrollable::-webkit-scrollbar-thumb {`,
      `  background: var(--widget-border);`,
      `  border-radius: 5px;`,
      `}`,
      ``,
      `.widget-scrollable::-webkit-scrollbar-thumb:hover {`,
      `  background: var(--widget-hover);`,
      `}`
    ].join('\n');
    
    this.styleElement.textContent = cssVars;
  }
  
  /**
   * Add theme observer
   */
  observe(callback: (theme: IWidgetTheme) => void): () => void {
    this.observers.add(callback);
    
    // Call immediately with current theme if available
    if (this.currentTheme) {
      callback(this.currentTheme);
    }
    
    // Return unsubscribe function
    return () => {
      this.observers.delete(callback);
    };
  }
  
  /**
   * Notify observers of theme change
   */
  private notifyObservers(theme: IWidgetTheme): void {
    this.observers.forEach(callback => {
      try {
        callback(theme);
      } catch (error) {
        console.error('[ThemeBridge] Error in observer:', error);
      }
    });
  }
  
  /**
   * Get CSS variable value
   */
  getCSSVariable(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(`--widget-${name}`).trim();
  }
  
  /**
   * Set custom CSS variable
   */
  setCSSVariable(name: string, value: string): void {
    document.documentElement.style.setProperty(`--widget-${name}`, value);
  }
  
  /**
   * Check if theme is dark
   */
  isDark(): boolean {
    return this.currentTheme?.type === 'dark' || this.currentTheme?.type === 'high-contrast-dark';
  }
  
  /**
   * Check if theme is light
   */
  isLight(): boolean {
    return this.currentTheme?.type === 'light' || this.currentTheme?.type === 'high-contrast-light';
  }
  
  /**
   * Get computed color for a semantic name
   */
  getColor(colorName: keyof IWidgetTheme['colors']): string {
    return this.currentTheme?.colors[colorName] || '';
  }
  
  /**
   * Cleanup
   */
  destroy(): void {
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
    this.observers.clear();
    this.currentTheme = null;
  }
}
