/**
 * Mini graph visualization component for sidebar
 * Renders an SVG-based force-directed layout of linked markdown files
 */

export interface GraphNode {
  id: string;
  label: string;
  path?: string; // Optional file path for navigation
  isFocus?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphViewOptions {
  width: number;
  height: number;
  nodeRadius: number;
  showLabels: boolean;
  repulsionStrength?: number; // Force between unconnected nodes
  attractionStrength?: number; // Force along edges
  centerGravity?: number; // Pull toward center
  iterations?: number; // Simulation iterations
}

export interface ZoomState {
  scale: number;        // Current zoom level (0.1 to 3.0)
  translateX: number;   // Pan X offset
  translateY: number;   // Pan Y offset
}

/**
 * Simple force-directed graph layout calculator
 */
class ForceLayout {
  private nodes: Map<string, { x: number; y: number; vx: number; vy: number }>;
  private width: number;
  private height: number;
  private repulsionStrength: number;
  private attractionStrength: number;
  private centerGravity: number;

  constructor(
    width: number, 
    height: number, 
    repulsionStrength: number = 400,
    attractionStrength: number = 0.015,
    centerGravity: number = 0.002
  ) {
    this.width = width;
    this.height = height;
    this.nodes = new Map();
    this.repulsionStrength = repulsionStrength;
    this.attractionStrength = attractionStrength;
    this.centerGravity = centerGravity;
  }

  /**
   * Initialize node positions randomly
   */
  initializeNodes(nodeIds: string[]): void {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const radius = Math.min(this.width, this.height) * 0.3;

    nodeIds.forEach((id, index) => {
      const angle = (index / nodeIds.length) * 2 * Math.PI;
      this.nodes.set(id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        vx: 0,
        vy: 0
      });
    });
  }

  /**
   * Run force simulation
   */
  simulate(edges: GraphEdge[], iterations: number = 50): void {
    for (let i = 0; i < iterations; i++) {
      this.applyForces(edges);
      this.updatePositions();
    }
  }

  private applyForces(edges: GraphEdge[]): void {
    const nodes = Array.from(this.nodes.entries());

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const [id1, node1] = nodes[i];
        const [id2, node2] = nodes[j];

        const dx = node2.x - node1.x;
        const dy = node2.y - node1.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;

        const repulsion = this.repulsionStrength / (distance * distance);
        const fx = (dx / distance) * repulsion;
        const fy = (dy / distance) * repulsion;

        node1.vx -= fx;
        node1.vy -= fy;
        node2.vx += fx;
        node2.vy += fy;
      }
    }

    // Attraction along edges
    edges.forEach(edge => {
      const source = this.nodes.get(edge.source);
      const target = this.nodes.get(edge.target);

      if (source && target) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;

        const attraction = distance * this.attractionStrength;
        const fx = (dx / distance) * attraction;
        const fy = (dy / distance) * attraction;

        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }
    });

    // Center gravity
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    nodes.forEach(([id, node]) => {
      const dx = centerX - node.x;
      const dy = centerY - node.y;
      node.vx += dx * this.centerGravity;
      node.vy += dy * this.centerGravity;
    });
  }

  private updatePositions(): void {
    const damping = 0.8;
    const margin = 20;

    this.nodes.forEach(node => {
      node.x += node.vx;
      node.y += node.vy;
      node.vx *= damping;
      node.vy *= damping;

      // Keep within bounds
      node.x = Math.max(margin, Math.min(this.width - margin, node.x));
      node.y = Math.max(margin, Math.min(this.height - margin, node.y));
    });
  }

  getPosition(id: string): { x: number; y: number } | undefined {
    return this.nodes.get(id);
  }
}

/**
 * Graph view component
 */
export class GraphView {
  private options: GraphViewOptions;
  private zoomState: ZoomState;
  private readonly ZOOM_STATE_KEY = 'markdown-editor.graphView.zoomState';
  private readonly MIN_ZOOM = 0.1;
  private readonly MAX_ZOOM = 3.0;
  private readonly ZOOM_STEP = 0.1;
  private isPanning = false;
  private panStart = { x: 0, y: 0 };

  constructor(options?: Partial<GraphViewOptions>) {
    this.options = {
      width: 280,
      height: 200,
      nodeRadius: 6,
      showLabels: true,
      repulsionStrength: 400,
      attractionStrength: 0.015,
      centerGravity: 0.002,
      iterations: 100,
      ...options
    };
    
    // Load persisted zoom state or use defaults
    this.zoomState = this.loadZoomState();
  }

  /**
   * Load zoom state from localStorage
   */
  private loadZoomState(): ZoomState {
    try {
      const stored = localStorage.getItem(this.ZOOM_STATE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          scale: Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, parsed.scale || 1)),
          translateX: parsed.translateX || 0,
          translateY: parsed.translateY || 0
        };
      }
    } catch (e) {
      console.error('Failed to load zoom state:', e);
    }
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  /**
   * Save zoom state to localStorage
   */
  private saveZoomState(): void {
    try {
      localStorage.setItem(this.ZOOM_STATE_KEY, JSON.stringify(this.zoomState));
    } catch (e) {
      console.error('Failed to save zoom state:', e);
    }
  }

  /**
   * Reset zoom to fit all nodes
   */
  resetZoom(): void {
    this.zoomState = { scale: 1, translateX: 0, translateY: 0 };
    this.saveZoomState();
    this.applyZoom();
  }

  /**
   * Zoom in centered on viewport
   */
  zoomIn(): void {
    const oldScale = this.zoomState.scale;
    this.zoomState.scale = Math.min(this.MAX_ZOOM, this.zoomState.scale + this.ZOOM_STEP);
    this.adjustZoomCenter(oldScale, this.zoomState.scale);
    this.saveZoomState();
    this.applyZoom();
  }

  /**
   * Zoom out centered on viewport
   */
  zoomOut(): void {
    const oldScale = this.zoomState.scale;
    this.zoomState.scale = Math.max(this.MIN_ZOOM, this.zoomState.scale - this.ZOOM_STEP);
    this.adjustZoomCenter(oldScale, this.zoomState.scale);
    this.saveZoomState();
    this.applyZoom();
  }

  /**
   * Adjust translation to keep zoom centered on viewport
   */
  private adjustZoomCenter(oldScale: number, newScale: number): void {
    const centerX = this.options.width / 2;
    const centerY = this.options.height / 2;
    const scaleDiff = newScale - oldScale;
    
    // Adjust translation to keep center point stable
    this.zoomState.translateX -= (centerX * scaleDiff) / newScale;
    this.zoomState.translateY -= (centerY * scaleDiff) / newScale;
  }

  /**
   * Apply zoom transformation to SVG
   */
  private applyZoom(): void {
    const svg = document.querySelector('.graph-svg') as SVGElement;
    if (svg) {
      const g = svg.querySelector('g') as SVGGElement;
      if (g) {
        g.setAttribute('transform', 
          `translate(${this.zoomState.translateX}, ${this.zoomState.translateY}) scale(${this.zoomState.scale})`);
      }
    }
  }

  /**
   * Get current zoom percentage for display
   */
  getZoomPercentage(): number {
    return Math.round(this.zoomState.scale * 100);
  }

  /**
   * Render graph as SVG string
   */
  render(data: GraphData): string {
    if (!data || data.nodes.length === 0) {
      return this.renderEmpty();
    }

    // Calculate layout
    const layout = new ForceLayout(
      this.options.width, 
      this.options.height,
      this.options.repulsionStrength,
      this.options.attractionStrength,
      this.options.centerGravity
    );
    layout.initializeNodes(data.nodes.map(n => n.id));
    layout.simulate(data.edges, this.options.iterations || 100);

    // Generate SVG
    const edges = this.renderEdges(data.edges, layout);
    const nodes = this.renderNodes(data.nodes, layout);

    return `
      <div class="graph-container">
        <div class="graph-zoom-controls">
          <button class="graph-zoom-btn" data-action="zoom-in" title="Zoom In (+)">+</button>
          <span class="graph-zoom-level">${this.getZoomPercentage()}%</span>
          <button class="graph-zoom-btn" data-action="zoom-out" title="Zoom Out (-)">−</button>
          <button class="graph-zoom-btn" data-action="zoom-reset" title="Reset Zoom (0)">⟲</button>
        </div>
        <svg class="graph-svg" width="${this.options.width}" height="${this.options.height}" viewBox="0 0 ${this.options.width} ${this.options.height}">
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-descriptionForeground)" opacity="0.6" />
            </marker>
          </defs>
          <g class="graph-transform" transform="translate(${this.zoomState.translateX}, ${this.zoomState.translateY}) scale(${this.zoomState.scale})">
            <g class="edges">
              ${edges}
            </g>
            <g class="nodes">
              ${nodes}
            </g>
          </g>
        </svg>
      </div>
    `;
  }

  private renderEdges(edges: GraphEdge[], layout: ForceLayout): string {
    return edges.map(edge => {
      const source = layout.getPosition(edge.source);
      const target = layout.getPosition(edge.target);

      if (!source || !target) {
        return '';
      }

      const edgeClass = edge.type === 'backlink' ? 'edge-backlink' : 'edge-link';
      
      return `
        <line 
          class="graph-edge ${edgeClass}" 
          x1="${source.x}" 
          y1="${source.y}" 
          x2="${target.x}" 
          y2="${target.y}"
          marker-end="url(#arrowhead)"
        />
      `;
    }).join('');
  }

  private renderNodes(nodes: GraphNode[], layout: ForceLayout): string {
    return nodes.map(node => {
      const pos = layout.getPosition(node.id);
      if (!pos) {
        return '';
      }

      const nodeClass = node.isFocus ? 'node-focus' : 'node-regular';
      const radius = node.isFocus ? this.options.nodeRadius + 2 : this.options.nodeRadius;

      // Truncate label if too long
      const maxLabelLength = 15;
      const label = node.label.length > maxLabelLength 
        ? node.label.substring(0, maxLabelLength) + '...' 
        : node.label;

      return `
        <g class="graph-node ${nodeClass}" 
           data-node-id="${node.id}" 
           data-node-path="${node.path || ''}"
           data-label="${this.escapeHtml(node.label)}">
          <circle 
            cx="${pos.x}" 
            cy="${pos.y}" 
            r="${radius}"
            class="node-circle"
          />
          ${this.options.showLabels ? `
            <text 
              x="${pos.x}" 
              y="${pos.y + radius + 12}" 
              class="node-label"
              text-anchor="middle"
            >${this.escapeHtml(label)}</text>
          ` : ''}
          <title>${this.escapeHtml(node.label)}</title>
        </g>
      `;
    }).join('');
  }

  /**
   * Render empty state
   */
  renderEmpty(): string {
    return `
      <div class="graph-empty">
        <span class="codicon codicon-info"></span>
        <p>No connected files</p>
        <span class="graph-empty-hint">Create links with [[filename]] or [text](file.md)</span>
      </div>
    `;
  }

  /**
   * Render loading state
   */
  renderLoading(): string {
    return `
      <div class="graph-loading">
        <div class="loading-spinner"></div>
        <p>Generating graph...</p>
      </div>
    `;
  }

  /**
   * Render graph legend
   */
  renderLegend(): string {
    return `
      <div class="graph-legend">
        <div class="legend-item">
          <svg width="16" height="16">
            <circle cx="8" cy="8" r="5" class="legend-node-focus" />
          </svg>
          <span>Current file</span>
        </div>
        <div class="legend-item">
          <svg width="16" height="16">
            <circle cx="8" cy="8" r="4" class="legend-node-regular" />
          </svg>
          <span>Linked file</span>
        </div>
        <div class="legend-item">
          <svg width="24" height="16">
            <line x1="2" y1="8" x2="22" y2="8" class="legend-edge-link" marker-end="url(#legend-arrow)" />
            <defs>
              <marker id="legend-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <polygon points="0 0, 6 3, 0 6" fill="var(--vscode-descriptionForeground)" opacity="0.6" />
              </marker>
            </defs>
          </svg>
          <span>Outgoing link</span>
        </div>
        <div class="legend-item">
          <svg width="24" height="16">
            <line x1="2" y1="8" x2="22" y2="8" class="legend-edge-backlink" stroke-dasharray="3,2" />
          </svg>
          <span>Backlink</span>
        </div>
      </div>
    `;
  }

  /**
   * Attach zoom control event listeners
   */
  attachZoomEvents(container: HTMLElement): void {
    // Button controls
    const zoomInBtn = container.querySelector('[data-action="zoom-in"]');
    const zoomOutBtn = container.querySelector('[data-action="zoom-out"]');
    const zoomResetBtn = container.querySelector('[data-action="zoom-reset"]');
    const zoomLevelSpan = container.querySelector('.graph-zoom-level');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.zoomIn();
        if (zoomLevelSpan) {
          zoomLevelSpan.textContent = `${this.getZoomPercentage()}%`;
        }
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.zoomOut();
        if (zoomLevelSpan) {
          zoomLevelSpan.textContent = `${this.getZoomPercentage()}%`;
        }
      });
    }

    if (zoomResetBtn) {
      zoomResetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.resetZoom();
        if (zoomLevelSpan) {
          zoomLevelSpan.textContent = `${this.getZoomPercentage()}%`;
        }
      });
    }

    // Mouse wheel zoom (Ctrl + scroll)
    const graphContainer = container.querySelector('.graph-container') as HTMLElement;
    if (graphContainer) {
      graphContainer.addEventListener('wheel', (e: Event) => {
        const wheelEvent = e as WheelEvent;
        if (wheelEvent.ctrlKey || wheelEvent.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          
          const oldScale = this.zoomState.scale;
          const delta = wheelEvent.deltaY > 0 ? -0.05 : 0.05;
          this.zoomState.scale = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.zoomState.scale + delta));
          
          // Zoom centered on mouse position
          const rect = graphContainer.getBoundingClientRect();
          const mouseX = wheelEvent.clientX - rect.left;
          const mouseY = wheelEvent.clientY - rect.top;
          
          // Adjust translation to zoom toward mouse position
          const scaleDiff = this.zoomState.scale - oldScale;
          this.zoomState.translateX -= (mouseX * scaleDiff) / this.zoomState.scale;
          this.zoomState.translateY -= (mouseY * scaleDiff) / this.zoomState.scale;
          
          this.saveZoomState();
          this.applyZoom();
          if (zoomLevelSpan) {
            zoomLevelSpan.textContent = `${this.getZoomPercentage()}%`;
          }
        }
      }, { passive: false });
      
      // Panning with mouse drag
      graphContainer.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button === 0 && !e.ctrlKey && !e.metaKey) { // Left click only, not with ctrl
          const target = e.target as Element;
          // Only pan if not clicking on a node
          if (!target.closest('.graph-node')) {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
            graphContainer.style.cursor = 'grabbing';
            e.preventDefault();
          }
        }
      });
      
      graphContainer.addEventListener('mousemove', (e: MouseEvent) => {
        if (this.isPanning) {
          const dx = e.clientX - this.panStart.x;
          const dy = e.clientY - this.panStart.y;
          
          this.zoomState.translateX += dx;
          this.zoomState.translateY += dy;
          
          this.panStart = { x: e.clientX, y: e.clientY };
          this.applyZoom();
          e.preventDefault();
        }
      });
      
      const endPanning = () => {
        if (this.isPanning) {
          this.isPanning = false;
          this.saveZoomState();
          graphContainer.style.cursor = '';
        }
      };
      
      graphContainer.addEventListener('mouseup', endPanning);
      graphContainer.addEventListener('mouseleave', endPanning);
    }

    // Keyboard shortcuts (check if graph container is hovered)
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const graphContainer = container.querySelector('.graph-container');
      if (graphContainer && graphContainer.matches(':hover')) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          this.zoomIn();
          if (zoomLevelSpan) {
            zoomLevelSpan.textContent = `${this.getZoomPercentage()}%`;
          }
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          this.zoomOut();
          if (zoomLevelSpan) {
            zoomLevelSpan.textContent = `${this.getZoomPercentage()}%`;
          }
        } else if (e.key === '0') {
          e.preventDefault();
          this.resetZoom();
          if (zoomLevelSpan) {
            zoomLevelSpan.textContent = `${this.getZoomPercentage()}%`;
          }
        }
      }
    });
  }

  /**
   * Attach event listeners to graph nodes
   */
  attachEvents(container: HTMLElement, onNodeClick: (nodeId: string, label: string) => void): void {
    const nodes = container.querySelectorAll('.graph-node');
    
    nodes.forEach(node => {
      const nodeElement = node as HTMLElement;
      const nodePath = nodeElement.dataset.nodePath; // Use path instead of id
      const label = nodeElement.dataset.label;
      const circle = nodeElement.querySelector('.node-circle') as SVGCircleElement;

      if (nodePath && label && circle) {
        nodeElement.style.cursor = 'pointer';
        const originalRadius = parseFloat(circle.getAttribute('r') || '6');
        
        nodeElement.addEventListener('click', () => {
          onNodeClick(nodePath, label); // Pass path for file navigation
        });

        nodeElement.addEventListener('mouseenter', () => {
          nodeElement.classList.add('node-hover');
          // Increase radius slightly on hover (stay centered, no transform)
          circle.setAttribute('r', String(originalRadius + 1.5));
        });

        nodeElement.addEventListener('mouseleave', () => {
          nodeElement.classList.remove('node-hover');
          // Restore original radius
          circle.setAttribute('r', String(originalRadius));
        });
      }
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
