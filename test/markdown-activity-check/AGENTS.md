<!-- projectmind:start -->
## ProjectMind

This project uses ProjectMind for persistent memory, codebase knowledge,
work tracking, and specialist agents. The tools arrive over MCP and are
named `projectmind_*` (`projectmind_queryKnowledge`, `projectmind_recallWork`,
`projectmind_trackWork`, `projectmind_captureSignal`, …). Recall before you
build, and record what you decided when you are done.

- **Workflow** — load `$using-projectmind` for the full multi-phase workflow,
  or `$using-projectmind-lite` for a quick task. Skills live in
  `.agents/skills/` (this repo) and `~/.agents/skills/` (user-level).
- **Specialists** — the ProjectMind agents are in `.codex/agents/`; spawn one
  by name (`code`, `qa`, `review`, `debug`, `designer`, `devops`, …).
- **Hooks** — `.codex/hooks.json` wires session context, an evidence log, and
  a risk guard. They load only when this project is trusted in Codex.

Managed by the ProjectMind extension; edits inside these markers are
overwritten. Add your own instructions outside them.
<!-- projectmind:end -->
