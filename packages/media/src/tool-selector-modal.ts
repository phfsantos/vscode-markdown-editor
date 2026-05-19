/**
 * Tool selector shared types and frontmatter utilities.
 */

export interface ToolInfo {
  name: string;
  description: string;
  tags: string[];
}

export function updateFrontmatterTools(content: string, selectedTools: string[]): string {
  const frontmatterRegex = /^---[\r\n]+([\s\S]*?)[\r\n]+---/;
  const match = content.match(frontmatterRegex);

  const toolsLine =
    selectedTools.length > 0
      ? `tools: [${selectedTools.map((t) => `"${t}"`).join(', ')}]`
      : 'tools: []';

  if (match) {
    let yaml = match[1];
    yaml = yaml.replace(/^tools\s*:\s*\[[^\]]*\]\s*\n?/gm, '');
    yaml = yaml.replace(/^tools\s*:\s*\n(?:[ \t]+-[ \t]*.+\n?)*/gm, '');
    yaml = yaml.replace(/^tools\s*:[ \t]*\n?/gm, '');
    yaml = yaml.trimEnd();
    const newYaml = yaml ? `${yaml}\n${toolsLine}` : toolsLine;
    return content.replace(frontmatterRegex, `---\n${newYaml}\n---`);
  }

  return `---\n${toolsLine}\n---\n\n${content}`;
}
