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

Routing to a custom agent means actually delegating or spawning that agent when the runtime supports it. Merely reading the agent prompt and impersonating the role in the main agent does not count, except for the direct-work exceptions below or when delegation tooling is unavailable.

If the shortcut ends with `?`, answer only and do not edit files unless the user explicitly asks for file changes.

Examples:

- `@req? Should theme switching enter MVP?`
- `@arch? How should player state be modeled?`
- `@fe Implement the player shell UI from the approved task.`
- `@doc Update README according to current capabilities.`

## Mandatory Subagent Workflow

The main agent is the coordinator, integrator, and final verifier for non-trivial work. Change, build, and fix tasks must be delegated to the matching implementation agent unless they meet the direct-work exceptions below.

### Required Delegation

Use one or more subagents when any of the following is true:

- the task crosses two or more Agent responsibility domains, especially Frontend plus Rust/Tauri
- the task is expected to modify three or more business files or affect multiple independent modules
- the task changes a state machine, async lifecycle, shared state, data contract, Tauri command/event boundary, public interface, or error semantics
- the task is a large refactor, performance optimization, compatibility change, or production-path migration
- two or more independent read-only investigations, code-mapping passes, documentation checks, or review workstreams can proceed separately
- the work exceeds the current agent's responsibility or allowed output paths
- the user explicitly requests delegation, parallel work, independent verification, or multi-Agent collaboration

For delegated implementation, the main agent must assign the matching specialist, avoid duplicating that specialist's work, integrate the result, and run the final repository-level checks.

### Direct-Work Exceptions

The main agent may work directly only when the task is confined to one responsibility domain and is clearly low risk, such as:

- answering a question, reporting status, or performing a focused read-only inspection
- a small single-file documentation, copy, comment, spelling, formatting, or local styling correction
- a mechanical change whose delegation overhead is greater than the work and which does not alter behavior, contracts, state, permissions, or runtime boundaries
- work that cannot be split safely because delegation would require multiple agents to write the same files

If there is doubt whether an implementation is low risk, delegate it.

### Architecture Review Triggers

Architecture Agent review is required before implementation when any of the following is true:

- the change crosses two or more of React, Tauri commands/events, Rust, or local desktop capabilities
- it introduces or changes shared data models, shared state, public interfaces, command/event contracts, dependency direction, or error semantics
- it adds a dependency, permission, persistence mechanism, audio-engine capability, plugin boundary, external service, or runtime capability
- multiple implementation agents depend on the same contract or shared module
- module ownership, dependency direction, or responsibility boundaries are unclear

Pure visual styling, a local component-internal refactor, or a single-module fix within an existing contract does not require Architecture Agent review.

### Independent Verification Triggers

Test Agent must independently verify completed implementation when any of the following is true:

- the task is P0/P1, a defect fix, a release candidate, or pre-merge validation
- user-visible behavior, state transitions, frontend/backend communication, file access, permissions, or error handling changed
- the change affects cross-module contracts, asynchronous work, concurrency, timing, performance, or compatibility
- the feature lacks automated coverage or acceptance requires manual interaction checks
- the implementation agent cannot provide complete build, test, and regression evidence

Pure documentation, planning, comments, or formatting-only changes do not require Test Agent review, but the main agent must still run appropriate basic checks.

### Ownership And Concurrency

- Every file has exactly one write owner during a work phase.
- Each delegated task must state its responsibility, allowed files or directories, and any shared files it must not modify.
- Parallel implementation is allowed only when write sets are explicitly non-overlapping.
- Shared files such as `package.json`, lockfiles, shared types, application entry points, and Tauri configuration must have one owner and be changed sequentially.
- Architecture, Test, and Code Review agents are read-only by default. Assign explicit paths separately if they must write architecture documents or tests.
- Subagents must not revert, overwrite, reformat, or opportunistically modify changes outside their assigned ownership.
- The main agent resolves integration issues and runs final validation after all delegated writes finish.
- If non-overlapping ownership cannot be established, execute the work serially.

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
