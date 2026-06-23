(function() {
  const vscode = acquireVsCodeApi();
  
  let graphData = { nodes: [], edges: [] };
  let simulation = null;
  let svg, nodesGroup, edgesGroup, transformGroup, width, height;
  let nodeDistance = 2000; // Default repulsion strength - increased for better spacing
  
  // Zoom and pan state
  let zoomState = { scale: 1, translateX: 0, translateY: 0 };
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  
  // Initialize D3-like force simulation
  class ForceSimulation {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.nodes = [];
      this.edges = [];
      this.alpha = 1.0;
      this.alphaDecay = 0.02;
      this.velocityDecay = 0.4;
    }
    
    setNodes(nodes) {
      this.nodes = nodes.map(n => ({
        ...n,
        x: n.x || Math.random() * this.width,
        y: n.y || Math.random() * this.height,
        vx: 0,
        vy: 0
      }));
      return this;
    }
    
    setEdges(edges) {
      this.edges = edges;
      return this;
    }
    
    tick() {
      // Apply forces
      this.nodes.forEach(node => {
        // Center gravity
        node.vx += (this.width / 2 - node.x) * 0.001;
        node.vy += (this.height / 2 - node.y) * 0.001;
        
        // Repulsion between nodes
        this.nodes.forEach(other => {
          if (node === other) return;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = nodeDistance / (dist * dist);
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
        });
      });
      
      // Attraction along edges
      this.edges.forEach(edge => {
        const source = this.nodes.find(n => n.id === edge.source);
        const target = this.nodes.find(n => n.id === edge.target);
        if (!source || !target) return;
        
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = dist * 0.01;
        
        source.vx += (dx / dist) * force;
        source.vy += (dy / dist) * force;
        target.vx -= (dx / dist) * force;
        target.vy -= (dy / dist) * force;
      });
      
      // Update positions
      this.nodes.forEach(node => {
        node.vx *= this.velocityDecay;
        node.vy *= this.velocityDecay;
        node.x += node.vx;
        node.y += node.vy;
        
        // Boundary conditions
        node.x = Math.max(30, Math.min(this.width - 30, node.x));
        node.y = Math.max(30, Math.min(this.height - 30, node.y));
      });
      
      this.alpha *= (1 - this.alphaDecay);
      return this.alpha > 0.01;
    }
    
    restart() {
      this.alpha = 1.0;
      return this;
    }
  }
  
  function initialize() {
    console.log('[graph-view.js] initialize() called');
    
    const container = document.getElementById('graph-container');
    console.log('[graph-view.js] container element:', container);
    
    svg = document.getElementById('graph');
    console.log('[graph-view.js] svg element:', svg);
    
    if (!container || !svg) {
      console.error('[graph-view.js] CRITICAL: Missing DOM elements!', {
        container: !!container,
        svg: !!svg
      });
      return;
    }
    
    width = container.clientWidth;
    height = container.clientHeight;
    console.log('[graph-view.js] Container dimensions:', { width, height });
    
    if (width === 0 || height === 0) {
      console.warn('[graph-view.js] WARNING: Container has zero dimensions, retrying in 100ms');
      setTimeout(initialize, 100);
      return;
    }
    
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    
    // Create groups for edges and nodes with zoom/pan support
    svg.innerHTML = `
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-descriptionForeground)" opacity="0.6" />
        </marker>
        <marker id="arrowhead-backlink" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-descriptionForeground)" opacity="0.4" />
        </marker>
      </defs>
      <g id="transform-group" transform="translate(0, 0) scale(1)">
        <g id="edges"></g>
        <g id="nodes"></g>
      </g>
    `;
    
    transformGroup = document.getElementById('transform-group');
    edgesGroup = document.getElementById('edges');
    nodesGroup = document.getElementById('nodes');
    console.log('[graph-view.js] SVG groups created');
    
    // Add zoom controls to the DOM
    const zoomControlsHTML = `
      <div class="graph-zoom-controls">
        <button class="graph-zoom-btn" id="zoom-in" title="Zoom In (+)">
          +
        </button>
        <span class="graph-zoom-level" id="zoom-level">100%</span>
        <button class="graph-zoom-btn" id="zoom-out" title="Zoom Out (-)">
          −
        </button>
        <button class="graph-zoom-btn" id="zoom-reset" title="Reset Zoom (0)">
          ⟲
        </button>
      </div>
    `;
    container.insertAdjacentHTML('afterbegin', zoomControlsHTML);
    
    // Setup zoom controls
    document.getElementById('zoom-in').addEventListener('click', () => zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => zoomOut());
    document.getElementById('zoom-reset').addEventListener('click', () => resetZoom());
    
    // Mouse wheel zoom (Ctrl + scroll)
    svg.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        const oldScale = zoomState.scale;
        zoomState.scale = Math.max(0.1, Math.min(3, zoomState.scale + delta));
        
        // Zoom centered on mouse position
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const scaleDiff = zoomState.scale - oldScale;
        zoomState.translateX -= (mouseX * scaleDiff) / zoomState.scale;
        zoomState.translateY -= (mouseY * scaleDiff) / zoomState.scale;
        
        applyZoom();
      }
    }, { passive: false });
    
    // Panning with mouse drag
    svg.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        const target = e.target;
        if (!target.closest('.graph-node')) {
          isPanning = true;
          panStart = { x: e.clientX, y: e.clientY };
          svg.style.cursor = 'grabbing';
          e.preventDefault();
        }
      }
    });
    
    svg.addEventListener('mousemove', (e) => {
      if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        zoomState.translateX += dx;
        zoomState.translateY += dy;
        panStart = { x: e.clientX, y: e.clientY };
        applyZoom();
        e.preventDefault();
      }
    });
    
    const endPanning = () => {
      if (isPanning) {
        isPanning = false;
        svg.style.cursor = '';
      }
    };
    
    svg.addEventListener('mouseup', endPanning);
    svg.addEventListener('mouseleave', endPanning);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (svg.matches(':hover')) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          zoomIn();
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          zoomOut();
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoom();
        }
      }
    });
    
    // Setup controls
    document.getElementById('directLinksOnly').addEventListener('change', (e) => {
      const depthInput = document.getElementById('depth');
      depthInput.disabled = e.target.checked;
      vscode.postMessage({
        command: 'toggleDirectLinksOnly',
        value: e.target.checked
      });
    });
    
    document.getElementById('depth').addEventListener('input', (e) => {
      document.getElementById('depth-value').textContent = e.target.value;
    });
    
    document.getElementById('depth').addEventListener('change', (e) => {
      vscode.postMessage({
        command: 'updateDepth',
        depth: parseInt(e.target.value)
      });
    });
    
    document.getElementById('maxNodes').addEventListener('input', (e) => {
      document.getElementById('max-nodes-value').textContent = e.target.value;
    });
    
    document.getElementById('maxNodes').addEventListener('change', (e) => {
      vscode.postMessage({
        command: 'updateMaxNodes',
        maxNodes: parseInt(e.target.value)
      });
    });
    
    // Node distance slider - update label on input, apply on change
    const nodeDistanceSlider = document.getElementById('nodeDistance');
    const nodeDistanceValue = document.getElementById('node-distance-value');
    
    // Set initial value from slider
    nodeDistance = parseInt(nodeDistanceSlider.value);
    nodeDistanceValue.textContent = nodeDistanceSlider.value;
    
    // Update label while dragging (no layout changes)
    nodeDistanceSlider.addEventListener('input', (e) => {
      nodeDistanceValue.textContent = e.target.value;
    });
    
    // Apply changes only when slider is released (prevents constant re-renders)
    nodeDistanceSlider.addEventListener('change', (e) => {
      nodeDistance = parseInt(e.target.value);
      // Restart simulation with new node distance to apply the change
      if (simulation && graphData.nodes.length > 0) {
        // Preserve current node positions before restarting
        const currentPositions = new Map(
          simulation.nodes.map(n => [n.id, { x: n.x, y: n.y }])
        );
        
        // Recreate simulation with current positions
        simulation = new ForceSimulation(width, height);
        const nodesWithPositions = graphData.nodes.map(n => ({
          ...n,
          x: currentPositions.get(n.id)?.x || n.x,
          y: currentPositions.get(n.id)?.y || n.y
        }));
        simulation.setNodes(nodesWithPositions).setEdges(graphData.edges);
        
        // Run a few iterations to apply the new force
        let iterations = 0;
        const maxIterations = 100;
        
        const animate = () => {
          const shouldContinue = simulation.tick();
          updateVisualization();
          
          iterations++;
          if (shouldContinue && iterations < maxIterations) {
            requestAnimationFrame(animate);
          }
        };
        
        animate();
      }
    });
    
    // Handle window resize - only update dimensions, don't restart simulation
    window.addEventListener('resize', () => {
      width = container.clientWidth;
      height = container.clientHeight;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      if (simulation) {
        simulation.width = width;
        simulation.height = height;
        // Don't call renderGraph() - just let the existing simulation adapt to new dimensions
      }
    });
    
    // Notify extension that webview is ready
    console.log('[graph-view.js] Sending ready message');
    vscode.postMessage({ command: 'ready' });
  }
  
  // Zoom helper functions
  function zoomIn() {
    const oldScale = zoomState.scale;
    zoomState.scale = Math.min(3, zoomState.scale + 0.1);
    const centerX = width / 2;
    const centerY = height / 2;
    const scaleDiff = zoomState.scale - oldScale;
    zoomState.translateX -= (centerX * scaleDiff) / zoomState.scale;
    zoomState.translateY -= (centerY * scaleDiff) / zoomState.scale;
    applyZoom();
  }
  
  function zoomOut() {
    const oldScale = zoomState.scale;
    zoomState.scale = Math.max(0.1, zoomState.scale - 0.1);
    const centerX = width / 2;
    const centerY = height / 2;
    const scaleDiff = zoomState.scale - oldScale;
    zoomState.translateX -= (centerX * scaleDiff) / zoomState.scale;
    zoomState.translateY -= (centerY * scaleDiff) / zoomState.scale;
    applyZoom();
  }
  
  function resetZoom() {
    zoomState = { scale: 1, translateX: 0, translateY: 0 };
    applyZoom();
  }
  
  function applyZoom() {
    if (transformGroup) {
      transformGroup.setAttribute('transform', 
        `translate(${zoomState.translateX}, ${zoomState.translateY}) scale(${zoomState.scale})`);
      const zoomLevel = document.getElementById('zoom-level');
      if (zoomLevel) {
        zoomLevel.textContent = `${Math.round(zoomState.scale * 100)}%`;
      }
    }
  }
  
  function renderGraph() {
    console.log('[graph-view.js] renderGraph() called', {
      hasData: !!graphData,
      nodeCount: graphData?.nodes?.length || 0,
      edgeCount: graphData?.edges?.length || 0
    });
    
    if (!graphData || graphData.nodes.length === 0) {
      console.log('[graph-view.js] No graph data, clearing visualization');
      edgesGroup.innerHTML = '';
      nodesGroup.innerHTML = '';
      return;
    }
    
    // Create simulation
    simulation = new ForceSimulation(width, height);
    simulation.setNodes(graphData.nodes).setEdges(graphData.edges);
    
    // Run simulation
    let iterations = 0;
    const maxIterations = 300;
    
    const animate = () => {
      const shouldContinue = simulation.tick();
      updateVisualization();
      
      iterations++;
      if (shouldContinue && iterations < maxIterations) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }
  
  function updateVisualization() {
    // Render edges
    const edgesHTML = graphData.edges.map(edge => {
      const source = simulation.nodes.find(n => n.id === edge.source);
      const target = simulation.nodes.find(n => n.id === edge.target);
      if (!source || !target) return '';
      
      const edgeClass = edge.type === 'backlink' ? 'edge-backlink' : 'edge-link';
      const marker = edge.type === 'backlink' ? 'arrowhead-backlink' : 'arrowhead';
      
      return `<line class="${edgeClass}" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" marker-end="url(#${marker})" />`;
    }).join('');
    
    edgesGroup.innerHTML = edgesHTML;
    
    // Render nodes
    const nodesHTML = graphData.nodes.map(node => {
      const pos = simulation.nodes.find(n => n.id === node.id);
      if (!pos) return '';
      
      const nodeClass = node.path === graphData.focusNode ? 'node-focus' : 'node-regular';
      const radius = node.path === graphData.focusNode ? 10 : 6;
      
      return `
        <g class="graph-node ${nodeClass}" data-path="${node.path}" style="cursor: pointer;">
          <circle cx="${pos.x}" cy="${pos.y}" r="${radius}" />
          <text x="${pos.x}" y="${pos.y + radius + 14}" text-anchor="middle" class="node-label">${escapeHtml(node.label)}</text>
        </g>
      `;
    }).join('');
    
    nodesGroup.innerHTML = nodesHTML;
    
    // Attach click handlers
    document.querySelectorAll('.graph-node').forEach(node => {
      node.addEventListener('click', () => {
        const path = node.getAttribute('data-path');
        if (path) {
          vscode.postMessage({
            command: 'openFile',
            filePath: path
          });
        }
      });
      
      // Hover effect
      node.addEventListener('mouseenter', () => {
        const circle = node.querySelector('circle');
        const originalRadius = parseFloat(circle.getAttribute('r'));
        circle.setAttribute('r', String(originalRadius + 2));
      });
      
      node.addEventListener('mouseleave', () => {
        const circle = node.querySelector('circle');
        const nodeClass = node.classList.contains('node-focus') ? 10 : 6;
        circle.setAttribute('r', String(nodeClass));
      });
    });
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function updateStats() {
    const stats = document.getElementById('stats');
    stats.textContent = `Nodes: ${graphData.nodes.length} | Links: ${graphData.edges.length}`;
  }
  
  function showLoading(show) {
    const loading = document.getElementById('loading');
    loading.style.display = show ? 'flex' : 'none';
  }
  
  // Handle messages from extension
  window.addEventListener('message', event => {
    const message = event.data;
    console.log('[graph-view.js] Received message:', message.type, message);
    
    switch (message.type) {
      case 'graphData':
        console.log('[graph-view.js] Received graphData:', {
          nodes: message.data?.nodes?.length || 0,
          edges: message.data?.edges?.length || 0
        });
        graphData = message.data;
        renderGraph();
        updateStats();
        break;
      case 'loading':
        console.log('[graph-view.js] Loading state:', message.value);
        showLoading(message.value);
        break;
      case 'error':
        console.error('[graph-view.js] Error message:', message.message);
        showLoading(false);
        break;
    }
  });
  
  // Initialize when DOM is ready
  console.log('[graph-view.js] Script loaded, document.readyState:', document.readyState);
  if (document.readyState === 'loading') {
    console.log('[graph-view.js] Waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    console.log('[graph-view.js] DOM already ready, initializing now');
    initialize();
  }
})();
