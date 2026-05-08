export type AIMarkdownFileKind = 'agent' | 'prompt' | 'skill' | 'none';

export interface AIMarkdownClassification {
  kind: AIMarkdownFileKind;
  isAIMarkdown: boolean;
  badgeLabel: string;
  description: string;
  suggestedSections: string[];
}

const AI_MARKDOWN_SPECS: Record<Exclude<AIMarkdownFileKind, 'none'>, Omit<AIMarkdownClassification, 'kind' | 'isAIMarkdown'>> = {
  agent: {
    badgeLabel: 'Agent',
    description: 'Agent instructions, operating boundaries, workflow, and escalation guidance.',
    suggestedSections: ['Identity', 'Scope', 'Tool Permissions', 'Process', 'Acceptance Criteria', 'Escalation Rules'],
  },
  prompt: {
    badgeLabel: 'Prompt',
    description: 'Reusable prompt template with intent, inputs, constraints, and expected output.',
    suggestedSections: ['Intent', 'Inputs', 'Variables', 'Constraints', 'Expected Output'],
  },
  skill: {
    badgeLabel: 'Skill',
    description: 'Reusable capability guide with triggers, prerequisites, steps, and examples.',
    suggestedSections: ['When to Use', 'Prerequisites', 'Steps', 'Examples', 'Failure Modes'],
  },
};

const NONE_CLASSIFICATION: AIMarkdownClassification = {
  kind: 'none',
  isAIMarkdown: false,
  badgeLabel: '',
  description: '',
  suggestedSections: [],
};

function getFileName(filePathOrName: string): string {
  const segments = String(filePathOrName || '').split(/[\\/]/);
  return segments[segments.length - 1] || '';
}

export function classifyAIMarkdownFileName(filePathOrName: string): AIMarkdownClassification {
  const fileName = getFileName(filePathOrName);
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith('.agent.md')) {
    return {
      kind: 'agent',
      isAIMarkdown: true,
      ...AI_MARKDOWN_SPECS.agent,
    };
  }

  if (normalized.endsWith('.prompt.md')) {
    return {
      kind: 'prompt',
      isAIMarkdown: true,
      ...AI_MARKDOWN_SPECS.prompt,
    };
  }

  if (normalized === 'skill.md') {
    return {
      kind: 'skill',
      isAIMarkdown: true,
      ...AI_MARKDOWN_SPECS.skill,
    };
  }

  return NONE_CLASSIFICATION;
}

export function isAIMarkdownFileName(filePathOrName: string): boolean {
  return classifyAIMarkdownFileName(filePathOrName).isAIMarkdown;
}
