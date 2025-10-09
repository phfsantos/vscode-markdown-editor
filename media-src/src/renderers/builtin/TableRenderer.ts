import { BaseRenderer } from '../BaseRenderer';
import { IRenderer, IRenderContext, IRendererCapabilities } from '../types';

/**
 * TableRenderer - Interactive spreadsheet-like table editing with JSON persistence
 * 
 * Features:
 * - Editable cells with inline editing
 * - Add/remove rows and columns
 * - JSON file persistence
 * - CSV import/export support
 * - Cell formatting (text, number, date)
 * - Sorting and filtering
 * 
 * Usage:
 * ```table
 * <!-- file: assets/my-data.table.json -->
 * ```
 * 
 * Or with instance ID:
 * ```table
 * <!-- table: sales-data -->
 * ```
 */
export class TableRenderer extends BaseRenderer implements IRenderer {
  readonly id = 'table-renderer';
  readonly name = 'Interactive Table';
  readonly language = 'table';
  readonly version = '1.0.0';
  readonly description = 'Spreadsheet-like interactive tables with persistence';
  readonly author = 'VSCode Markdown Editor';
  
  readonly capabilities: IRendererCapabilities = {
    supportsPersistence: true,
    supportsMultipleInstances: true,
    supportsExport: true,
    supportsImport: true,
    requiresExtensionHost: true
  };

  private tableInstances: Map<string, HTMLElement> = new Map();

  /**
   * Extract table-specific ID from code block
   * Overrides BaseRenderer.extractId() to implement table-specific logic
   * 
   * Looks for: <!-- table: table-1 --> or <!-- table: my-table-name -->
   * Generates: table-1, table-2, table-3, etc. based on position
   */
  extractId(element: HTMLElement): string {
    const textContent = element.textContent || '';
    
    // Look for explicit table ID in comment
    // Match pattern: <!-- table: table-3 --> or <!-- table: my-table-name -->
    const tableIdMatch = textContent.match(/<!--\s*table:\s*([^\s>]+)\s*-->/);
    if (tableIdMatch) {
      return tableIdMatch[1];
    }
    
    // Generate table ID from position in document
    const allBlocks = Array.from(document.querySelectorAll('code.language-table'));
    const currentIndex = allBlocks.indexOf(element);
    
    if (currentIndex > 0) {
      return `table-${currentIndex + 1}`;
    }
    
    return 'default';
  }

  /**
   * Render the interactive table
   */
  async render(element: HTMLElement, vditor: any, context: IRenderContext): Promise<void> {
    try {
      // Use boardId from context (already calculated by init.ts)
      const tableId = context.boardId || 'default';
      const instanceKey = `${context.documentUri}-${tableId}`;

      // Show loading state
      this.showLoading(element, 'Loading table data...');

      // Load table data
      const tableData = await this.loadTableData(tableId, context);

      // Ensure data has proper structure
      if (!tableData || !tableData.columns || !tableData.rows) {
        const defaultData = this.createDefaultTableData();
        await context.fileSystemHelper.saveRendererData(this.id, tableId, defaultData);
        // Don't re-render, just use default data
        return this.renderWithData(element, tableId, defaultData, context);
      }

      return this.renderWithData(element, tableId, tableData, context);
    } catch (error) {
      console.error('❌ TABLE RENDERER: Render failed', error);
      this.showError(element, `Failed to render table: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Render table with data
   */
  private async renderWithData(element: HTMLElement, tableId: string, tableData: any, context: IRenderContext): Promise<void> {
    const instanceKey = `${context.documentUri}-${tableId}`;

    // Get container node for event listeners
    const ir__node = element.closest('.vditor-ir__node') as HTMLElement;
    const wysiwyg__node = element.closest('.vditor-wysiwyg__block') as HTMLElement;
    const containerNode = ir__node || wysiwyg__node;

    // CRITICAL: Make the code element non-editable to prevent Vditor from processing it
    // But we'll make the table cells editable separately
    if (element.hasAttribute('contenteditable')) {
      element.setAttribute('contenteditable', 'false');
    }

    // Create table container
    const container = this.createTableContainer(tableId, tableData, context);
    
    // Replace content with actual table
    element.innerHTML = '';
    element.appendChild(container);

    // Store instance reference
    this.tableInstances.set(instanceKey, container);

    // CRITICAL: Setup table event listeners on container FIRST
    // These must be registered before event stoppers so they fire first in capture phase
    this.setupTableEventListeners(container, tableId, context);

    // THEN setup event stoppers on containerNode
    // These will fire AFTER container's listeners and prevent Vditor from capturing events
    if (containerNode) {
      this.setupVditorEventStoppers(container, containerNode);
    }

    // REMOVE OLD EVENT STOPPER CODE BELOW
    if (false && containerNode) {
      this.setupVditorEventStoppers(container, containerNode);
    }

    // Show file info
    const filename = await this.getTableFilename(tableId, context);
    this.showFileInfo(element, filename, tableId);
  }

  /**
   * Load table data from file or create default (using messageHandler like KanbanRenderer)
   */
  private async loadTableData(tableId: string, context: IRenderContext): Promise<any> {
    const requestId = Math.random().toString(36).substring(2, 15);
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(this.createDefaultTableData());
      }, 5000);

      // Listen for response
      const removeListener = context.messageHandler.on('renderer-data-loaded', (message: any) => {
        if (message.requestId === requestId) {
          clearTimeout(timeout);
          removeListener();
          
          if (message.error) {
            resolve(this.createDefaultTableData());
          } else {
            resolve(message.data);
          }
        }
      });

      // Request data from extension host
      context.messageHandler.send('renderer-load-data', {
        requestId,
        rendererId: this.id,
        boardId: tableId
      });
    });
  }

  /**
   * Create default table structure
   */
  private createDefaultTableData(): any {
    return {
      columns: [
        { id: 'col1', name: 'Column 1', type: 'text' },
        { id: 'col2', name: 'Column 2', type: 'text' },
        { id: 'col3', name: 'Column 3', type: 'text' }
      ],
      rows: [
        { id: 'row1', cells: { col1: 'Row 1, Cell 1', col2: 'Row 1, Cell 2', col3: 'Row 1, Cell 3' } },
        { id: 'row2', cells: { col1: 'Row 2, Cell 1', col2: 'Row 2, Cell 2', col3: 'Row 2, Cell 3' } }
      ],
      metadata: {
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      }
    };
  }

  /**
   * Create table HTML structure
   */
  private createTableContainer(tableId: string, data: any, context: IRenderContext): HTMLElement {
    const container = document.createElement('div');
    container.className = 'interactive-table-container table-renderer-container';
    container.setAttribute('data-table-id', tableId);
    container.setAttribute('contenteditable', 'false'); // CRITICAL: Prevent Vditor from editing table

    // Create toolbar
    const toolbar = this.createTableToolbar(tableId, context);
    container.appendChild(toolbar);

    // Create table element
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-wrapper';
    
    const table = document.createElement('table');
    table.className = 'interactive-table';
    
    // Create header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    data.columns.forEach((col: any) => {
      const th = document.createElement('th');
      th.textContent = col.name;
      th.setAttribute('data-col-id', col.id);
      th.contentEditable = 'true';
      headerRow.appendChild(th);
    });
    
    // Add action column
    const actionTh = document.createElement('th');
    actionTh.textContent = 'Actions';
    actionTh.className = 'action-column';
    headerRow.appendChild(actionTh);
    
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create body
    const tbody = document.createElement('tbody');
    
    data.rows.forEach((row: any) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-row-id', row.id);
      
      data.columns.forEach((col: any) => {
        const td = document.createElement('td');
        td.textContent = row.cells[col.id] || '';
        td.setAttribute('data-col-id', col.id);
        td.contentEditable = 'true';
        tr.appendChild(td);
      });
      
      // Add delete button
      const actionTd = document.createElement('td');
      actionTd.className = 'action-column';
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '🗑️';
      deleteBtn.className = 'table-delete-row-btn';
      deleteBtn.title = 'Delete row';
      actionTd.appendChild(deleteBtn);
      tr.appendChild(actionTd);
      
      tbody.appendChild(tr);
    });
    
    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);

    // Add styles
    this.injectTableStyles();

    return container;
  }

  /**
   * Create table toolbar with action buttons
   */
  private createTableToolbar(tableId: string, context: IRenderContext): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';

    const buttons = [
      { text: '➕ Row', action: 'add-row', title: 'Add new row' },
      { text: '➕ Column', action: 'add-column', title: 'Add new column' },
      { text: '➖ Column', action: 'delete-column', title: 'Delete a column' },
      { text: '📥 Import CSV', action: 'import-csv', title: 'Import from CSV' },
      { text: '📤 Export CSV', action: 'export-csv', title: 'Export to CSV' },
      { text: '💾 Save', action: 'save', title: 'Save table data' }
    ];

    buttons.forEach(btn => {
      const button = document.createElement('button');
      button.type = 'button'; // Prevent form submission
      button.textContent = btn.text;
      button.className = 'table-toolbar-btn';
      button.setAttribute('data-action', btn.action);
      button.title = btn.title;
      toolbar.appendChild(button);
    });

    return toolbar;
  }

  /**
   * Setup event listeners to stop Vditor from interfering with table
   * CRITICAL: Use BUBBLE phase (false) so container's bubble listeners fire FIRST
   * Event flow: Capture (nothing) → Target → Bubble (container handles) → Bubble (parent blocks)
   */
  private setupVditorEventStoppers(container: HTMLElement, node: HTMLElement): void {
    if (!node) return;

    // Backup blocker - fires in BUBBLE phase AFTER container handles events
    const backupBlocker = (e: Event) => {
      if (container.contains(e.target as Node)) {

        e.stopPropagation(); // Stop from reaching Vditor
      }
    };

    // Block table events from reaching Vditor in BUBBLE phase
    const events = [
      'click', 'mousedown', 'mouseup',
      'keydown', 'keypress', 'keyup',
      'beforeinput', 'input'
    ];

    // CRITICAL: Use bubble phase (false) so container's listeners fire FIRST
    events.forEach(eventName => {
      node.addEventListener(eventName, backupBlocker, false); // BUBBLE PHASE!
    });
  }  /**
   * Setup event listeners for table interactions using event delegation
   */
  private setupTableEventListeners(container: HTMLElement, tableId: string, context: IRenderContext): void {
    
    let autoSaveTimeout: any = null;
    
    // Debounced auto-save function
    const debouncedSave = () => {
      if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(() => {
        this.saveTableData(container, tableId, context);
      }, 500); // Wait 500ms after last edit
    };
    
    // Use event delegation for all clicks (handles dynamic elements)
    // CRITICAL: Use BUBBLE phase (not capture) since parent's backup blocker uses capture
    // Event flow: Capture (parent does nothing) → Target (container handles) → Bubble (parent blocks)
    container.addEventListener('click', (e) => {
      e.stopPropagation(); // Stop immediately - don't let this reach Vditor
      e.preventDefault(); // Prevent default behavior
      
      const target = e.target as HTMLElement;
      
      // Toolbar button clicks - use closest() to handle clicks on button content
      const toolbarBtn = target.closest('.table-toolbar-btn') as HTMLElement;
      if (toolbarBtn) {
        const action = toolbarBtn.getAttribute('data-action');
        if (action) {
          this.handleToolbarAction(action, container, tableId, context);
        }
        return;
      }
      
      // Row delete buttons - use closest() to handle clicks on emoji text
      const deleteBtn = target.closest('.table-delete-row-btn') as HTMLElement;
      if (deleteBtn) {
        const row = deleteBtn.closest('tr');
        if (row) {
          this.showConfirmDialog('Delete this row?').then(confirmed => {
            if (confirmed) {
              row.remove();
              this.saveTableData(container, tableId, context);
            }
          });
        }
        return;
      }
      
      // Cell clicks - allow focus but don't propagate
      if (target.tagName === 'TD' || target.tagName === 'TH') {
        // Don't return - let cell handle click for cursor positioning
      }
    }, false); // Use BUBBLE phase - critical for child handlers!
    
    // DEBUG: Add mousedown listener to see if clicks are being captured at all
    container.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
    }, false); // Use BUBBLE phase
    
    // Cell editing - debounced auto-save on input
    // CRITICAL: Use bubble phase so parent's capture blocker doesn't prevent this
    container.addEventListener('input', (e) => {
      e.stopPropagation(); // Prevent Vditor from seeing input
      const target = e.target as HTMLElement;
      if (target.contentEditable === 'true') {
        debouncedSave();
      }
    }, false); // Use BUBBLE phase    // Prevent keydown events from reaching Vditor
    // CRITICAL: Use bubble phase so parent's capture blocker doesn't prevent this
    container.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Critical: stop Vditor from seeing this
    }, false); // Use BUBBLE phase
    
    // Also save on blur for immediate save when leaving a cell
    container.addEventListener('blur', (e) => {
      e.stopPropagation(); // Prevent from reaching Vditor
      const target = e.target as HTMLElement;
      if (target.contentEditable === 'true') {
        if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
        this.saveTableData(container, tableId, context);
      }
    }, false); // Use BUBBLE phase
  }

  /**
   * Handle toolbar actions
   */
  private async handleToolbarAction(action: string, container: HTMLElement, tableId: string, context: IRenderContext): Promise<void> {
    const table = container.querySelector('.interactive-table') as HTMLTableElement;
    
    switch (action) {
      case 'add-row':
        this.addRow(table);
        this.saveTableData(container, tableId, context);
        break;
        
      case 'add-column':
        await this.addColumn(table);
        this.saveTableData(container, tableId, context);
        break;
        
      case 'delete-column':
        await this.deleteColumn(table, container);
        this.saveTableData(container, tableId, context);
        break;
        
      case 'import-csv':
        await this.importCSV(container, tableId, context);
        break;
        
      case 'export-csv':
        this.exportCSV(table, tableId);
        break;
        
      case 'save':
        await this.saveTableData(container, tableId, context);
        this.showToast(container, '✅ Table saved successfully');
        break;
    }
  }

  /**
   * Add new row to table
   */
  private addRow(table: HTMLTableElement): void {
    const tbody = table.querySelector('tbody')!;
    const headerCells = table.querySelectorAll('thead th');
    const columnCount = headerCells.length - 1; // Exclude action column
    
    const tr = document.createElement('tr');
    tr.setAttribute('data-row-id', `row-${Date.now()}`);
    
    for (let i = 0; i < columnCount; i++) {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.textContent = '';
      const colId = headerCells[i].getAttribute('data-col-id') || `col${i + 1}`;
      td.setAttribute('data-col-id', colId);
      tr.appendChild(td);
    }
    
    // Add delete button (handler attached via event delegation)
    const actionTd = document.createElement('td');
    actionTd.className = 'action-column';
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.className = 'table-delete-row-btn';
    deleteBtn.title = 'Delete row';
    actionTd.appendChild(deleteBtn);
    tr.appendChild(actionTd);
    
    tbody.appendChild(tr);
  }

  /**
   * Add new column to table
   */
  private async addColumn(table: HTMLTableElement): Promise<void> {
    const colName = await this.showPromptDialog('Column name:', 'New Column');
    if (!colName) return;
    
    const colId = `col-${Date.now()}`;
    
    // Add to header
    const headerRow = table.querySelector('thead tr')!;
    const actionTh = headerRow.querySelector('.action-column')!;
    const th = document.createElement('th');
    th.textContent = colName;
    th.setAttribute('data-col-id', colId);
    th.contentEditable = 'true';
    headerRow.insertBefore(th, actionTh);
    
    // Add to all rows
    table.querySelectorAll('tbody tr').forEach(row => {
      const actionTd = row.querySelector('.action-column')!;
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.textContent = '';
      td.setAttribute('data-col-id', colId);
      row.insertBefore(td, actionTd);
    });
  }

  /**
   * Delete a column from table
   */
  private async deleteColumn(table: HTMLTableElement, container: HTMLElement): Promise<void> {
    const headers = Array.from(table.querySelectorAll('thead th:not(.action-column)'));
    
    if (headers.length === 0) {
      this.showToast(container, '❌ No columns to delete', 'error');
      return;
    }
    
    if (headers.length === 1) {
      this.showToast(container, '❌ Cannot delete the last column', 'error');
      return;
    }
    
    // Create column selection dialog
    const columnNames = headers.map((th, index) => {
      const colId = th.getAttribute('data-col-id');
      const colName = th.textContent?.trim() || `Column ${index + 1}`;
      return { colId, colName, element: th };
    });
    
    const columnIndex = await this.showColumnSelector(columnNames.map(c => c.colName));
    
    if (columnIndex === -1) return; // User cancelled
    
    const selectedColumn = columnNames[columnIndex];
    const colId = selectedColumn.colId;
    
    // Confirm deletion
    const confirmed = await this.showConfirmDialog(`Delete column "${selectedColumn.colName}"?`);
    if (!confirmed) return;
    
    // Remove header
    selectedColumn.element.remove();
    
    // Remove cells from all rows
    table.querySelectorAll(`tbody td[data-col-id="${colId}"]`).forEach(td => td.remove());
    
    this.showToast(container, `✅ Column "${selectedColumn.colName}" deleted`);
  }

  /**
   * Show column selector dialog
   */
  private async showColumnSelector(columnNames: string[]): Promise<number> {
    const message = 'Select column to delete (enter number):\n\n' + 
      columnNames.map((name, i) => `${i + 1}. ${name}`).join('\n');
    
    const input = await this.showPromptDialog(message, '1');
    
    if (!input) return -1; // User cancelled
    
    const index = parseInt(input) - 1;
    
    if (isNaN(index) || index < 0 || index >= columnNames.length) {
      await this.showAlertDialog('Invalid column number');
      return -1;
    }
    
    return index;
  }

  /**
   * Save table data to JSON file (using messageHandler like KanbanRenderer)
   */
  private async saveTableData(container: HTMLElement, tableId: string, context: IRenderContext): Promise<void> {
    try {
      const table = container.querySelector('.interactive-table') as HTMLTableElement;
      const data = this.extractTableData(table);
      
      // Send save message to extension host (like KanbanRenderer)
      context.messageHandler.send('renderer-save-data', {
        rendererId: this.id,
        boardId: tableId,
        data: data
      });
      
    } catch (error) {
      console.error('❌ TABLE RENDERER: Save failed', error);
      this.showToast(container, `❌ Save failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  /**
   * Extract table data from DOM
   */
  private extractTableData(table: HTMLTableElement): any {
    const columns: any[] = [];
    const rows: any[] = [];
    
    // Extract columns
    table.querySelectorAll('thead th').forEach((th, index) => {
      if (!th.classList.contains('action-column')) {
        columns.push({
          id: th.getAttribute('data-col-id') || `col${index + 1}`,
          name: th.textContent?.trim() || `Column ${index + 1}`,
          type: 'text'
        });
      }
    });
    
    // Extract rows
    table.querySelectorAll('tbody tr').forEach(tr => {
      const rowId = tr.getAttribute('data-row-id') || `row-${Date.now()}`;
      const cells: any = {};
      
      tr.querySelectorAll('td:not(.action-column)').forEach(td => {
        const colId = td.getAttribute('data-col-id')!;
        cells[colId] = td.textContent?.trim() || '';
      });
      
      rows.push({ id: rowId, cells });
    });
    
    return {
      columns,
      rows,
      metadata: {
        modified: new Date().toISOString()
      }
    };
  }

  /**
   * Import CSV data
   */
  private async importCSV(container: HTMLElement, tableId: string, context: IRenderContext): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) return;
      
      // Parse CSV (simple implementation)
      const headers = lines[0].split(',').map(h => h.trim());
      const dataRows = lines.slice(1).map(line => line.split(',').map(c => c.trim()));
      
      const tableData = {
        columns: headers.map((name, i) => ({ id: `col${i + 1}`, name, type: 'text' })),
        rows: dataRows.map((cells, i) => ({
          id: `row${i + 1}`,
          cells: Object.fromEntries(headers.map((_, j) => [`col${j + 1}`, cells[j] || '']))
        })),
        metadata: {
          imported: new Date().toISOString(),
          source: file.name
        }
      };
      
      await context.fileSystemHelper.saveRendererData(this.id, tableId, tableData);
      
      // Re-render table
      const newContainer = this.createTableContainer(tableId, tableData, context);
      container.replaceWith(newContainer);
      this.setupTableEventListeners(newContainer, tableId, context);
      this.showFileInfo(newContainer.parentElement!, await this.getTableFilename(tableId, context), tableId);
      this.showToast(newContainer, '✅ CSV imported successfully');
    };
    
    input.click();
  }

  /**
   * Export table to CSV
   */
  private exportCSV(table: HTMLTableElement, tableId: string): void {
    const rows: string[] = [];
    
    // Header row
    const headers: string[] = [];
    table.querySelectorAll('thead th:not(.action-column)').forEach(th => {
      headers.push(`"${th.textContent?.trim()}"`);
    });
    rows.push(headers.join(','));
    
    // Data rows
    table.querySelectorAll('tbody tr').forEach(tr => {
      const cells: string[] = [];
      tr.querySelectorAll('td:not(.action-column)').forEach(td => {
        cells.push(`"${td.textContent?.trim()}"`);
      });
      rows.push(cells.join(','));
    });
    
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableId}.csv`;
    a.click();
    
    URL.revokeObjectURL(url);
  }

  /**
   * Get table filename
   */
  private async getTableFilename(tableId: string, context: IRenderContext): Promise<string> {
    const docName = context.documentUri.split('/').pop()?.replace('.md', '') || 'document';
    return `${docName}.${this.id}.${tableId}.json`;
  }

  /**
   * Show file info banner and update code block with comments
   */
  private showFileInfo(element: HTMLElement, filename: string, tableId: string): void {
    const codeContainer = element.closest('.vditor-ir__node') || 
                          element.closest('.vditor-wysiwyg__block');
    if (!codeContainer) return;

    // Update code block with filename comment if not present (matching KanbanRenderer)
    const codeBlock = codeContainer.querySelector('code.language-table') as HTMLElement;
    if (codeBlock && codeBlock.textContent) {
      const currentContent = codeBlock.textContent;
      if (!currentContent.includes(`<!-- file: ${filename} -->`)) {
        const filenameComment = `<!-- file: ${filename} -->`;
        const tableComment = tableId !== 'default' ? `\n<!-- table: ${tableId} -->` : '';
        
        // Only add if no existing metadata
        if (!currentContent.includes('<!-- file:') && !currentContent.includes('<!-- table:')) {
          codeBlock.textContent = `${filenameComment}${tableComment}\n${currentContent}`;
        }
      }
    }

    // Create or update file info display banner
    let banner = element.querySelector('.table-file-info') as HTMLElement;
    
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'table-file-info';
      banner.style.cssText = `
        background: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        border: 1px solid var(--vscode-panel-border, #3a3d41);
        border-radius: 4px;
        padding: 8px 12px;
        margin: 10px 0;
        font-size: 12px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
      `;
      
      // Insert before table container
      const tableContainer = element.querySelector('.interactive-table-container');
      if (tableContainer && tableContainer.parentNode) {
        tableContainer.parentNode.insertBefore(banner, tableContainer);
      } else {
        element.insertBefore(banner, element.firstChild);
      }
    }
    
    const tableLabel = tableId === 'default' ? 'Default Table' : `Table: ${tableId}`;
    banner.innerHTML = `
      <div style="margin-bottom: 4px;">
        <strong>📊 ${tableLabel}</strong> → <code>assets/${filename}</code>
      </div>
      <div style="font-size: 11px; opacity: 0.7;">
        ℹ️ Changes are auto-saved to JSON file • Edit cells inline • Use toolbar for structure changes
      </div>
    `;
  }

  /**
   * Show toast notification
   */
  private showToast(container: HTMLElement, message: string, type: 'success' | 'error' = 'success'): void {
    const toast = document.createElement('div');
    toast.className = `table-toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
  }

  /**
   * Show custom confirm dialog
   */
  private showConfirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = this.createDialog('confirm', message, [
        { text: 'Cancel', value: false, className: 'dialog-btn-secondary' },
        { text: 'Confirm', value: true, className: 'dialog-btn-primary' }
      ], resolve);
      document.body.appendChild(dialog);
    });
  }

  /**
   * Show custom prompt dialog
   */
  private showPromptDialog(message: string, defaultValue: string = ''): Promise<string | null> {
    return new Promise((resolve) => {
      const dialog = this.createDialog('prompt', message, [
        { text: 'Cancel', value: null, className: 'dialog-btn-secondary' },
        { text: 'OK', value: 'INPUT_VALUE', className: 'dialog-btn-primary' }
      ], resolve, defaultValue);
      document.body.appendChild(dialog);
    });
  }

  /**
   * Show custom alert dialog
   */
  private showAlertDialog(message: string): Promise<void> {
    return new Promise((resolve) => {
      const dialog = this.createDialog('alert', message, [
        { text: 'OK', value: true, className: 'dialog-btn-primary' }
      ], () => resolve());
      document.body.appendChild(dialog);
    });
  }

  /**
   * Create custom dialog element
   */
  private createDialog(
    type: 'confirm' | 'prompt' | 'alert',
    message: string,
    buttons: Array<{ text: string; value: any; className: string }>,
    resolve: (value: any) => void,
    defaultValue: string = ''
  ): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'table-dialog-overlay';
    
    const dialog = document.createElement('div');
    dialog.className = 'table-dialog';
    
    const messageEl = document.createElement('div');
    messageEl.className = 'table-dialog-message';
    messageEl.textContent = message;
    messageEl.style.whiteSpace = 'pre-wrap';
    dialog.appendChild(messageEl);
    
    let inputEl: HTMLInputElement | null = null;
    if (type === 'prompt') {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'table-dialog-input';
      inputEl.value = defaultValue;
      dialog.appendChild(inputEl);
      setTimeout(() => inputEl?.focus(), 100);
    }
    
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'table-dialog-buttons';
    
    buttons.forEach(btn => {
      const button = document.createElement('button');
      button.textContent = btn.text;
      button.className = `table-dialog-btn ${btn.className}`;
      button.onclick = () => {
        const value = btn.value === 'INPUT_VALUE' ? (inputEl?.value || null) : btn.value;
        overlay.remove();
        resolve(value);
      };
      buttonsContainer.appendChild(button);
    });
    
    dialog.appendChild(buttonsContainer);
    overlay.appendChild(dialog);
    
    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(type === 'prompt' ? null : false);
      }
    };
    
    // Handle Enter key for prompt
    if (type === 'prompt' && inputEl) {
      inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') {
          overlay.remove();
          resolve(inputEl!.value || null);
        } else if (e.key === 'Escape') {
          overlay.remove();
          resolve(null);
        }
      };
    }
    
    return overlay;
  }

  /**
   * Inject table styles
   */
  private injectTableStyles(): void {
    if (document.getElementById('table-renderer-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'table-renderer-styles';
    style.textContent = `
      .interactive-table-container {
        margin: 10px 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      .table-file-info {
        background: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        border: 1px solid var(--vscode-panel-border, #3a3d41);
        border-radius: 4px;
        padding: 8px 12px;
        margin-bottom: 10px;
        font-size: 12px;
      }
      
      .table-toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      
      .table-toolbar-btn {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      
      .table-toolbar-btn:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
      }
      
      .table-wrapper {
        overflow-x: auto;
        border: 1px solid var(--vscode-panel-border, #3a3d41);
        border-radius: 4px;
      }
      
      .interactive-table {
        width: 100%;
        border-collapse: collapse;
        background: var(--vscode-editor-background, #1e1e1e);
      }
      
      .interactive-table th,
      .interactive-table td {
        border: 1px solid var(--vscode-panel-border, #3a3d41);
        padding: 8px 12px;
        text-align: left;
        min-width: 100px;
      }
      
      .interactive-table th {
        background: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        font-weight: 600;
        position: sticky;
        top: 0;
        z-index: 1;
      }
      
      .interactive-table td:focus,
      .interactive-table th:focus {
        outline: 2px solid var(--vscode-focusBorder, #007acc);
        outline-offset: -2px;
      }
      
      .interactive-table .action-column {
        min-width: 80px;
        text-align: center;
      }
      
      .table-delete-row-btn {
        background: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        color: var(--vscode-editor-background, #1e1e1e);
        border: none;
        padding: 4px 8px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 14px;
      }
      
      .table-delete-row-btn:hover {
        opacity: 0.8;
      }
      
      .table-toast {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 4px;
        font-size: 14px;
        z-index: 1000;
        animation: slideIn 0.3s ease-out;
      }
      
      .toast-success {
        background: var(--vscode-editorInfo-background, #007acc);
        color: var(--vscode-editorInfo-foreground, #fff);
      }
      
      .toast-error {
        background: var(--vscode-errorForeground, #f48771);
        color: var(--vscode-editor-background, #1e1e1e);
      }
      
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      /* Custom Dialog Styles */
      .table-dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }
      
      .table-dialog {
        background: var(--vscode-editor-background, #1e1e1e);
        border: 1px solid var(--vscode-panel-border, #3a3d41);
        border-radius: 6px;
        padding: 20px;
        min-width: 300px;
        max-width: 500px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
      
      .table-dialog-message {
        color: var(--vscode-foreground, #cccccc);
        margin-bottom: 16px;
        font-size: 14px;
        line-height: 1.5;
      }
      
      .table-dialog-input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--vscode-input-border, #3a3d41);
        background: var(--vscode-input-background, #3c3c3c);
        color: var(--vscode-input-foreground, #cccccc);
        border-radius: 4px;
        font-size: 14px;
        margin-bottom: 16px;
        box-sizing: border-box;
      }
      
      .table-dialog-input:focus {
        outline: 1px solid var(--vscode-focusBorder, #007acc);
        outline-offset: -1px;
      }
      
      .table-dialog-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      
      .table-dialog-btn {
        padding: 6px 16px;
        border: none;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.2s;
      }
      
      .dialog-btn-primary {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
      }
      
      .dialog-btn-primary:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
      }
      
      .dialog-btn-secondary {
        background: var(--vscode-button-secondaryBackground, #3a3d41);
        color: var(--vscode-button-secondaryForeground, #cccccc);
      }
      
      .dialog-btn-secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground, #45494e);
      }
    `;
    
    document.head.appendChild(style);
  }

  /**
   * Cleanup on destroy
   */
  async onDestroy(context: IRenderContext): Promise<void> {
    const instanceKey = `${context.documentUri}-${context.instanceId}`;
    this.tableInstances.delete(instanceKey);

  }
}
