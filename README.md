# repo-garden

Paste a GitHub repo and see how its branches fork and merge, drawn as an
Obsidian-style node graph.

- **Skeleton view** keeps branch tips, fork points, merge commits and roots, and
  collapses straight runs of commits into one edge with a `+N` badge.
- **Full view** shows every fetched commit.
- Hover a node to spotlight its neighbours; pick a branch in the side panel to
  isolate its lineage; hide branches with the eye toggle; filter stale ones.
- Ten colour themes (palette icon in the top bar): Obsidian, the original dark
  look and the default, and Midnight are dark; Paper, Slate, Sage, Sand, Rose,
  Sky, Contrast and Solar are light. Each has its own branch palette, checked
  for contrast on its canvas. The choice is saved in this browser.
- Open pull requests show on the branch tips they come from: the tip's ring
  splits into review (left) and checks (right), green, amber or red (broken),
  dotted for a draft. Click a tip for the details; `is:pr`, `checks:failing`,
  `review:approved` and the like narrow the branch list. A repo without pull
  requests looks exactly as before.
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

Open pull requests come after the graph (`src/api/pulls.ts`). Without a token:
`GET /repos/{o}/{r}/pulls` (1 request per 100 open pull requests, at most 3),
skipped below 5 requests left; a pull request's review and checks cost 2 or 3
more and are read when its tip is opened, while at least 15 are left. With a
token: one GraphQL query per 40 branches, review and checks included, and no
REST requests. Pull requests from forks have no branch here and are not drawn.
They are never cached or saved.

## Stack

Vite 8, React 19, TypeScript 7, Tailwind v4, react-force-graph-2d (d3-force on
canvas), @octokit/rest, TanStack Query, Zustand, Vitest. See [PLAN.md](PLAN.md)
for the original design notes.
