# SpMusic Codex Instructions

This repository uses project-specific Agent prompts and Codex custom agents.

## Source Of Truth

- Agent registry: `.agents/prompt/agents.json`
- Agent prompt files: `.agents/prompt/*_Agent.md`
- Agent prompt template: `.agents/prompt/templates/Agent_Prompt_Template.md`
- Legacy prompt mirror: `agent-prompt/`
- Codex custom agents: `.codex/agents/*.toml`
- Git workflow: `GIT_WORKFLOW.md`

When there is a conflict, prefer the latest checked-in prompt file under `.agents/prompt/` over copied, mirrored, or remembered instructions.

## Before Working

- Read `.agents/prompt/agents.json` when a task involves choosing or coordinating Agents.
- Read the relevant `.agents/prompt/*_Agent.md` before acting as that Agent.
- Respect each Agent's allowed outputs and forbidden paths.
- Do not assume old Agent instructions are still valid after prompt files change.

## Agent Usage

- Use PM Agent for planning, scope control, prioritization, task cards, and Agent registry maintenance.
- Use Requirements Agent for requirement analysis only; it does not create Sprint plans or task cards.
- Use Architecture Agent for module boundaries, data contracts, and Tauri command boundaries.
- Use UI/UX Agent for user flows, screen states, and interaction design.
- Use Frontend Agent for React, TypeScript, styling, and frontend integration.
- Use Rust/Tauri Agent for Rust commands, Tauri backend boundaries, and desktop capabilities.
- Use Test Agent for verification plans, test cases, and regression checks.
- Use Documentation Agent for README and docs consistency.

## Agent Shortcuts

When the user starts a message with one of these prefixes, route the request to the matching custom agent:

- `@pm` -> use `pm` agent
- `@req` -> use `requirements` agent
- `@arch` -> use `architecture` agent
- `@ui` -> use `ui_ux` agent
- `@fe` -> use `frontend` agent
- `@tauri` -> use `rust_tauri` agent
- `@test` -> use `test` agent
- `@doc` -> use `documentation` agent

If the shortcut ends with `?`, answer only and do not edit files unless the user explicitly asks for file changes.

Examples:

- `@req? Should theme switching enter MVP?`
- `@arch? How should player state be modeled?`
- `@fe Implement the player shell UI from the approved task.`
- `@doc Update README according to current capabilities.`

## Subagent Guidance

Use subagents mainly for read-heavy or independent work, such as:

- comparing Agent prompts with `agents.json`
- reviewing requirements against PM scope
- checking docs consistency
- mapping code before implementation
- running independent review passes

Be careful with parallel write-heavy work. If multiple agents need to edit files, split ownership by file or wait for one agent to finish before the next writes.

## Prompt Update Rules

When updating any Agent prompt:

- update `.agents/prompt/agents.json` and the legacy mirror `agent-prompt/agents.json` if responsibilities, status, prompt paths, or allowed outputs changed
- update `.codex/agents/*.toml` only if the Codex custom agent behavior or prompt path changed
- mention prompt changes clearly in the final response
- use a docs-style commit message, for example `docs: update agent prompts`

## Project Commands

- Install dependencies: `npm install`
- Frontend dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Tauri CLI: `npm run tauri`
