(function () {
  const vscode = acquireVsCodeApi();

  const graph = document.getElementById('graph');
  const loading = document.getElementById('loading');
  const statusMessage = document.getElementById('status-message');
  const depthInput = document.getElementById('depth');
  const depthValue = document.getElementById('depth-value');
  const maxNodesInput = document.getElementById('maxNodes');
  const maxNodesValue = document.getElementById('max-nodes-value');
  const directLinksOnlyInput = document.getElementById('directLinksOnly');
  const stats = document.getElementById('stats');
  const graphContainer = document.getElementById('graph-container');

  if (
    !graph ||
    !loading ||
    !statusMessage ||
    !depthInput ||
    !depthValue ||
    !maxNodesInput ||
    !maxNodesValue ||
    !directLinksOnlyInput ||
    !stats ||
    !graphContainer
  ) {
    return;
  }

  const persisted = vscode.getState() || {};

  const state = {
    graphData: { nodes: [], edges: [] },
    zoom: persisted.graphZoom || { scale: 1, translateX: 0, translateY: 0 },
    isPanning: false,
    panStart: { x: 0, y: 0 }
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setLoading(isLoading) {
    loading.classList.toggle('hidden', !Boolean(isLoading));
  }

  function setStatus(message, tone) {
    if (!message) {
      statusMessage.textContent = '';
      statusMessage.className = 'status-message hidden';
      return;
    }

    statusMessage.textContent = message;
    statusMessage.className = 'status-message ' + (tone || 'info');
  }

  function updateStats() {
    const nodes = state.graphData && state.graphData.nodes ? state.graphData.nodes.length : 0;
    const edges = state.graphData && state.graphData.edges ? state.graphData.edges.length : 0;
    stats.textContent = 'Nodes: ' + nodes + ' | Links: ' + edges;
  }

  function applyControls(data) {
    if (!data) {
      return;
    }

    if (typeof data.depth === 'number') {
      depthInput.value = String(data.depth);
      depthValue.textContent = String(data.depth);
    }

    if (typeof data.maxNodes === 'number') {
      maxNodesInput.value = String(data.maxNodes);
      maxNodesValue.textContent = String(data.maxNodes);
    }

    if (typeof data.showDirectLinksOnly === 'boolean') {
      directLinksOnlyInput.checked = data.showDirectLinksOnly;
      depthInput.disabled = data.showDirectLinksOnly;
    }
  }

  function createPositions(nodes, width, height, distance) {
    const positions = new Map();
    if (!nodes.length) {
      return positions;
    }

    const focusIndex = nodes.findIndex((node) => node.isFocus);
    const focusNode = focusIndex >= 0 ? nodes[focusIndex] : nodes[0];
    const centerX = width / 2;
    const centerY = height / 2;
    const orbit = Math.max(120, Math.min(distance, Math.min(width, height) / 2 - 60));

    nodes.forEach((node, index) => {
      if (focusNode && node.id === focusNode.id) {
        positions.set(node.id, { x: centerX, y: centerY });
        return;
      }

      const offset = focusNode ? index - (focusIndex >= 0 ? 1 : 0) : index;
      const count = Math.max(1, nodes.length - 1);
      const angle = (offset / count) * Math.PI * 2;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * orbit,
        y: centerY + Math.sin(angle) * orbit
      });
    });

    return positions;
  }

  function applyTransform() {
    const g = graph.querySelector('.graph-transform');
    if (g) {
      g.setAttribute(
        'transform',
        'translate(' + state.zoom.translateX + ',' + state.zoom.translateY + ') scale(' + state.zoom.scale + ')'
      );
    }
  }

  function render() {
    const data = state.graphData || { nodes: [], edges: [] };
    updateStats();

    if (!data.nodes || data.nodes.length === 0) {
      graph.innerHTML = '';
      return;
    }

    const bounds = graph.getBoundingClientRect();
    const width = Math.max(640, Math.round(bounds.width || window.innerWidth - 320 || 900));
    const height = Math.max(560, Math.round(bounds.height || window.innerHeight || 700));
    graph.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    const positions = createPositions(data.nodes, width, height, 200);
    const edgeMarkup = data.edges
      .map((edge) => {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) {
          return '';
        }
        const edgeClass = edge.type === 'backlink' ? 'edge-backlink' : 'edge-link';
        return '<line class="' + edgeClass + '" x1="' + source.x + '" y1="' + source.y + '" x2="' + target.x + '" y2="' + target.y + '" />';
      })
      .join('');

    const nodeMarkup = data.nodes
      .map((node) => {
        const pos = positions.get(node.id);
        if (!pos) {
          return '';
        }

        const label = escapeHtml(node.label || '');
        const shortLabel = label.length > 20 ? label.slice(0, 20) + '…' : label;
        const className = node.isFocus ? 'node-focus' : 'node-regular';
        const radius = node.isFocus ? 18 : 14;
        const path = escapeHtml(node.path || '');

        return (
          '<g class="node-group" data-path="' +
          path +
          '">' +
          '<circle class="' +
          className +
          '" cx="' +
          pos.x +
          '" cy="' +
          pos.y +
          '" r="' +
          radius +
          '" />' +
          '<text class="node-label" x="' +
          pos.x +
          '" y="' +
          (pos.y + radius + 14) +
          '" text-anchor="middle">' +
          shortLabel +
          '</text>' +
          '<title>' +
          label +
          '</title>' +
          '</g>'
        );
      })
      .join('');

    // Wrap edges and nodes inside a transform group so we can pan/zoom
    graph.innerHTML =
      '<g class="graph-transform" transform="translate(' +
      state.zoom.translateX +
      ',' +
      state.zoom.translateY +
      ') scale(' +
      state.zoom.scale +
      ')">' +
      '<g class="edges">' +
      edgeMarkup +
      '</g><g class="nodes">' +
      nodeMarkup +
      '</g></g>';

    // Apply listeners to nodes
    graph.querySelectorAll('.node-group').forEach((node) => {
      node.addEventListener('click', () => {
        const filePath = node.getAttribute('data-path');
        if (filePath) {
          vscode.postMessage({ command: 'openFile', filePath });
        }
      });
    });
  }

  // Controls binding
  depthInput.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    depthValue.textContent = String(value);
    vscode.postMessage({ command: 'updateDepth', depth: value });
  });

  maxNodesInput.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    maxNodesValue.textContent = String(value);
    vscode.postMessage({ command: 'updateMaxNodes', maxNodes: value });
  });

  directLinksOnlyInput.addEventListener('change', (event) => {
    const checked = Boolean(event.target.checked);
    depthInput.disabled = checked;
    vscode.postMessage({ command: 'toggleDirectLinksOnly', value: checked });
  });

  // Pan/Zoom handlers on the container — allow wheel zoom without modifier keys
  graphContainer.addEventListener(
    'wheel',
    (e) => {
      const wheelEvent = e;
      e.preventDefault();
      e.stopPropagation();
      const oldScale = state.zoom.scale;
      const delta = wheelEvent.deltaY > 0 ? -0.05 : 0.05;
      state.zoom.scale = Math.max(0.1, Math.min(3, state.zoom.scale + delta));
      const rect = graph.getBoundingClientRect();
      const mouseX = wheelEvent.clientX - rect.left;
      const mouseY = wheelEvent.clientY - rect.top;
      const scaleDiff = state.zoom.scale - oldScale;
      state.zoom.translateX -= (mouseX * scaleDiff) / state.zoom.scale;
      state.zoom.translateY -= (mouseY * scaleDiff) / state.zoom.scale;
      vscode.setState({ graphZoom: state.zoom });
      applyTransform();
    },
    { passive: false }
  );

  graphContainer.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
      const target = e.target;
      if (!target.closest('.node-group')) {
        state.isPanning = true;
        state.panStart = { x: e.clientX, y: e.clientY };
        graphContainer.style.cursor = 'grabbing';
        e.preventDefault();
      }
    }
  });

  graphContainer.addEventListener('mousemove', (e) => {
    if (state.isPanning) {
      const dx = e.clientX - state.panStart.x;
      const dy = e.clientY - state.panStart.y;
      state.zoom.translateX += dx;
      state.zoom.translateY += dy;
      state.panStart = { x: e.clientX, y: e.clientY };
      applyTransform();
      e.preventDefault();
    }
  });

  const endPanning = () => {
    if (state.isPanning) {
      state.isPanning = false;
      vscode.setState({ graphZoom: state.zoom });
      graphContainer.style.cursor = '';
    }
  };

  graphContainer.addEventListener('mouseup', endPanning);
  graphContainer.addEventListener('mouseleave', endPanning);

  document.addEventListener('keydown', (e) => {
    if (graphContainer && graphContainer.matches(':hover')) {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        state.zoom.scale = Math.min(3, state.zoom.scale + 0.1);
        applyTransform();
        vscode.setState({ graphZoom: state.zoom });
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        state.zoom.scale = Math.max(0.1, state.zoom.scale - 0.1);
        applyTransform();
        vscode.setState({ graphZoom: state.zoom });
      } else if (e.key === '0') {
        e.preventDefault();
        state.zoom.scale = 1;
        state.zoom.translateX = 0;
        state.zoom.translateY = 0;
        applyTransform();
        vscode.setState({ graphZoom: state.zoom });
      }
    }
  });

  window.addEventListener('message', (event) => {
    if (event.data.type === 'loading') {
      setLoading(event.data.value);
      return;
    }

    if (event.data.type === 'controlsState') {
      applyControls(event.data.data || {});
      return;
    }

    if (event.data.type === 'graphData') {
      state.graphData = event.data.data || { nodes: [], edges: [] };
      if (state.graphData.nodes.length > 0) {
        setStatus('', 'info');
      }
      render();
      return;
    }

    if (event.data.type === 'emptyState') {
      setStatus(event.data.message, 'info');
      return;
    }

    if (event.data.type === 'error') {
      setStatus(event.data.message, 'error');
    }
  });

  window.addEventListener('resize', render);

  depthValue.textContent = depthInput.value;
  maxNodesValue.textContent = maxNodesInput.value;
  depthInput.disabled = Boolean(directLinksOnlyInput.checked);
  setLoading(false);
  render();
  vscode.postMessage({ command: 'ready' });
})();
