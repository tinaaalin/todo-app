---
name: feature-development
description: >-
  Develop todo-app features using sequential workflow gates, mandatory design
  before code, diff review, and PR templates. Use when implementing any todo-app
  feature or updating this workflow. Always run Steps 1–7 in order; never skip Step 4.
---

# Feature Development (todo-app)

Follow this workflow for every new product feature in this repository.

## Maintaining this skill (two copies)

| Path | Purpose |
|------|---------|
| `docs/feature-development/SKILL.md` | **Canonical source** — edit here first; reviewed in PRs like normal docs |
| `.cursor/skills/feature-development/SKILL.md` | **Installed copy** — Cursor loads skills from `.cursor/skills/` for this project |

**Sync rule:** When this skill changes, update **both files in the same commit**. Workflow:

1. Edit `docs/feature-development/SKILL.md`
2. Copy to `.cursor/skills/feature-development/SKILL.md` (content must match)
3. Include both paths in the same PR

Do not edit only one copy. If content diverges, treat `docs/` as authoritative and refresh the `.cursor/` copy.

---

## Hard rules

- Complete Steps 1–7 for **one feature** before starting the next feature's Step 1.
- **Step 4 is mandatory** for every feature — including small or incremental changes.
- **Do not edit product code** (e.g. `app.js`, `index.html`, `styles.css`) until Step 4 is delivered **and** the user replies **「OK 开始写代码」**.
- **Do not commit, push, or open a PR** until Step 6 is done and the user explicitly confirms (e.g. 「可以 commit」).
- If the user requests multiple features, **queue them** — finish the current feature's Step 7 (PR merged, or user explicitly says to start the next) before Step 1 of the next.
- Skill/docs-only work uses its own branch and PR — do not mix with product features unless the user explicitly combines them.

---

## Workflow

Copy this checklist and track progress. **Do not advance until each gate is satisfied.**

```
- [ ] Step 1: Clarify scope (in / out; which files)
      Gate → scope stated in response
- [ ] Step 2: Create feature branch from updated main
      Gate → on cursor/<feature>, based on latest origin/main
- [ ] Step 3: Gather relevant context
      Gate → brief summary of what you learned
- [ ] Step 4: Explain design (why, files, data flow)
      Gate → deliverable posted; STOP — wait for 「OK 开始写代码」
- [ ] Step 5: Implement smallest scoped change
      Gate → only after user OK; only in-scope files
- [ ] Step 6: Show git diff; wait for user review
      Gate → diff + summary + draft commit/PR; STOP — wait for confirmation
- [ ] Step 7: Commit, push, open PR (after user confirms only)
      Gate → PR opened; feature complete before next feature starts
```

---

## Multiple features in one request

When the user asks for more than one feature (e.g. delete + localStorage):

1. List them as a **queue** with explicit order (simpler / less dependent first).
2. Run Steps 1–7 for **feature A only**.
3. Do **not** branch, code, or draft a PR for feature B until feature A completes Step 7.
4. State in the response: *「Feature B is queued; starting after A merges (or your go-ahead).」*

---

## Step 1: Clarify scope

Before writing code, state:

- What the feature does
- What is **not** included in this iteration
- Which files will change

Keep the first implementation as small as possible.

---

## Step 2: Branch from main

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b cursor/<short-feature-name>
```

Rules:

- One feature per branch
- Branch prefix: `cursor/`
- Do not stack unrelated features on an old merged branch

---

## Step 3: Gather relevant context

Before editing, build enough context to avoid wrong assumptions. Use whatever sources fit the task — do not limit yourself to opening files line by line.

**Typical context for this project:**

- Current code — DOM structure, class names, state shape, event bindings
- Recent git history — merged PRs, branch state, what is already shipped
- User requirements — explicit in/out-of-scope items from the conversation
- Running behavior — local preview or deployed GitHub Pages, if relevant

Summarize findings briefly before Step 4.

---

## Step 4: Design explanation (required before code)

**Mandatory for every feature.** Complexity is not a reason to skip this step.

Post this block in the agent response **before any product code edit**:

```markdown
### Step 4 — Design

**Scope**
- In: …
- Out: …

**Why**
- …

**Files**
- Change: …
- Unchanged: …

**Data flow**
…

**Next:** awaiting 「OK 开始写代码」 before Step 5
```

Include:

1. **Why** — key decisions and tradeoffs
2. **Files** — which change and which do not
3. **Data flow** — user action → state → render → DOM (diagram optional)

**Stop here.** Do not proceed to Step 5 until the user replies **「OK 开始写代码」** (or equivalent explicit approval to implement).

---

## Step 5: Implementation principles

Defaults for this project:

| Principle | Guideline |
|-----------|-----------|
| Simplicity | Prefer extending existing structure before introducing new modules |
| Single source of truth | In-memory array drives the UI; re-render from state |
| Security | Use `textContent` for user strings, not `innerHTML` |
| DOM | Create elements with `createElement`; keep HTML as shell |
| Events | Bind in JS; use `type="button"` in HTML |
| Empty state | Toggle `.list-panel__empty` visibility from render |
| CSS | Reuse existing classes; avoid CSS changes unless required |

Feature-specific logic goes here; the workflow steps stay the same.

---

## Step 6: Review gate

After implementation:

1. Run `git diff` (include new untracked files)
2. Summarize changes in plain language
3. Suggest a commit message
4. Provide a draft PR title and body using the template below
5. **Stop and wait** for user review

Do not commit unless the user confirms.

**Pull request template (use in Step 6 draft and Step 7):**

```markdown
## Summary
- <bullet: what changed>
- <bullet: user-visible behavior>

## Test plan
- [ ] <how to verify locally>
- [ ] <edge case>
- [ ] <explicit expected limitation for this PR>

## Future extensions
- <next logical feature>
- <refactor or split when complexity grows>
```

---

## Step 7: Commit, push, PR (after confirmation)

**Commit message format:**

```
<Short imperative summary>.

<One sentence explaining why or what behavior changed.>
```

**Push:**

```bash
git add <relevant-files-only>
git commit -m "$(cat <<'EOF'
<message>
EOF
)"
git push -u origin cursor/<short-feature-name>
```

Use the PR template from Step 6. Provide title, description, test plan, and future extensions.

---

## Skill or docs-only changes

When updating this skill (not todo-app behavior):

- Branch: `cursor/update-feature-development-skill` (or similar)
- Edit `docs/feature-development/SKILL.md`, then copy to `.cursor/skills/feature-development/SKILL.md`
- Same review gate: diff → user confirm → commit → PR
- Do not implement product features on the same branch unless the user explicitly combines them

---

## Anti-patterns

- Skipping Step 4 because the feature seems small or obvious
- Editing product code before Step 4 deliverable and before **「OK 开始写代码」**
- Starting the next feature before Step 7 completes for the current one
- Bundling multiple product features in one branch or PR without user approval
- Committing before user review
- Reusing a merged feature branch for new work
- Adding out-of-scope behavior (e.g. localStorage in a delete-only PR)
- Introducing new files or modules before checking whether existing structure can absorb the change
- Updating only one copy of this skill file
- Skipping the PR test plan or future extensions section

---

## Examples

**Add Todo (completed)** — PR #2, `cursor/add-todo` → `main`

**Delete Todo (queued)** — run full Steps 1–7 after this skill merges; Step 4 required even though change is small

**localStorage (queued)** — start only after delete PR merges to `main`
