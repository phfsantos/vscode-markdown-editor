# First-class where API exists + Fallback UX where API is opaque

## Plan: AI markdown support for the VS Code markdown editor

## 1. Intake

**Goal**
Add first-class support for AI-oriented markdown workflows in the custom markdown editor without breaking normal markdown behavior, while improving interoperability with VS Code chat and edit flows where public APIs allow it.

**User outcome**
Users can open AI-oriented markdown files in the custom editor, understand what AI-related capabilities are available, use workspace-derived context as structured inputs, and get a predictable fallback experience when VS Code or Copilot APIs do not expose direct hooks.

**Core framing**

- **First-class where API exists**: use stable, public VS Code extension APIs for detection, commands, Quick Pick flows, decorations, hovers, context keys, webview/editor UX, workspace analysis, and any public language-model or chat surfaces that are actually available.
- **Fallback UX where API is opaque**: when Copilot Chat internals, tool enumeration, agent discovery, or edit lifecycle hooks are not publicly exposed, provide explicit extension-owned UX that still gets the user to the right outcome.

---

## 2. Scope analysis

**Scope classification:** **Project**

**Why**
This is larger than a single code change. It crosses:

- custom editor behavior
- extension-host services
- AI markdown file semantics
- webview/editor UX
- workspace graph/backlink tooling
- testing and rollout strategy
- optional Copilot/LM interoperability research

**Domains involved**

- **Code**: extension host + custom editor + media/webview changes
- **Researcher**: public API boundary validation for VS Code/Copilot/LM surfaces
- **QA**: regression coverage and compatibility matrix

**Minimum specialists justified**

- **Researcher** — needed once up front to confirm what public APIs really exist
- **Code** — needed to design and later implement the actual extension/editor changes
- **QA** — needed because this touches editor behavior, file taxonomy, and chat/diff interactions

---

## 3. Repo touchpoints already relevant

These are the concrete places this plan should anchor to:

### Existing editor registration

- `package.json`
  - custom editor view type: `markdown-editor`
  - selector currently matches markdown-family filenames broadly
  - activation includes `onWebviewPanel:markdown-editor`

### Existing custom editor / edit-flow surface

- `src/app/EditorPanel.ts`
  - custom editor panel lifecycle
  - current chat-edit integration touchpoint via `findChatEditingStateForDocument`
  - active-document signaling used by other extension services

### Existing extension registration / commands

- `src/extension.ts`
  - `registerCustomEditorProvider('markdown-editor', ...)`
  - current graph command registration: `markdown-editor.openGraphView`
  - file watching and cache invalidation patterns already exist

### Existing workspace graph / relationship services

- `src/sidebar/MarkdownSidebarContext.ts`
  - `getOutgoingLinks()`
  - `getBacklinks()`
  - `getRelatedFiles()`
  - `getGraphData()`
- `src/services/index.ts`
  - exports `RelationshipAnalyzer`, `LinkGraphGenerator`, related types
- `src/app/GraphViewPanel.ts`
  - existing graph visualization entry point

### Existing media/webview surface

- `packages/media/src/main.ts`
- `packages/media/src/vscode-integrator.ts`

These are the likely places for UI affordances, structured-context actions, and editor-side AI markdown presentation.

---

## 4. Product definition

### In scope

1. Detect AI-oriented markdown files such as:
   - `.agent.md`
   - `.prompt.md`
   - `SKILL.md`
2. Preserve markdown identity rather than inventing a separate language mode.
3. Surface AI-oriented affordances in the custom editor.
4. Expose markdown++ workspace context tools based on existing relationship/graph metadata.
5. Improve interoperability with chat-edit flows where public APIs permit it.
6. Provide fallback UX where Copilot or chat internals are not publicly extensible.
7. Ship behind feature flags with phased rollout.

### Out of scope for first delivery

- Re-implementing Copilot Chat itself
- Depending on undocumented/private Copilot internals
- Forcing AI workflows on all markdown files
- Making AI markdown a different VS Code language ID
- Hard-coding support for proprietary agent ecosystems without a public contract

### Non-goals

- No requirement to own the full LM execution pipeline in phase 1
- No requirement to intercept every possible chat edit source
- No requirement to perfectly mirror internal Copilot tool/agent UI

---

## 5. Future execution plan


| Step | Who        | What                                                                                       | Depends on | How we know it is done                                                           |
| ---- | ---------- | ------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------- |
| 1    | Researcher | Validate public API boundaries for VS Code LM/chat/Copilot interoperability                | None       | Written support matrix of supported, unsupported, and unclear integration points |
| 2    | Code       | Define AI markdown taxonomy, file detection rules, and semantic model                      | Step 1     | File classes and behaviors are documented and mapped to extension decisions      |
| 3    | Code       | Design extension-host service layer for AI markdown, tools, and agent catalog abstractions | Steps 1-2  | Service contracts exist and map to concrete repo touchpoints                     |
| 4    | Code       | Design custom editor and webview UX for AI markdown affordances and fallback flows         | Steps 1-3  | Wireframes/interaction spec tied to editor/webview surfaces                      |
| 5    | Code       | Plan markdown++ structured-context tools using backlinks/links/graph services              | Steps 2-3  | Tool definitions and payload shapes are documented                               |
| 6    | Code       | Plan chat-edit interoperability and graceful fallback behavior                             | Steps 1-4  | Supported and fallback edit flows are explicitly documented                      |
| 7    | QA         | Define test matrix, rollout flags, telemetry, and regression gates                         | Steps 1-6  | Acceptance matrix and phased rollout checklist are complete                      |

---

## 6. Detailed work breakdown

## Step 1 — Research spike: public API boundary map

**Who:** Researcher
**When:** First 1-2 days
**What:** Produce an evidence-based matrix of what can be integrated through public APIs versus what must remain extension-owned UX.

### Questions to answer

1. Can stable VS Code APIs enumerate chat tools available to Copilot Chat?
2. Can stable APIs enumerate or select Copilot agents/custom chat participants in a way the extension can rely on?
3. Can public APIs attach structured file context into a chat request from the custom editor?
4. Are there stable LM APIs that can be used independent of Copilot Chat UI?
5. What public signals exist for chat edit lifecycle, pending edits, keep/undo/revert, and diff state?
6. Which APIs are stable versus proposed versus unavailable?

### Deliverable

A short support matrix with columns:

- capability
- public API available?
- proposed-only?
- unavailable/opaque?
- implementation decision
- fallback UX

### Acceptance criteria

- Every planned integration point is labeled **supported**, **unsupported**, or **requires experiment**.
- No later design assumes private Copilot internals.
- The team has a green/yellow/red map before implementation starts.

---

## Step 2 — AI markdown taxonomy and semantic model

**Who:** Code
**When:** After Step 1
**What:** Define how AI-oriented markdown files are recognized and what semantics the editor attaches to them.

### Proposed taxonomy

#### `.agent.md`

Purpose:

- describe an agent/persona/role
- define capabilities, limits, operating instructions, tools, and workflow

Expected sections:

- identity / role
- scope
- tool permissions
- process
- acceptance criteria
- escalation rules

#### `.prompt.md`

Purpose:

- reusable prompt templates or prompt programs
- parameterized instructions for tasks/workflows

Expected sections:

- Intent
- Inputs
- Variables
- Constraints
- Expected Output

These canonical labels are used by the detector, generated templates, validation,
and editor suggestions. Use Variables for placeholders and Expected Output for
the required output shape.

#### `SKILL.md`

Purpose:

- reusable capability documentation
- local conventions, workflows, recipes, or procedures

Expected sections:

- when to use
- prerequisites
- steps
- examples
- failure modes

### Design rules

- Keep `languageId === 'markdown'`.
- Detection should be filename/pattern based first.
- Optional frontmatter may enrich semantics later but should not be required in phase 1.
- Files without AI naming patterns continue to behave as normal markdown files.

### Likely implementation touchpoints

- extension-host detector service near editor/provider orchestration
- context keys for file class
- custom editor payload to media/webview layer

### Acceptance criteria

- Each AI markdown class has a clear purpose and behavior contract.
- Normal markdown files are unaffected.
- Detection rules are deterministic and testable.

---

## Step 3 — Extension-host service design

**Who:** Code
**When:** After taxonomy is set
**What:** Define service abstractions that isolate AI markdown logic from the editor UI.

### Proposed services

#### 1. AI markdown detector service

Responsibilities:

- classify current file as `agent`, `prompt`, `skill`, or `none`
- expose metadata to commands, hovers, and webview bootstrap payloads

#### 2. LM/tool catalog service

Responsibilities:

- expose extension-owned tool definitions
- describe which tools are available by file type and context
- separate public-API-backed capabilities from fallback capabilities

#### 3. Agent catalog abstraction

Responsibilities:

- represent selectable agents/personas even if direct Copilot agent enumeration is unavailable
- support extension-owned registry or future public API integration

#### 4. Markdown++ context service

Responsibilities:

- turn workspace metadata into structured payloads
- reuse:
  - `RelationshipAnalyzer`
  - `LinkGraphGenerator`
  - `MarkdownSidebarContext` patterns for backlinks/links/related files/graph

### Suggested service outputs

- file classification
- allowed actions
- structured tool descriptors
- related context bundle
- fallback instructions when first-class integration is unavailable

### Acceptance criteria

- Service boundaries are independent of webview rendering.
- Existing graph/backlink services are reused rather than duplicated.
- Public API assumptions are isolated behind adapters.

---

## Step 4 — Editor UX for AI markdown files

**Who:** Code
**When:** After service contracts are clear
**What:** Define how AI markdown files should feel inside the custom editor.

### UX principles

- informative, not intrusive
- useful even with zero direct Copilot hooks
- explicit about capability availability
- reversible and low-risk

### Proposed affordances

1. **File-type badge / header treatment**
   - show `Agent`, `Prompt`, or `Skill`
2. **Tool availability indicator**
   - show available context actions for the current file
3. **Hover or inline actions**
   - e.g. insert related files, copy structured context, open graph, inspect backlinks
4. **Agent selection UI**
   - Quick Pick or modal for extension-owned agent choices
5. **Prompt/skill utilities**
   - validate sections
   - insert template blocks
   - copy runnable prompt package
6. **Fallback state messaging**
   - clearly indicate when direct chat/tool wiring is unavailable and provide alternate actions

### Likely repo touchpoints

- `src/app/EditorPanel.ts`
- `packages/media/src/main.ts`
- `packages/media/src/vscode-integrator.ts`

### Acceptance criteria

- AI markdown affordances appear only for matching files.
- The editor still works as a normal markdown editor.
- Every unavailable direct integration has a visible fallback path.

---

## Step 5 — Markdown++ structured-context tools

**Who:** Code
**When:** In parallel with UX detailing or immediately after
**What:** Define extension-owned tools that convert workspace knowledge into AI-usable context.

### Candidate tools

1. **Insert backlinks context**
   - current file backlinks
2. **Insert outgoing links context**
   - links referenced by current file
3. **Insert related files context**
   - nearest neighboring files from relationship analyzer
4. **Insert graph neighborhood**
   - bounded graph data around current node
5. **Open graph then export summary**
   - user-inspectable + machine-usable path

### Structured payload examples

- markdown summary block
- JSON payload copied to clipboard
- editor insertion at cursor
- chat-ready context package for manual paste or future API handoff

### Data sources already present

- `MarkdownSidebarContext.getOutgoingLinks()`
- `MarkdownSidebarContext.getBacklinks()`
- `MarkdownSidebarContext.getRelatedFiles()`
- `MarkdownSidebarContext.getGraphData()`
- `RelationshipAnalyzer`
- `LinkGraphGenerator`

### Acceptance criteria

- At least one structured context path works with no Copilot-specific integration.
- Payload size limits and truncation rules are defined.
- Context extraction reuses existing workspace intelligence.

---

## Step 6 — Chat/edit interoperability plan

**Who:** Code
**When:** After API boundary map and UX decisions
**What:** Improve interoperability with chat-driven edits without depending on opaque internals.

### Current relevant touchpoint

- `src/app/EditorPanel.ts` already references `findChatEditingStateForDocument`, which suggests existing awareness of chat editing state and is the right place to evaluate supported improvements.

### Desired outcomes

1. If public APIs expose pending edit state, reflect it in the custom editor.
2. If keep/undo/revert actions can be surfaced safely, make them visible in the editor UX.
3. If direct hooks are not available, keep the custom editor aligned with document changes and provide explicit refresh/review affordances.

### First-class path if API exists

- bind editor UI to public edit-state signals
- highlight pending edits
- expose accept/reject/revert entry points
- preserve diff visibility between baseline and modified content

### Fallback path if API is opaque

- use document/version change observation only
- provide explicit “review latest AI edits” affordance
- rely on diff/open-in-text-editor/open-source-control style workflows where needed
- avoid pretending the extension can control internal Copilot state when it cannot

### Acceptance criteria

- Supported edit lifecycle hooks are documented and mapped to concrete UI.
- Unsupported lifecycle hooks have an honest fallback plan.
- No brittle dependence on internal Copilot state machines.

---

## Step 7 — Phasing, rollout, and quality gates

**Who:** QA
**When:** After plan stabilization, before implementation
**What:** Define test coverage, rollout sequencing, and guardrails.

### Recommended phases

#### Phase 0 — Research spike

- finish support matrix
- confirm safe architecture

#### Phase 1 — Detection + passive UX

- file classification
- badges/decorations
- basic info panels
- no deep Copilot dependency yet

#### Phase 2 — Structured context tools

- backlinks/related files/graph export actions
- copy/insert flows

#### Phase 3 — Interop improvements

- supported chat/edit integration
- diff/pending edit handling where public APIs allow

#### Phase 4 — Optional deeper LM integration

- only if public/stable APIs justify it

### Test matrix

#### Functional

- `.agent.md` opens with correct affordances
- `.prompt.md` opens with correct affordances
- `SKILL.md` opens with correct affordances
- plain `.md` files remain unchanged
- structured context actions return expected data

#### Compatibility

- normal local files
- remote/workspace files supported by existing editor
- large markdown files
- files with wiki links / backlinks / graph neighbors
- files opened in diff scenarios

#### Regression

- custom editor still opens standard markdown
- graph view still works
- sidebar context still tracks active document
- chat-edit related behavior does not regress existing flows

### Rollout controls

- feature flag for AI markdown detection
- feature flag for AI affordances
- feature flag for chat/edit interoperability
- telemetry only for feature usage and failure points, not content capture

### Acceptance criteria

- Each phase is independently shippable.
- Features can be disabled without breaking the base editor.
- QA has explicit regression gates before release.

---

## 7. Acceptance criteria for the overall initiative

The initiative is done when all of the following are true:

- AI markdown file classes are clearly defined and correctly detected.
- The custom editor shows context-appropriate AI affordances only where relevant.
- Existing relationship/graph services power at least one useful structured-context workflow.
- Public API-backed integrations are implemented only where they are actually supported.
- Unsupported Copilot/chat internals are handled through explicit fallback UX rather than fragile hacks.
- Normal markdown editing remains stable.
- The work ships behind flags with regression coverage.

---

## 8. Risks and mitigations


| Risk                                        | Impact | Mitigation                                                                      |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| Copilot/Chat APIs are private or incomplete | High   | Research spike first; design fallback UX as a first-class requirement           |
| AI markdown semantics become too vague      | Medium | Lock file taxonomy early and keep phase 1 filename-based                        |
| Duplicating existing graph/backlink logic   | Medium | Reuse`RelationshipAnalyzer`, `LinkGraphGenerator`, and sidebar patterns         |
| Editor UX becomes noisy                     | Medium | Gate affordances by file class and keep passive UX first                        |
| Chat-edit flows vary by VS Code version     | Medium | Separate supported behavior from best-effort behavior; test version assumptions |
| Large context payloads become unusable      | Medium | Define truncation, summarization, and bounded graph depth/node counts           |
| Regression in standard markdown editing     | High   | Feature flags + regression matrix + phased rollout                              |

---

## 9. Recommended implementation order

1. Research public API boundaries.
2. Finalize taxonomy and file detection rules.
3. Create service contracts for AI markdown and structured context.
4. Ship passive AI markdown affordances behind a flag.
5. Add markdown++ context tools backed by existing graph/backlink services.
6. Add supported chat/edit interop improvements.
7. Expand only after public API confidence is high.

---

## 10. Definition of done for this plan document

This plan document is complete because it defines:

- the scope classification
- the minimum specialists needed
- the concrete repo touchpoints
- the phased execution order
- acceptance criteria per step
- overall success criteria
- risk handling
- the central product rule: **first-class where API exists, fallback UX where API is opaque**

## High-Level System Diagram for AI Markdown Files

```
text
AI Markdown File
   │
   ▼
AI Markdown Detector
   │
   ├── Semantic Parser (.agent.md / .prompt.md / SKILL.md)
   ├── Relationship/Graph Services
   ├── LM / Tool Catalog Service
   └── Agent Catalog Abstraction
            │
            ▼
     Editor Affordances
     - decorations
     - hovers
     - quick pick
     - diagnostics
            │
            ▼
     markdown++ Chat Tools
     - backlinks
     - outgoing links
     - related files
     - graph neighborhood
```
