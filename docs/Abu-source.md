# Abu — Source Code

Monorepo with pnpm workspaces: `@abu/core` (shared), `abu-tech` (Tech edition), `abu-ops` (Ops edition).

## Setup

```bash
pnpm install
pnpm dev:tech      # http://localhost:5173
pnpm dev:ops
pnpm build
```

Behind a corporate proxy, add `.npmrc` with your Nexus registry and set `NODE_EXTRA_CA_CERTS` to the corporate CA bundle.

---

## Root

### `package.json`

```json
{
  "name": "abu",
  "private": true,
  "scripts": {
    "dev:tech": "pnpm --filter abu-tech dev",
    "dev:ops": "pnpm --filter abu-ops dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

---

## `packages/core`

### `packages/core/package.json`

```json
{
  "name": "@abu/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles.css"
  },
  "scripts": {
    "test": "vitest run"
  },
  "peerDependencies": {
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "vitest": "^2.1.0"
  }
}
```

### `packages/core/src/types.ts`

```ts
export interface LinkItem {
  id?: string;
  name: string;
  url: string;
  tags?: string[];
  desc?: string;
}

export interface LinkCategory {
  id: string;
  name: string;
  links: LinkItem[];
}

export interface LinksConfig {
  categories: LinkCategory[];
}

export interface WorkflowStep {
  id: string;
  title: string;
  owner?: string;
  depends_on?: string[];
  checklist?: string[];
  links?: string[]; // link ids from links.yaml
  optional?: boolean;
}

export interface Workflow {
  name: string;
  steps: WorkflowStep[];
}

export type StepState = "done" | "ready" | "locked";
```

### `packages/core/src/loader.ts`

```ts
import type { LinksConfig, Workflow } from "./types";

export function validateLinks(raw: unknown): LinksConfig {
  const cfg = raw as LinksConfig;
  if (!cfg || !Array.isArray(cfg.categories)) {
    throw new Error("links: 'categories' must be a list");
  }
  const seen = new Set<string>();
  for (const c of cfg.categories) {
    if (!c.id || !c.name || !Array.isArray(c.links)) {
      throw new Error(`links: invalid category ${JSON.stringify(c?.id)}`);
    }
    for (const l of c.links) {
      if (!l.name || !/^https?:\/\//.test(l.url ?? "")) {
        throw new Error(`links: bad link "${l.name}" in category "${c.id}"`);
      }
      if (l.id) {
        if (seen.has(l.id)) throw new Error(`links: duplicate link id "${l.id}"`);
        seen.add(l.id);
      }
    }
  }
  return cfg;
}

export function validateWorkflow(raw: unknown): Workflow {
  const wf = raw as Workflow;
  if (!wf?.name || !Array.isArray(wf.steps)) {
    throw new Error("workflow: needs 'name' and 'steps'");
  }
  const byId = new Map<string, Workflow["steps"][number]>();
  for (const s of wf.steps) {
    if (!s.id || !s.title) throw new Error("workflow: every step needs id and title");
    if (byId.has(s.id)) throw new Error(`workflow: duplicate step id "${s.id}"`);
    byId.set(s.id, s);
  }
  for (const s of wf.steps) {
    for (const d of s.depends_on ?? []) {
      if (!byId.has(d)) throw new Error(`workflow: step "${s.id}" depends on unknown "${d}"`);
    }
  }
  // Cycle detection (DFS)
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`workflow: dependency cycle at "${id}"`);
    visiting.add(id);
    for (const d of byId.get(id)!.depends_on ?? []) visit(d);
    visiting.delete(id);
    visited.add(id);
  };
  wf.steps.forEach((s) => visit(s.id));
  return wf;
}
```

### `packages/core/src/search.ts`

```ts
import type { LinkCategory, LinkItem, LinksConfig } from "./types";

export interface SearchHit {
  link: LinkItem;
  category: LinkCategory;
  score: number;
}

const has = (text: string | undefined, token: string) =>
  !!text && text.toLowerCase().includes(token);

export function searchLinks(cfg: LinksConfig, query: string): SearchHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];
  for (const category of cfg.categories) {
    for (const link of category.links) {
      let total = 0;
      let allMatched = true;
      for (const t of tokens) {
        let s = 0;
        if (has(link.name, t)) s += 3;
        if (link.tags?.some((tag) => has(tag, t))) s += 2;
        if (has(link.desc, t) || has(category.name, t)) s += 1;
        if (s === 0) {
          allMatched = false;
          break;
        }
        total += s;
      }
      if (allMatched) hits.push({ link, category, score: total });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.link.name.localeCompare(b.link.name));
}

export function indexLinks(cfg: LinksConfig): Record<string, LinkItem> {
  const out: Record<string, LinkItem> = {};
  for (const c of cfg.categories) for (const l of c.links) if (l.id) out[l.id] = l;
  return out;
}
```

### `packages/core/src/workflow.ts`

```ts
import type { StepState, Workflow } from "./types";

export function computeStates(wf: Workflow, done: Set<string>): Record<string, StepState> {
  const byId = new Map(wf.steps.map((s) => [s.id, s]));
  const out: Record<string, StepState> = {};
  for (const step of wf.steps) {
    if (done.has(step.id)) {
      out[step.id] = "done";
      continue;
    }
    const blocked = (step.depends_on ?? []).some(
      (d) => !done.has(d) && !byId.get(d)?.optional
    );
    out[step.id] = blocked ? "locked" : "ready";
  }
  return out;
}
```

### `packages/core/src/progress.ts`

```ts
import { useCallback, useEffect, useState } from "react";

interface Progress {
  done: string[];
  items: string[]; // "stepId:index"
}

const empty: Progress = { done: [], items: [] };

function load(key: string): Progress {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

export function useProgress(workflowKey: string) {
  const storageKey = `abu:progress:${workflowKey}`;
  const [state, setState] = useState<Progress>(() => load(storageKey));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* storage blocked or full: keep working in memory */
    }
  }, [storageKey, state]);

  const toggle = (list: keyof Progress, value: string) =>
    setState((s) => ({
      ...s,
      [list]: s[list].includes(value) ? s[list].filter((v) => v !== value) : [...s[list], value],
    }));

  const toggleStep = useCallback((id: string) => toggle("done", id), []);
  const toggleItem = useCallback((id: string) => toggle("items", id), []);
  const reset = useCallback(() => setState(empty), []);

  return {
    done: new Set(state.done),
    items: new Set(state.items),
    toggleStep,
    toggleItem,
    reset,
  };
}
```

### `packages/core/src/components/LinkHub.tsx`

```tsx
import { useMemo, useState } from "react";
import type { LinksConfig } from "../types";
import { searchLinks } from "../search";

export function LinkHub({ config }: { config: LinksConfig }) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => (query.trim() ? searchLinks(config, query) : []), [config, query]);

  return (
    <section className="abu-hub">
      <input
        className="abu-search"
        type="search"
        autoFocus
        placeholder="Search tools, tags, descriptions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() ? (
        <ul className="abu-list">
          {hits.length === 0 && <li className="abu-muted">No matches.</li>}
          {hits.map(({ link, category }) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.name}
              </a>
              <span className="abu-muted"> · {category.name}</span>
              {link.desc && <div className="abu-muted">{link.desc}</div>}
            </li>
          ))}
        </ul>
      ) : (
        config.categories.map((c) => (
          <div key={c.id} className="abu-category">
            <h3>{c.name}</h3>
            <ul className="abu-list">
              {c.links.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer">
                    {l.name}
                  </a>
                  {l.desc && <div className="abu-muted">{l.desc}</div>}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
```

### `packages/core/src/components/WorkflowChecklist.tsx`

```tsx
import type { LinkItem, Workflow } from "../types";
import { computeStates } from "../workflow";
import { useProgress } from "../progress";

interface Props {
  workflow: Workflow;
  linkIndex: Record<string, LinkItem>;
  storageKey: string;
}

export function WorkflowChecklist({ workflow, linkIndex, storageKey }: Props) {
  const { done, items, toggleStep, toggleItem, reset } = useProgress(storageKey);
  const states = computeStates(workflow, done);
  const total = workflow.steps.filter((s) => !s.optional).length;
  const finished = workflow.steps.filter((s) => !s.optional && done.has(s.id)).length;

  return (
    <section className="abu-workflow">
      <header className="abu-wf-head">
        <h2>{workflow.name}</h2>
        <span className="abu-muted">
          {finished}/{total} required steps done
        </span>
        <button onClick={reset}>Reset</button>
      </header>

      {workflow.steps.map((step, i) => {
        const state = states[step.id];
        return (
          <article key={step.id} className={`abu-step abu-${state}`}>
            <label className="abu-step-title">
              <input
                type="checkbox"
                checked={state === "done"}
                disabled={state === "locked"}
                onChange={() => toggleStep(step.id)}
              />
              <strong>
                {i + 1}. {step.title}
              </strong>
              {step.optional && <em className="abu-muted"> (optional)</em>}
            </label>
            <div className="abu-muted">
              {step.owner && <span>Owner: {step.owner} · </span>}
              <span>{state}</span>
            </div>

            {step.checklist?.map((text, idx) => {
              const id = `${step.id}:${idx}`;
              return (
                <label key={id} className="abu-item">
                  <input type="checkbox" checked={items.has(id)} onChange={() => toggleItem(id)} />
                  {text}
                </label>
              );
            })}

            {step.links?.map((id) => {
              const l = linkIndex[id];
              return l ? (
                <a key={id} className="abu-chip" href={l.url} target="_blank" rel="noreferrer">
                  {l.name}
                </a>
              ) : (
                <span key={id} className="abu-chip abu-muted">
                  {id} (unknown link)
                </span>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}
```

### `packages/core/src/index.ts`

```ts
export * from "./types";
export * from "./loader";
export * from "./search";
export * from "./workflow";
export * from "./progress";
export { LinkHub } from "./components/LinkHub";
export { WorkflowChecklist } from "./components/WorkflowChecklist";
```

### `packages/core/src/styles.css`

```css
:root {
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #6b7280;
  --border: #d8dee4;
  --accent: #2563eb;
  --ok: #16a34a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115;
    --fg: #e6e8eb;
    --muted: #9aa3af;
    --border: #2d333b;
    --accent: #60a5fa;
    --ok: #4ade80;
  }
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color: var(--accent); }
.abu-app { max-width: 880px; margin: 0 auto; padding: 16px; }
.abu-tabs { display: flex; gap: 8px; margin: 12px 0; }
.abu-tabs button { padding: 6px 14px; border: 1px solid var(--border); background: none; color: var(--fg); border-radius: 6px; cursor: pointer; }
.abu-tabs button[aria-selected="true"] { border-color: var(--accent); color: var(--accent); }
.abu-search { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--fg); }
.abu-list { list-style: none; padding: 0; margin: 8px 0; }
.abu-list li { padding: 6px 0; }
.abu-muted { color: var(--muted); font-size: 13px; }
.abu-wf-head { display: flex; align-items: center; gap: 12px; }
.abu-wf-head h2 { margin: 0; flex: 1; }
.abu-step { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
.abu-step.abu-done { border-color: var(--ok); }
.abu-step.abu-locked { opacity: 0.55; }
.abu-item { display: block; margin: 4px 0 4px 24px; }
.abu-chip { display: inline-block; margin: 6px 6px 0 0; padding: 2px 10px; border: 1px solid var(--border); border-radius: 999px; font-size: 13px; text-decoration: none; }
```

### `packages/core/src/search.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { searchLinks } from "./search";
import { computeStates } from "./workflow";
import { validateWorkflow } from "./loader";

const cfg = {
  categories: [
    {
      id: "build",
      name: "Build",
      links: [
        { name: "Jenkins", url: "https://j.example.com", tags: ["ci", "release"] },
        { name: "Nexus", url: "https://n.example.com", tags: ["maven"] },
      ],
    },
  ],
};

describe("searchLinks", () => {
  it("matches by tag", () => {
    expect(searchLinks(cfg, "release").map((h) => h.link.name)).toEqual(["Jenkins"]);
  });
  it("requires all tokens", () => {
    expect(searchLinks(cfg, "ci maven")).toHaveLength(0);
  });
});

describe("workflow", () => {
  const wf = validateWorkflow({
    name: "t",
    steps: [
      { id: "a", title: "A" },
      { id: "b", title: "B", depends_on: ["a"] },
    ],
  });
  it("locks dependent steps", () => {
    expect(computeStates(wf, new Set()).b).toBe("locked");
    expect(computeStates(wf, new Set(["a"])).b).toBe("ready");
  });
  it("rejects cycles", () => {
    expect(() =>
      validateWorkflow({
        name: "x",
        steps: [
          { id: "a", title: "A", depends_on: ["b"] },
          { id: "b", title: "B", depends_on: ["a"] },
        ],
      })
    ).toThrow(/cycle/);
  });
});
```

---

## `packages/abu-tech`

### `packages/abu-tech/package.json`

```json
{
  "name": "abu-tech",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@abu/core": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0",
    "vite-plugin-yaml": "^1.1.0"
  }
}
```

### `packages/abu-tech/vite.config.ts`

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import yaml from "vite-plugin-yaml";

export default defineConfig({
  plugins: [react(), yaml()],
});
```

### `packages/abu-tech/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "vite.config.ts"]
}
```

### `packages/abu-tech/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Abu Tech</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `packages/abu-tech/src/yaml.d.ts`

```ts
declare module "*.yaml" {
  const data: unknown;
  export default data;
}
```

### `packages/abu-tech/src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### `packages/abu-tech/src/App.tsx`

```tsx
import { useState } from "react";
import {
  LinkHub,
  WorkflowChecklist,
  indexLinks,
  validateLinks,
  validateWorkflow,
} from "@abu/core";
import "@abu/core/styles.css";
import linksRaw from "../content/links.yaml";
import releaseRaw from "../content/workflows/release.yaml";

// Validate at startup: bad content fails loudly instead of rendering a broken page.
const links = validateLinks(linksRaw);
const release = validateWorkflow(releaseRaw);
const linkIndex = indexLinks(links);

type Tab = "links" | "release";

export default function App() {
  const [tab, setTab] = useState<Tab>("links");

  return (
    <main className="abu-app">
      <h1>Abu Tech 🐵</h1>
      <nav className="abu-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "links"} onClick={() => setTab("links")}>
          Links
        </button>
        <button role="tab" aria-selected={tab === "release"} onClick={() => setTab("release")}>
          Release
        </button>
      </nav>
      {tab === "links" ? (
        <LinkHub config={links} />
      ) : (
        <WorkflowChecklist workflow={release} linkIndex={linkIndex} storageKey="tech-release" />
      )}
    </main>
  );
}
```

### `packages/abu-tech/content/links.yaml`

```yaml
categories:
  - id: build
    name: Build & Release
    links:
      - id: jenkins
        name: Jenkins
        url: https://jenkins.example.com
        tags: [ci, release, pipeline]
        desc: Production release pipeline
      - id: nexus
        name: Nexus
        url: https://nexus.example.com
        tags: [repository, maven, npm]
        desc: Artifact repository
  - id: planning
    name: Planning & Tickets
    links:
      - id: jira-board
        name: Jira Board
        url: https://jira.example.com/board
        tags: [tickets, sprint]
        desc: Team sprint board
      - id: change-portal
        name: Change Management Portal
        url: https://change.example.com
        tags: [change, approval, cab]
        desc: Raise and track change tickets
  - id: monitoring
    name: Monitoring
    links:
      - id: grafana
        name: Grafana
        url: https://grafana.example.com
        tags: [dashboard, metrics, post-release]
        desc: Service dashboards
```

### `packages/abu-tech/content/workflows/release.yaml`

```yaml
name: Production Release
steps:
  - id: test-signoff
    title: Test sign-off
    owner: QA
    links: [jira-board]
    checklist:
      - All release tickets verified in UAT
      - No open blocker defects
  - id: change-ticket
    title: Raise change ticket
    owner: Tech
    depends_on: [test-signoff]
    links: [change-portal]
    checklist:
      - Release notes attached
      - Rollback plan attached
  - id: approval
    title: Change approval
    owner: Manager
    depends_on: [change-ticket]
  - id: deploy
    title: Deploy to production
    owner: Tech
    depends_on: [approval]
    links: [jenkins, nexus]
    checklist:
      - Confirm release window
      - Notify Ops before starting
      - Run production pipeline
  - id: verify
    title: Post-release verification
    owner: Ops
    depends_on: [deploy]
    links: [grafana]
    checklist:
      - Smoke tests pass
      - Dashboards healthy for 30 minutes
  - id: rollback
    title: Rollback (only if needed)
    owner: Tech
    optional: true
    links: [jenkins]
```

---

## `packages/abu-ops`

`abu-ops` has exactly the same files as `abu-tech`. Create it with:

```bash
cp -r packages/abu-tech packages/abu-ops
```

Then change only:

1. `packages/abu-ops/package.json` → `"name": "abu-ops"`.
2. `packages/abu-ops/index.html` → `<title>Abu Ops</title>`.
3. `packages/abu-ops/src/App.tsx` → heading text `Abu Ops 🐵`, and `storageKey="ops-release"`.
4. `packages/abu-ops/content/links.yaml` and `content/workflows/release.yaml` → Ops tools and the Ops release-support workflow.

If the two editions start to diverge only in title and content, the next refactor is to move `App.tsx` into `core` as `<AbuApp title workflows links />`, leaving each edition with just `main.tsx` plus `content/`.
