import * as vscode from 'vscode';
import * as path from 'path';
import { RelationshipAnalyzer } from './RelationshipAnalyzer';

/**
 * Graph node representing a markdown file
 */
export interface GraphNode {
  id: string;
  label: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
}

/**
 * Graph edge representing a link between files
 */
export interface GraphEdge {
  source: string;
  target: string;
  type: 'link' | 'backlink' | 'related';
  weight?: number;
}

/**
 * Complete graph data structure
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusNode?: string;
}

/**
 * Generates graph visualization data from markdown files
 */
export class LinkGraphGenerator {
  private static instance: LinkGraphGenerator;
  private analyzer: RelationshipAnalyzer;

  private constructor() {
    this.analyzer = RelationshipAnalyzer.getInstance();
  }

  public static getInstance(): LinkGraphGenerator {
    if (!LinkGraphGenerator.instance) {
      LinkGraphGenerator.instance = new LinkGraphGenerator();
    }
    return LinkGraphGenerator.instance;
  }

  /**
   * Generate graph data for a specific file and its relationships
   */
  public async generateGraphForFile(
    fileUri: vscode.Uri,
    depth: number = 2,
    maxNodes: number = 50
  ): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const processedFiles = new Set<string>();
    const nodesToProcess: Array<{ uri: vscode.Uri; depth: number }> = [];

    // Add the focus file
    const focusNode = this.createNode(fileUri);
    nodes.push(focusNode);
    processedFiles.add(fileUri.fsPath);
    nodesToProcess.push({ uri: fileUri, depth: 0 });

    // Process nodes breadth-first up to specified depth
    while (nodesToProcess.length > 0 && nodes.length < maxNodes) {
      const { uri, depth: currentDepth } = nodesToProcess.shift()!;

      if (currentDepth >= depth) continue;

      // Get outgoing links
      const outgoingLinks = await this.analyzer.getOutgoingLinks(uri);
      for (const link of outgoingLinks) {
        if (!link.resolved) continue;

        const targetPath = link.resolved;
        
        if (!processedFiles.has(targetPath)) {
          const targetUri = vscode.Uri.file(targetPath);
          const targetNode = this.createNode(targetUri);
          nodes.push(targetNode);
          processedFiles.add(targetPath);

          if (currentDepth + 1 < depth) {
            nodesToProcess.push({ uri: targetUri, depth: currentDepth + 1 });
          }
        }

        // Add edge
        edges.push({
          source: uri.fsPath,
          target: targetPath,
          type: 'link',
          weight: 1
        });
      }

      // Get backlinks
      const backlinks = await this.analyzer.getBacklinks(uri);
      for (const backlink of backlinks) {
        if (!processedFiles.has(backlink.path)) {
          const backlinkUri = vscode.Uri.file(backlink.path);
          const backlinkNode = this.createNode(backlinkUri);
          nodes.push(backlinkNode);
          processedFiles.add(backlink.path);

          if (currentDepth + 1 < depth) {
            nodesToProcess.push({ uri: backlinkUri, depth: currentDepth + 1 });
          }
        }

        // Add edge
        edges.push({
          source: backlink.path,
          target: uri.fsPath,
          type: 'backlink',
          weight: 1
        });
      }
    }

    return {
      nodes,
      edges,
      focusNode: fileUri.fsPath
    };
  }

  /**
   * Generate graph data for entire workspace
   */
  public async generateWorkspaceGraph(maxNodes: number = 100): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const processedFiles = new Set<string>();

    const files = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**', maxNodes);

    for (const file of files) {
      if (processedFiles.has(file.fsPath)) continue;

      const node = this.createNode(file);
      nodes.push(node);
      processedFiles.add(file.fsPath);

      // Get outgoing links for this file
      const outgoingLinks = await this.analyzer.getOutgoingLinks(file);
      for (const link of outgoingLinks) {
        if (!link.resolved) continue;

        const targetPath = link.resolved;

        // Add target node if not processed
        if (!processedFiles.has(targetPath)) {
          const targetUri = vscode.Uri.file(targetPath);
          const targetNode = this.createNode(targetUri);
          nodes.push(targetNode);
          processedFiles.add(targetPath);
        }

        // Add edge
        edges.push({
          source: file.fsPath,
          target: targetPath,
          type: 'link',
          weight: 1
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * Generate simplified graph data for webview (lightweight format)
   */
  public async generateSimplifiedGraph(
    fileUri: vscode.Uri,
    depth: number = 1,
    maxNodes: number = 20
  ): Promise<{ nodes: any[]; edges: any[] }> {
    const fullGraph = await this.generateGraphForFile(fileUri, depth, maxNodes);

    // Simplify for webview - use IDs instead of full paths
    const pathToId = new Map<string, string>();
    let idCounter = 0;

    const simplifiedNodes = fullGraph.nodes.map(node => {
      const id = `node-${idCounter++}`;
      pathToId.set(node.path, id);
      
      return {
        id,
        label: node.label,
        path: node.path, // Include original file path for click navigation
        isFocus: node.path === fullGraph.focusNode
      };
    });

    const simplifiedEdges = fullGraph.edges.map(edge => ({
      source: pathToId.get(edge.source) || edge.source,
      target: pathToId.get(edge.target) || edge.target,
      type: edge.type
    }));

    return {
      nodes: simplifiedNodes,
      edges: simplifiedEdges
    };
  }

  /**
   * Create a graph node from a file URI
   */
  private createNode(fileUri: vscode.Uri): GraphNode {
    const fileName = path.basename(fileUri.fsPath, '.md');
    
    return {
      id: fileUri.fsPath,
      label: fileName,
      path: fileUri.fsPath,
      type: 'file'
    };
  }

  /**
   * Calculate graph statistics
   */
  public calculateGraphStats(graph: GraphData): {
    totalNodes: number;
    totalEdges: number;
    isolatedNodes: number;
    maxDegree: number;
    avgDegree: number;
  } {
    const degree = new Map<string, number>();

    // Count degrees
    for (const edge of graph.edges) {
      degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    }

    const degrees = Array.from(degree.values());
    const maxDegree = degrees.length > 0 ? Math.max(...degrees) : 0;
    const avgDegree = degrees.length > 0 ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0;
    const isolatedNodes = graph.nodes.filter(n => !degree.has(n.id)).length;

    return {
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      isolatedNodes,
      maxDegree,
      avgDegree
    };
  }

  /**
   * Export graph to different formats
   */
  public exportGraph(graph: GraphData, format: 'json' | 'dot' | 'csv'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(graph, null, 2);
      
      case 'dot':
        return this.exportToDot(graph);
      
      case 'csv':
        return this.exportToCsv(graph);
      
      default:
        return JSON.stringify(graph, null, 2);
    }
  }

  /**
   * Export to GraphViz DOT format
   */
  private exportToDot(graph: GraphData): string {
    let dot = 'digraph markdown {\n';
    
    // Add nodes
    graph.nodes.forEach(node => {
      const isFocus = node.id === graph.focusNode;
      const style = isFocus ? ', style=filled, fillcolor=lightblue' : '';
      dot += `  "${node.label}"${style};\n`;
    });

    // Add edges
    graph.edges.forEach(edge => {
      const sourceLabel = path.basename(edge.source, '.md');
      const targetLabel = path.basename(edge.target, '.md');
      dot += `  "${sourceLabel}" -> "${targetLabel}";\n`;
    });

    dot += '}';
    return dot;
  }

  /**
   * Export to CSV format (edges list)
   */
  private exportToCsv(graph: GraphData): string {
    let csv = 'Source,Target,Type,Weight\n';
    
    graph.edges.forEach(edge => {
      const sourceLabel = path.basename(edge.source, '.md');
      const targetLabel = path.basename(edge.target, '.md');
      csv += `${sourceLabel},${targetLabel},${edge.type},${edge.weight || 1}\n`;
    });

    return csv;
  }
}
