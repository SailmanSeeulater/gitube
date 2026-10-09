# repo-garden — stack plan

Paste a GitHub repo URL, get an Obsidian-style node graph of how its branches
fork from and merge back into each other.

## 1. What the graph shows

| Thing | Node / edge | Visual |
|---|---|---|
| Commit | node | small dot, sized by how many branches contain it |
| Branch tip | node | larger dot with the branch name as a label |
| Parent link | edge | child → parent |
| Fork point | node with 2+ children | highlighted ring |
| Merge commit | node with 2+ parents | highlighted ring |
| Branch "ownership" | node color | the branch whose tip reaches the commit first |

Two zoom levels, like Obsidian's local vs global graph:

- **Skeleton view (default)**: only branch tips, fork points and merge points.
  Linear runs of commits collapse into a single edge labelled with the count
  ("+14"). A repo with 60 branches becomes ~150 nodes, which is readable.
- **Full view**: every fetched commit. Toggle per branch or globally.

Interactions borrowed from Obsidian: force-directed layout, drag nodes, scroll to
zoom, hover a node to dim everything not connected, click a tip to isolate that
branch's lineage, search box to find a branch, filter by author / date / stale
branches.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Build / framework | **Vite + React 19 + TypeScript** | v1 has no server, so Next.js buys nothing. Fast dev loop, static output. |
| Styling | **Tailwind CSS v4** | Quick dark theme in the Obsidian palette; no component library needed. |
| Graph rendering | **react-force-graph-2d** (d3-force + canvas) | Same layout engine family Obsidian uses. Canvas handles thousands of nodes; exposes node hover, click, custom paint. Drop to **Sigma.js + graphology** only if graphs exceed ~10k nodes. |
| Data source | **GitHub REST API via `@octokit/rest`**, called from the browser | No clone, no backend, no cold starts. Works unauthenticated for public repos (60 req/hr); user can paste a personal access token to unlock 5000 req/hr and private repos. Token stays in `localStorage`. |
| Server state | **TanStack Query** | Caching, request dedup, retries and progress state for the per-branch fetches. |
| UI state | **Zustand** | Selected branch, filters, view mode, token. |
| Graph building | plain TypeScript module, unit-tested with **Vitest** | Pure function: `commits[] -> {nodes, links}`; easy to test fork/merge detection. |
| Deploy | **Vercel or GitHub Pages** (static) | Nothing to run. |

### Phase 2 (only if needed): optional backend

If users want huge repos or repos the API paginates poorly, add a small
**Hono** server (Node) that shallow-clones with **isomorphic-git** into a temp
dir and runs the same graph build server-side. Same JSON contract as the
browser path, so the front end does not change. Not in v1.

## 3. Data pipeline (browser only)

1. Parse URL → `owner/repo`.
2. `GET /repos/{o}/{r}` → default branch.
3. `GET /repos/{o}/{r}/branches?per_page=100` (paginate) → branch names + tip SHAs.
4. For each branch: `GET /repos/{o}/{r}/compare/{default}...{branch}`.
   One call returns the merge-base (fork point) and every commit unique to that
   branch, with parents. This is the cheapest way to get the branching
   structure: ~1 request per branch instead of walking history.
5. `GET /repos/{o}/{r}/commits?sha={default}&per_page=100` for the trunk itself
   (a few pages, capped at e.g. 500 commits).
6. Merge everything into `Map<sha, Commit>`; dedupe.
7. `buildGraph()`:
   - edges = child→parent for every parent SHA present in the map
   - children count per node → fork points
   - parents count → merge commits
   - color: BFS from each tip in branch order; first visitor wins
   - skeleton mode: contract any node with exactly 1 parent and 1 child
     into its neighbours' edge, carrying a `collapsedCount`.
8. Hand `{nodes, links}` to the force graph. Pin trunk tips on a loose
   left→right axis by commit date so time reads roughly left to right.

Budget: a repo with 80 branches costs ~85 requests. Fine with a token,
borderline without one, so show a request counter and a "add token" nudge
when the remaining budget is low.

Optional later: GitHub GraphQL to batch 20 branches per request. Requires a
token always, so keep REST as the no-token path.

## 4. Project layout

```
repo-garden/
  src/
    api/github.ts          octokit wrapper, pagination, rate-limit reader
    graph/build.ts         commits -> nodes/links (pure)
    graph/collapse.ts      skeleton-mode contraction (pure)
    graph/color.ts         branch ownership + palette
    store/                 zustand slices
    components/
      RepoInput.tsx
      Garden.tsx           react-force-graph wrapper + custom node paint
      Sidebar.tsx          branch list, filters, legend
      NodeInspector.tsx    commit details on click
    App.tsx
  tests/                   vitest for graph/*
  PLAN.md
```

## 5. Build order

1. Scaffold Vite + React + TS + Tailwind. Dark shell with a URL input.
2. `api/github.ts` with branches + compare + commits, progress events.
3. `graph/build.ts` + tests on a hand-made commit fixture (fork, merge, diamond).
4. Render full view in react-force-graph. Get colors and labels right.
5. Skeleton collapse + toggle. This is the step that makes it look like Obsidian
   instead of a hairball.
6. Hover dimming, click-to-isolate, search, stale-branch filter.
7. Token input, rate-limit UI, error states (404, private, API limit).
8. Deploy static build.

## 6. Risks and limits

- **Unauthenticated rate limit (60/hr)** caps you at roughly 50 branches per
  hour. Mitigate with token input and caching results in IndexedDB keyed by
  repo + tip SHAs.
- **Commits older than the fetch cap** are missing, so very old fork points can
  appear as dangling roots. Label them "history truncated" rather than hiding.
- **Deleted branches** are invisible to the API. Only live refs are shown;
  say so in the legend.
- **Giant monorepos** (thousands of branches) are a Phase 2 backend problem.
