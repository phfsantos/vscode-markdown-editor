# Expansion & Monetization Plan

**Priority:** MEDIUM (starts after 0.5.0 ships; groundwork can begin now).
**Role:** researcher / fullstack
**Created:** 2026-07-06 (codebase state audit)

## Positioning

The extension is really four products in one: (1) Vditor-based WYSIWYG editor,
(2) Obsidian-style PKM suite (wiki-links, backlinks, graph, tags, daily notes,
templates, embeds), (3) a 25-widget dashboard system (kanban, calendar, weather,
stocks, macro boards…), (4) AI markdown workflows (.agent.md / .prompt.md /
SKILL.md context packages, chat interop, inline suggestions). The defensible
wedge is **"Obsidian-grade PKM + AI-native markdown, inside VS Code"** — nobody
else combines all three. The generic name "Markdown Editor" (inherited from the
zaaack fork) undersells this and is hard to market; consider a rebrand at the
Pro launch.

## Constraint

VS Code Marketplace has no paid-extension mechanism. Monetization must be
freemium: OSS core + license-key-gated Pro features validated against an
external service (LemonSqueezy / Polar / Gumroad all handle license issuance
and validation with minimal backend).

## Model (recommended)

1. **Free (forever):** WYSIWYG editor, wiki-links, backlinks, tags, daily
   notes, basic graph, basic widgets. This is the funnel — maximize installs.
2. **Pro (license key, ~$29–49 one-time early bird → $4–6/mo later):**
   calendar sync (Google/Outlook OAuth), premium widgets (dashboards, macro
   boards, dev commands), AI power features (multi-provider models, large
   context packages, inline suggestions), advanced graph controls, export
   (PDF/HTML/site).
3. **Now, zero-cost:** GitHub Sponsors + Open VSX listing + "Support" link in
   the sidebar Status view.
4. **Later (validate first):** team tier (shared template/vault packs),
   companion cloud (sync, publish-notes-as-site), widget/template marketplace.

## Steps

1. Groundwork: opt-in telemetry (installs alone don't show feature usage);
   respect VS Code's telemetry setting. Decide the exact free/Pro split.
2. Pick the license service (LemonSqueezy recommended: merchant of record,
   handles EU VAT); build a small `LicenseService` in the extension —
   offline-tolerant validation, 7-day grace period.
3. Landing page + docs site (the README is already strong; demo GIFs per
   feature). Rebrand decision happens here.
4. Gate the Pro features behind the license check; free users see a
   non-nagging upgrade affordance where a Pro feature would appear.
5. Launch sequence: 0.6.0 "Pro" release + Product Hunt / HN Show / r/vscode +
   early-bird lifetime pricing.
6. KPIs: weekly installs, activation rate (editor actually opened), free→Pro
   conversion ≥ 1–2%, churn on subscriptions. Review monthly; kill or double
   down per feature based on telemetry.

## Acceptance criteria

- [ ] Free/Pro feature split documented and implemented behind one gate
- [ ] License purchase → key → activation works end-to-end offline-tolerantly
- [ ] Landing page live with pricing
- [ ] Opt-in telemetry reporting feature usage
- [ ] First paid conversion

## Notes

- MIT-fork obligations are compatible with commercial dual offering; keep the
  original license attribution.
- Calendar OAuth: verify shipped client IDs/secrets are safe for a paid
  product (Google web-app clients require a secret in settings — prefer the
  Desktop-app PKCE flow only).
- The widget system (`packages/widgets`, 25+ widgets) is the most
  differentiated Pro surface; the AI features are the fastest-moving one.
