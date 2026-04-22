# Cursor Agent Window Orchestration Playbook

Status: Active
Last Updated: April 22, 2026 (America/Indiana/Indianapolis)
Applies To: Cursor Agent Window / Background Agents / Composer-style orchestration

## 1. Current Explorer Snapshot (Ground Truth)

The repository currently contains:

- `.git/`
- `PRD.md` (canonical product requirements)
- `AGENTS.md` (agent ownership, write scopes, merge protocol)
- `TASKS.md` (sprint board with task IDs and dependencies)
- `archive/`
- `archive/PRD1.2026-04-21.snapshot.md`
- `archive/RPD2.2026-04-21.snapshot.md`

Important:
- `PRD.md` is canonical.
- `AGENTS.md` and `TASKS.md` are operational control files.
- `archive/*` is read-only historical context.

## 2. Objective of This Playbook

Use Cursor's multi-agent capability to run parallel agents safely, with:
- explicit role boundaries,
- shared context without chaos,
- deterministic status tracking,
- quality and merge gates,
- autonomous orchestration by a single master agent.

## 3. Cursor Features to Use

Use these Cursor capabilities in your workflow:
- Multiple concurrent agent conversations/tabs.
- Background/Cloud Agents for asynchronous runs.
- Follow-up prompts to running agents.
- Context attachment using `@files` and `@folders`.
- `@Past Chats` to pass relevant prior context to a new run.
- Agent modes and custom modes where useful.

## 4. Preflight Setup (Human Operator)

Before launching agents:

1. Open repo root in Cursor.
2. Verify files exist: `PRD.md`, `AGENTS.md`, `TASKS.md`.
3. Open Cursor settings and enable any required beta features for background/cloud agents if needed.
4. If using cloud/background agents, verify account integration and repository access.
5. Set preferred model policy (e.g., high-quality model for Agent 1 + Agent 8, balanced model for implementation agents).
6. Ensure every agent prompt includes:
- project objective,
- allowed write scope,
- task IDs,
- required status updates to `TASKS.md`.

## 5. Master Agent Responsibilities

The master agent is the orchestrator only. It does not become a general worker.

Master must:
- read `PRD.md`, `AGENTS.md`, `TASKS.md` first,
- dispatch tasks only by ownership from `AGENTS.md`,
- respect dependency graph in `TASKS.md`,
- prevent overlapping file ownership violations,
- require each worker to update task status in `TASKS.md`,
- perform periodic health checks and unblock blocked agents,
- gate merges using DoD and test evidence.

Master must not:
- assign a task to wrong owner,
- allow editing outside write scope,
- merge changes without contract compatibility and tests.

## 6. Launch Strategy (Dependency-Aware)

### Wave 0 (start immediately, parallel)

Launch these first:
- Agent 8: `A8-S0-01`, `A8-S0-02` (CI + guardrails)
- Agent 1: `A1-S0-01`, `A1-S0-02`, `A1-S0-03` (contracts)

Then launch scaffold tasks that are unblocked by Agent 1 outputs:
- Agent 2: `A2-S0-01`
- Agent 3: `A3-S0-01`
- Agent 4: `A4-S0-01`
- Agent 5: `A5-S0-01`
- Agent 6: `A6-S0-01`
- Agent 7: `A7-S0-01`

### Wave 1+

Only move to Sprint 1/2 tasks after dependencies in `TASKS.md` are marked `DONE`.

## 7. Required Worker Output Contract

Each worker agent response must include:

1. Task ID(s) completed.
2. Files changed.
3. Tests run and result.
4. Risk/assumption notes.
5. `TASKS.md` status updates made.
6. Any new blocker with exact dependency ID.

If any of these are missing, master sends follow-up and does not accept completion.

## 8. Master Prompt (Copy/Paste)

Use this as the first instruction in the master agent conversation:

```text
You are the Master Orchestrator for this repository.

Primary control files:
- PRD.md (canonical product requirements)
- AGENTS.md (agent write scopes and ownership)
- TASKS.md (task IDs, dependencies, statuses)

Your job:
1) Read PRD.md, AGENTS.md, TASKS.md fully.
2) Dispatch worker agents strictly by ownership in AGENTS.md.
3) Respect task dependencies in TASKS.md.
4) Ensure parallel execution with no overlapping write scopes.
5) Require each worker to update TASKS.md status and provide file/test evidence.
6) Continuously monitor progress, unblock blockers, and reassign only within ownership rules.
7) Reject any worker output that violates scope, dependencies, or quality gates.

Operational rules:
- No worker edits outside their owned paths.
- No direct edits to shared contracts except Agent 1.
- No merge acceptance without test evidence.
- Keep a concise orchestration log in TASKS.md status fields.

Execution plan:
- Run Wave 0 first from TASKS.md initial priority queue.
- Launch Agent 1 and Agent 8 first, then scaffold tasks for Agents 2-7.
- After each completion, re-evaluate dependencies and dispatch next READY tasks.

When you reply, provide:
- which agent you are dispatching,
- exact task IDs,
- allowed write scope,
- required completion evidence template.
```

## 9. Worker Prompt Template (Copy/Paste)

Use this template when master spawns each worker:

```text
You are Worker Agent <N>.

Role and write scope are defined in AGENTS.md.
You must obey AGENTS.md and TASKS.md strictly.

Assigned task IDs:
- <TASK_ID_1>
- <TASK_ID_2>

Allowed write scope:
- <PATHS_FROM_AGENTS_MD>

Do not edit files outside allowed scope.
Do not modify shared contracts unless your role explicitly owns them.

Required process:
1) Read PRD.md sections relevant to your task.
2) Read AGENTS.md role constraints for your agent.
3) Update TASKS.md status: set assigned tasks to IN_PROGRESS.
4) Implement minimal, correct changes for assigned tasks only.
5) Run relevant tests.
6) Update TASKS.md status to REVIEW when done.
7) Return completion report in this exact format:

COMPLETION REPORT
- Agent: <N>
- Task IDs: ...
- Files changed: ...
- Tests run: ...
- Status updates in TASKS.md: ...
- Remaining blockers: <none or list dependency IDs>
- Notes: ...
```

## 10. Prebuilt Dispatch Prompts by Agent

### Agent 1 Dispatch Prompt

```text
Assign Agent 1 tasks: A1-S0-01, A1-S0-02, A1-S0-03.
Scope: packages/contracts/**, packages/shared-types/**, packages/config/**, docs/architecture/**
Also ensure TASKS.md statuses are updated and provide contract versioning notes.
```

### Agent 8 Dispatch Prompt

```text
Assign Agent 8 tasks: A8-S0-01, A8-S0-02.
Scope: infra/**, .github/workflows/**, tests/smoke/**, docs/runbooks/**
Implement CI baseline and ownership/secrets gate.
Update TASKS.md statuses and include pipeline evidence.
```

### Agent 2 Dispatch Prompt

```text
Assign Agent 2 task: A2-S0-01 (scaffold only).
Scope: services/ingestion-gateway/**, services/state-normalizer/**, tests/unit/ingestion/**, tests/integration/ingestion/**
Wait for Agent 1 contract interfaces where needed; do not invent incompatible schemas.
```

### Agent 3 Dispatch Prompt

```text
Assign Agent 3 task: A3-S0-01 (DFlow adapter scaffold).
Scope: services/execution-orchestrator/adapters/dflow/**, tests/unit/dflow/**, tests/integration/dflow/**
No contract changes.
```

### Agent 4 Dispatch Prompt

```text
Assign Agent 4 task: A4-S0-01 (PNP adapter scaffold).
Scope: services/execution-orchestrator/adapters/pnp/**, services/position-settlement-service/adapters/pnp/**, tests/unit/pnp/**, tests/integration/pnp/**
No risk engine logic.
```

### Agent 5 Dispatch Prompt

```text
Assign Agent 5 task: A5-S0-01 (opportunity-engine scaffold).
Scope: services/opportunity-engine/**, tests/unit/opportunity/**, tests/integration/opportunity/**
No execution submission logic.
```

### Agent 6 Dispatch Prompt

```text
Assign Agent 6 task: A6-S0-01 (risk/reconciliation scaffold).
Scope: services/risk-engine/**, services/position-settlement-service/reconciliation/**, tests/unit/risk/**, tests/integration/risk/**
No UI edits.
```

### Agent 7 Dispatch Prompt

```text
Assign Agent 7 task: A7-S0-01 (frontend/control-plane scaffold).
Scope: apps/frontend-console/**, services/control-plane-api/**, tests/unit/frontend/**, tests/integration/frontend/**
No authorization bypasses.
```

## 11. Agent Health Monitoring Protocol

Master should run this loop:

- Every 10-15 minutes, check each active agent for:
- progress heartbeat,
- scope violations,
- blocker declaration,
- updated TASKS.md status.

If stalled >20 minutes without a blocker explanation:
- send follow-up prompt asking for current diff summary and blocker state.

If blocked on dependency:
- mark task `BLOCKED` in `TASKS.md` with dependency ID.
- dispatch unblocked tasks to keep throughput high.

## 12. Conflict Prevention Rules

- Never assign two agents to the same owned path subtree at the same time.
- Shared contract files are locked to Agent 1.
- If master detects accidental overlap, pause one worker and re-scope.
- For major changes, require workers to include before/after interface snippet.

## 13. Quality Gates Before Acceptance

Master accepts worker completion only if:

1. Files changed stay in allowed scope.
2. Task IDs match assigned tasks.
3. Tests for changed scope passed (or explicit reason why not run).
4. `TASKS.md` status updated to `REVIEW` or `DONE`.
5. No unresolved high-risk assumption.

If any gate fails, return task to worker with explicit remediation steps.

## 14. Recommended Daily Operating Cadence

- Start of day:
- run Wave 0/READY task dispatch.
- Midday:
- conduct integration checkpoint; resolve blockers.
- End of day:
- close with status summary by agent and update milestone gate progress.

## 15. Master End-of-Cycle Report Template

```text
CYCLE REPORT
- Active agents: ...
- Tasks moved to DONE: ...
- Tasks moved to REVIEW: ...
- Blocked tasks (with dependency IDs): ...
- Scope violations detected: ...
- Next dispatch plan: ...
- Milestone gate status (M1-M5): ...
```

## 16. Fast Start Checklist (One Screen)

1. Open `PRD.md`, `AGENTS.md`, `TASKS.md`.
2. Start master agent with Section 8 prompt.
3. Dispatch Agent 1 + Agent 8 first.
4. Dispatch scaffold tasks for Agents 2-7.
5. Enforce Worker Output Contract.
6. Keep `TASKS.md` as single source of execution truth.
7. Advance only READY tasks by dependency.

## 17. Notes on Cursor Behavior

- Agent sessions can run concurrently with separate context and execution.
- Background/cloud agents run remotely in isolated environments.
- You can send follow-ups and take over running agents as needed.
- Use explicit file attachments (`@files`) and optional `@Past Chats` for targeted context sharing.

