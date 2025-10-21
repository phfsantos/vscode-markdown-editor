import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Template with variables support
 */
export interface Template {
  id: string;
  name: string;
  description: string;
  content: string;
  category: 'builtin' | 'user';
  variables?: string[];
}

/**
 * Template variable context
 */
export interface TemplateContext {
  date: string;
  time: string;
  datetime: string;
  year: string;
  month: string;
  day: string;
  weekday: string;
  title?: string;
  filename?: string;
  [key: string]: string | undefined;
}

/**
 * Manages note templates with variable support
 */
export class TemplateManager {
  private static instance: TemplateManager;
  private builtinTemplates: Map<string, Template> = new Map();
  private userTemplates: Map<string, Template> = new Map();

  private constructor() {
    this.initializeBuiltinTemplates();
  }

  public static getInstance(): TemplateManager {
    if (!TemplateManager.instance) {
      TemplateManager.instance = new TemplateManager();
    }
    return TemplateManager.instance;
  }

  /**
   * Initialize built-in templates
   */
  private initializeBuiltinTemplates(): void {
    this.builtinTemplates.set('daily', {
      id: 'daily',
      name: 'Daily Note',
      description: 'Daily note with tasks and journal sections',
      category: 'builtin',
      content: `# Daily Note - {{date}}

## Tasks
- [ ] 

## Notes


## Reflections

`,
      variables: ['date']
    });

    this.builtinTemplates.set('meeting', {
      id: 'meeting',
      name: 'Meeting Notes',
      description: 'Meeting notes with attendees and action items',
      category: 'builtin',
      content: `# Meeting Notes - {{date}}

**Time:** {{time}}  
**Attendees:**
- 

## Agenda
1. 

## Notes


## Action Items
- [ ] 

## Next Steps

`,
      variables: ['date', 'time']
    });

    this.builtinTemplates.set('quick', {
      id: 'quick',
      name: 'Quick Note',
      description: 'Simple timestamped note',
      category: 'builtin',
      content: `# {{title}}

*Created: {{datetime}}*

`,
      variables: ['title', 'datetime']
    });

    this.builtinTemplates.set('task', {
      id: 'task',
      name: 'Task List',
      description: 'Task list with sections',
      category: 'builtin',
      content: `# Task List - {{date}}

## Today
- [ ] 

## This Week
- [ ] 

## Backlog
- [ ] 

## Completed
- [x] 

`,
      variables: ['date']
    });

    this.builtinTemplates.set('book', {
      id: 'book',
      name: 'Book Notes',
      description: 'Book notes and highlights',
      category: 'builtin',
      content: `# {{title}}

**Author:** 
**Started:** {{date}}

## Key Ideas


## Quotes
> 

## My Thoughts


## Action Items
- [ ] 

`,
      variables: ['title', 'date']
    });

    this.builtinTemplates.set('weekly', {
      id: 'weekly',
      name: 'Weekly Review',
      description: 'Weekly review and planning',
      category: 'builtin',
      content: `# Weekly Review - Week of {{date}}

## Wins This Week
- 

## Challenges
- 

## Lessons Learned


## Next Week's Goals
1. 
2. 
3. 

## Notes

`,
      variables: ['date']
    });
  }

  /**
   * Get all available templates
   */
  public getAllTemplates(): Template[] {
    return [
      ...Array.from(this.builtinTemplates.values()),
      ...Array.from(this.userTemplates.values())
    ];
  }

  /**
   * Get template by ID
   */
  public getTemplate(id: string): Template | undefined {
    return this.builtinTemplates.get(id) || this.userTemplates.get(id);
  }

  /**
   * Create note from template
   */
  public async createNoteFromTemplate(
    templateId: string,
    customContext?: Partial<TemplateContext>
  ): Promise<vscode.TextDocument> {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const context = this.createTemplateContext(customContext);
    const content = this.applyVariables(template.content, context);

    // Create new untitled document
    const doc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content
    });

    return doc;
  }

  /**
   * Apply template variables to content
   */
  public applyVariables(content: string, context: TemplateContext): string {
    let result = content;

    // Replace all {{variable}} patterns
    const variableRegex = /\{\{([^}]+)\}\}/g;
    result = result.replace(variableRegex, (match, variable) => {
      const key = variable.trim();
      return context[key] !== undefined ? String(context[key]) : match;
    });

    return result;
  }

  /**
   * Create template context with current date/time
   */
  private createTemplateContext(customContext?: Partial<TemplateContext>): TemplateContext {
    const now = new Date();
    
    const context: TemplateContext = {
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      datetime: now.toISOString().replace('T', ' ').split('.')[0],
      year: now.getFullYear().toString(),
      month: (now.getMonth() + 1).toString().padStart(2, '0'),
      day: now.getDate().toString().padStart(2, '0'),
      weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
      title: 'New Note',
      filename: `note-${now.toISOString().split('T')[0]}.md`
    };

    // Merge with custom context
    return { ...context, ...customContext };
  }

  /**
   * Load user templates from workspace folder
   */
  public async loadUserTemplates(templatesFolder?: string): Promise<void> {
    if (!templatesFolder) {
      const config = vscode.workspace.getConfiguration('markdown-editor');
      templatesFolder = config.get<string>('templatesFolder', '.templates');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    const templatePath = path.join(workspaceFolder.uri.fsPath, templatesFolder);
    
    if (!fs.existsSync(templatePath)) {
      return; // No templates folder exists
    }

    const files = fs.readdirSync(templatePath);
    
    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = path.join(templatePath, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const id = path.basename(file, '.md');
        
        // Extract metadata from frontmatter if exists
        const { metadata, body } = this.parseFrontmatter(content);
        
        this.userTemplates.set(id, {
          id,
          name: metadata.name || id,
          description: metadata.description || 'User template',
          content: body,
          category: 'user',
          variables: metadata.variables
        });
      }
    }
  }

  /**
   * Parse frontmatter from markdown content
   */
  private parseFrontmatter(content: string): { metadata: any; body: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { metadata: {}, body: content };
    }

    const metadata: any = {};
    const frontmatter = match[1];
    const body = match[2];

    // Parse YAML-like frontmatter
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        const value = valueParts.join(':').trim();
        
        // Handle arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          metadata[key.trim()] = value
            .slice(1, -1)
            .split(',')
            .map(v => v.trim());
        } else {
          metadata[key.trim()] = value;
        }
      }
    }

    return { metadata, body };
  }

  /**
   * Save user template
   */
  public async saveUserTemplate(
    id: string,
    name: string,
    content: string,
    description?: string,
    variables?: string[]
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('markdown-editor');
    const templatesFolder = config.get<string>('templatesFolder', '.templates');

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder open');
    }

    const templatePath = path.join(workspaceFolder.uri.fsPath, templatesFolder);
    
    // Create templates folder if it doesn't exist
    if (!fs.existsSync(templatePath)) {
      fs.mkdirSync(templatePath, { recursive: true });
    }

    // Create frontmatter
    let frontmatter = `---
name: ${name}`;
    
    if (description) {
      frontmatter += `\ndescription: ${description}`;
    }
    
    if (variables && variables.length > 0) {
      frontmatter += `\nvariables: [${variables.join(', ')}]`;
    }
    
    frontmatter += '\n---\n\n';

    const fullContent = frontmatter + content;
    const filePath = path.join(templatePath, `${id}.md`);
    
    fs.writeFileSync(filePath, fullContent, 'utf8');

    // Add to user templates
    this.userTemplates.set(id, {
      id,
      name,
      description: description || 'User template',
      content,
      category: 'user',
      variables
    });

    vscode.window.showInformationMessage(`Template "${name}" saved successfully`);
  }

  /**
   * Delete user template
   */
  public async deleteUserTemplate(id: string): Promise<void> {
    const template = this.userTemplates.get(id);
    if (!template) {
      throw new Error(`Template not found: ${id}`);
    }

    const config = vscode.workspace.getConfiguration('markdown-editor');
    const templatesFolder = config.get<string>('templatesFolder', '.templates');

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    const filePath = path.join(workspaceFolder.uri.fsPath, templatesFolder, `${id}.md`);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    this.userTemplates.delete(id);
    vscode.window.showInformationMessage(`Template "${template.name}" deleted`);
  }
}
