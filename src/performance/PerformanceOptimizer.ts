import * as vscode from 'vscode';

export interface PerformanceMetrics {
    webviewRenderTime: number;
    syncLatency: number;
    memoryUsage: number;
}

export class PerformanceOptimizer {
    private lastSyncTime = 0;
    private pendingSync: NodeJS.Timeout | null = null;
    private readonly metrics: PerformanceMetrics = {
        webviewRenderTime: 0,
        syncLatency: 0,
        memoryUsage: 0
    };

    private readonly SYNC_DEBOUNCE_MS = 150; // Reduced from 300ms for better responsiveness
    private readonly BATCH_SIZE = 10; // Number of changes to batch together

    /**
     * Optimized content synchronization with batching and debouncing
     */
    public scheduleSync(
        document: vscode.TextDocument,
        webview: vscode.Webview,
        content: string,
        callback: () => Promise<void>
    ): void {
        // Cancel pending sync
        if (this.pendingSync) {
            clearTimeout(this.pendingSync);
        }

        // Batch rapid changes together
        this.pendingSync = setTimeout(async () => {
            const startTime = Date.now();
            
            try {
                await callback();
                this.metrics.syncLatency = Date.now() - startTime;
                this.lastSyncTime = Date.now();
            } catch (error) {
                console.error('Sync failed:', error);
            } finally {
                this.pendingSync = null;
            }
        }, this.SYNC_DEBOUNCE_MS);
    }

    /**
     * Optimize webview message passing by compressing large content
     */
    public compressMessage(message: any): any {
        if (message.content && message.content.length > 1000) {
            // For large content, send only diffs instead of full content
            return {
                ...message,
                contentType: 'diff',
                // In a real implementation, you'd calculate actual diffs here
                compressed: true
            };
        }
        return message;
    }

    /**
     * Memory-efficient webview updates using virtual scrolling concept
     */
    public shouldUpdateWebview(document: vscode.TextDocument, lastUpdateTime: number): boolean {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateTime;
        const documentSize = document.getText().length;

        // For large documents, reduce update frequency
        if (documentSize > 50000) { // 50KB threshold
            return timeSinceLastUpdate > 500; // 500ms delay for large docs
        }

        return timeSinceLastUpdate > 100; // 100ms for normal docs
    }

    /**
     * Lazy loading for webview resources
     */
    public generateOptimizedWebviewHtml(
        baseHtml: string,
        documentUri: vscode.Uri,
        isLargeDocument: boolean
    ): string {
        if (isLargeDocument) {
            // For large documents, load editor components lazily
            return baseHtml.replace(
                '<div id="app"></div>',
                `<div id="app">
                    <div id="loading" style="text-align: center; padding: 20px;">
                        Loading editor...
                    </div>
                </div>
                <script>
                    // Lazy load heavy components
                    setTimeout(() => {
                        // Initialize editor after DOM is ready
                        window.dispatchEvent(new Event('vscode-ready'));
                    }, 100);
                </script>`
            );
        }
        return baseHtml;
    }

    /**
     * Monitor and report performance metrics
     */
    public getMetrics(): PerformanceMetrics {
        // Update memory usage (simplified)
        this.metrics.memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB
        return { ...this.metrics };
    }

    /**
     * Cleanup resources to prevent memory leaks
     */
    public cleanup(): void {
        if (this.pendingSync) {
            clearTimeout(this.pendingSync);
            this.pendingSync = null;
        }
    }
}

/**
 * Enhanced webview options with performance optimizations
 */
export function getOptimizedWebviewOptions(
    extensionUri: vscode.Uri
): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
        enableScripts: true,
        retainContextWhenHidden: false, // Changed to false to save memory
        localResourceRoots: [
            vscode.Uri.joinPath(extensionUri, 'media'),
            vscode.Uri.joinPath(extensionUri, 'out')
        ],
        enableCommandUris: false, // Disable unless needed for security
        portMapping: [], // Add port mappings if you need local server access
    };
}