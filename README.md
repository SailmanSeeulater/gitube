# repo-garden

Paste a GitHub repo and see how its branches fork and merge, drawn as an
Obsidian-style node graph.

- **Skeleton view** keeps branch tips, fork points, merge commits and roots, and
  collapses straight runs of commits into one edge with a `+N` badge.
- **Full view** shows every fetched commit.
- Hover a node to spotlight its neighbours; pick a branch in the side panel to
  isolate its lineage; hide branches with the eye toggle; filter stale ones.
- Everything runs in the browser against the GitHub REST API. No clone, no
  server. Add a personal access token (key icon) for private repos and a much
  higher rate limit.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Deploy

Pushes to `master` deploy to https://repogarden.latesailor.dev on the Oracle
VPS through GitHub Actions. One-time setup (DNS, nginx, the deploy key) is in
[DEPLOY.md](DEPLOY.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck + production build to `dist/` |
| `npm test` | vitest (graph engine, API client, store, UI helpers) |
| `npx tsx scripts/smoke.ts owner/repo [maxBranches]` | live fetch + graph invariants against the real API |

## How the graph is built

1. `GET /repos/{o}/{r}` for the default branch.
2. `GET /repos/{o}/{r}/branches` (paginated, capped at 200).
3. One `compare/{default}...{branch}` call per branch. It returns the merge base
   (fork point) and the branch's unique commits with parents.
4. A walk of the default branch's history, stopping once every fork point is
   connected.
5. Everything merges into one commit map; `src/graph` turns it into nodes and
   child-to-parent links, flags forks/merges/roots, colours each commit by the
   first branch that reaches it, and (in skeleton mode) collapses linear runs.

Roughly one request per branch. Unauthenticated GitHub allows 60 per hour.

## Stack

Vite 8, React 19, TypeScript 7, Tailwind v4, react-force-graph-2d (d3-force on
canvas), @octokit/rest, TanStack Query, Zustand, Vitest. See [PLAN.md](PLAN.md)
for the original design notes.
