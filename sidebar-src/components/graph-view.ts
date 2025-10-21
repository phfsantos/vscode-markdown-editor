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
      <svg class="graph-svg" width="${this.options.width}" height="${this.options.height}" viewBox="0 0 ${this.options.width} ${this.options.height}">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-descriptionForeground)" opacity="0.6" />
          </marker>
        </defs>
        <g class="edges">
          ${edges}
        </g>
        <g class="nodes">
          ${nodes}
        </g>
      </svg>
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
