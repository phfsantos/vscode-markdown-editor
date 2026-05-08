import { IWidgetTheme } from './types';

export declare class ThemeBridge {
    private static instance;
    private currentTheme;
    private observers;
    private styleElement;
    private constructor();
    /**
     * Get singleton instance
     */
    static getInstance(): ThemeBridge;
    /**
     * Initialize style element for CSS variables
     */
    private initializeStyleElement;
    /**
     * Listen for theme changes from VSCode
     */
    private listenForThemeChanges;
    /**
     * Request theme from VSCode
     */
    private requestTheme;
    /**
     * Set theme and update CSS variables
     */
    setTheme(theme: IWidgetTheme): void;
    /**
     * Get current theme
     */
    getTheme(): IWidgetTheme | null;
    /**
     * Update CSS variables with theme colors
     */
    private updateCSSVariables;
    /**
     * Add theme observer
     */
    observe(callback: (theme: IWidgetTheme) => void): () => void;
    /**
     * Notify observers of theme change
     */
    private notifyObservers;
    /**
     * Get CSS variable value
     */
    getCSSVariable(name: string): string;
    /**
     * Set custom CSS variable
     */
    setCSSVariable(name: string, value: string): void;
    /**
     * Check if theme is dark
     */
    isDark(): boolean;
    /**
     * Check if theme is light
     */
    isLight(): boolean;
    /**
     * Get computed color for a semantic name
     */
    getColor(colorName: keyof IWidgetTheme['colors']): string;
    /**
     * Cleanup
     */
    destroy(): void;
}
//# sourceMappingURL=ThemeBridge.d.ts.map