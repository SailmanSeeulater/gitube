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
  splits into review (left) and checks (right), green, amber (half lit) or red
  (broken), dotted for a draft; until they are looked up both halves keep the
  tip's own colour. Click a tip for the details; `is:pr`, `checks:failing`,
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
skipped below 5 requests left; a pull request's review and checks cost 3 more
(check runs, commit statuses, reviews) and are read when its tip is opened,
while at least 15 are left. With a token: one GraphQL query per 40 branches,
review and checks included, plus one per page for a branch with more than 5
open pull requests (often a default branch that bots sync into forks), and no
REST requests. Pull requests from forks have no branch here and are not drawn.
They are never cached or saved.

## Analytics

The live site counts visits with Umami, self-hosted at `stats.latesailor.dev`.
The tracker sets no cookies and writes nothing to the browser's storage.

**What reaches Umami**

Each pageview and each event is one request to `stats.latesailor.dev`
carrying:

- The page as its origin only, `https://repogarden.latesailor.dev/`: never
  the path, the query string or the fragment. A share link keeps its repo,
  contributors and battle in the query string, so a pageview says someone
  opened repo-garden, not what they looked at. The app rewrites the query
  string as you click; those rewrites are not pageviews.
- The referrer, cut down: `/` when the visitor came from this site, the
  origin alone (`https://github.com`, say) when from another site, empty when
  there is none. Only the pageview, and events sent before the app first
  rewrites the address bar, carry another site's origin: the tracker takes
  each rewrite for a move within the site, so later events carry `/`.
- The screen size, the browser's language, the page title (always
  `repo-garden`), the hostname (`repogarden.latesailor.dev`) and the website
  ID.
- For an event, its name and data: these events, and no others, from the
  repo garden (person mode adds its own; see `PROFILE_SPEC.md`).

| Event | Data | Sent when |
|---|---|---|
| `grow` | `mode: 'repo'`, `branches` (a bucket: `1`, `2-5`, `6-20`, `21-50`, `51-100`, `101+`), `cached`, `token`; `repo` only for a live fetch without a token | the repo on show was grown or refreshed (Grow, an example chip, opening a share link, the refresh button in the status strip or the inspector) and its data arrived, from GitHub or the cache: once per request. Not for a battle challenger, a token change, a background refetch or an opened file; a request that fails sends `fetch-error` instead |
| `layout-switch` | `layout`: `organic`, `metro` or `garden` | another layout is picked in the side panel |
| `theme-switch` | `theme`: the theme's id (`obsidian`, `paper`, ...) | once when the theme picker closes on a different theme than it opened with, naming that one; themes tried on the way do not count |
| `view-mode` | `view`: `skeleton` or `full` | another view is picked in the side panel |
| `timelapse-play` | none | the time-lapse is opened |
| `export` | `format`: `png` (Save image), `webm` (the time-lapse recording, mp4 in Safari), `json` (Save data) or `garden-file` | a file is saved: an image or the data from the export menu, or a time-lapse recording when it stops; or a saved garden file is opened (`garden-file`) |
| `battle-start` | none | a battle is started from the side panel (not when a share link opens one) |
| `pr-overlay` | `state`: `on` when open pull requests put rings on tips, `off` when they put none | once per answer from GitHub about the repo's open pull requests (there is no overlay toggle); looking up one pull request's review and checks does not count |
| `share-copy` | none | the share link is copied |
| `token-added` | none | a new token is saved in the key field, replacing one included (clearing it sends nothing) |
| `fetch-error` | `code`: the `GitHubFetchError` code (`not_found`, `rate_limited`, `unauthorized`, ...) | the repo on show fails to load: the code only, no message and no repo |

Umami also gets what any server gets: the visitor's IP address, the browser's
User-Agent, and a `Referer` header holding the site's origin only. From the IP
address and the User-Agent it works out the country, region and city, the
browser, the OS and the device type. No cookie goes with any of it: the
script is fetched with CORS (`crossorigin="anonymous"`, which the server
allows) and the reports omit credentials. The one thing the tracker reads from the browser's
storage is `umami.disabled` in localStorage, which turns it off (below); the
visit token Umami answers with is kept in memory and sent back only with that
page's later requests.

**The privacy rules**

- Umami never gets the GitHub token, the query string or the URL path. Share
  links carry repo names, contributor logins and battle repos, and with a
  token those can be private. The tracker is told to drop the query string
  and the fragment (`data-exclude-search`, `data-exclude-hash`), and the
  function it calls before every send (`data-before-send`, `beforeSend` in
  `src/analytics/umami.ts`) cuts the page URL down to the origin and the
  referrer down to `/` or its origin, so no path or query string goes out even
  if those attributes ever stop working. No `Referer` carries them either: the
  script is fetched with `no-referrer`, and the site's `Referrer-Policy` sends
  only the origin to other hosts.
- An event names a repo or a login only when the data was fetched without a
  token, which proves it public. With a token set, events carry no names, only
  counts and modes: `track()` drops the `repo` and `login` keys whatever the
  caller passed. A copy from the cache is never named either, since it may
  have been fetched with a token since removed.
- Every value is checked on the way out, and again in `beforeSend`: anything
  that looks like a token or a query string is dropped, and strings are cut
  to 50 characters.
- Do Not Track is honoured (`data-do-not-track`), and only
  `repogarden.latesailor.dev` is counted (`data-domains`): local builds (unless
  made with `VITE_UMAMI_DOMAINS`, below) and copies of the site on other hosts
  send nothing. To stop counting your own visits, run
  `localStorage.setItem('umami.disabled', '1')` in the console on the live
  site.

**Setup**

- The website ID lives in `.env.production` as `VITE_UMAMI_WEBSITE_ID`. It is
  not a secret: every visitor's page carries it. Empty means analytics off.
  The tracker is only added in a production build (`import.meta.env.PROD`)
  with a valid UUID as the ID, so `npm run dev` never loads it.
- The tracker is not bundled. `initAnalytics()` adds
  `https://stats.latesailor.dev/script.js` once the page has loaded, so the
  app's own files never wait on it. Events from before it has loaded wait for
  it: the first 20 are kept (any more are dropped) and sent in order once it
  loads, each checked again then, so a token added in the meantime still
  drops names. If the script fails to load, or something blocks it, they are
  dropped. Where `initAnalytics()` adds no tracker, `track()` does nothing.
- `VITE_UMAMI_DOMAINS` (comma-separated hostnames) replaces
  `repogarden.latesailor.dev` as the hostnames to count. It is only for
  checking a local production build:
  `VITE_UMAMI_DOMAINS=localhost npm run build && npm run preview`, then open
  http://localhost:4173. Like the ID it is read at build time, so never set it
  for the deployed build: the live site would count nothing. The events from
  such a check land in the live stats.
- The site's Content-Security-Policy must allow `stats.latesailor.dev`
  (`script-src` and `connect-src`). The deploy only ships `dist/`, so the
  updated headers snippet goes to the VPS by hand, once, before merging:
  [DEPLOY.md, step 6](DEPLOY.md#6-analytics-umami-update-the-headers-snippet-before-merging).
  The deploy's smoke test fails if the live policy does not list it.

## Stack

Vite 8, React 19, TypeScript 7, Tailwind v4, react-force-graph-2d (d3-force on
canvas), @octokit/rest, TanStack Query, Zustand, Vitest. See [PLAN.md](PLAN.md)
for the original design notes.
