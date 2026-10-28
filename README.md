# repo-garden

Paste a GitHub repo and see how its branches fork and merge, drawn as an
Obsidian-style node graph. Paste a GitHub login instead and see that person's
whole coding life ([person mode](#person-mode)).

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
- **Person mode**: a login (`octocat`, `@octocat` or `github.com/octocat`)
  grows one user's repos over time, as a garden, life lines or a
  constellation, or in four console looks (phosphor, htop, git log, minimap),
  with its own time-lapse, poster and share link.
- Everything runs in the browser against the GitHub API (REST, plus GraphQL
  once a token is set). No clone, no server. Add a personal access token (key
  icon) for private repos, a much higher rate limit and, in person mode, the
  commits GitHub counted.

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
| `npm test` | vitest (graph engine, API clients, store, UI helpers, person mode) |
| `npx tsx scripts/smoke.ts owner/repo [maxBranches]` | live fetch + graph invariants against the real API |
| `npx tsx scripts/smoke-profile.ts <login> [--token-env NAME]` | live person-mode fetch + sanity checks: repo count, requests spent, the span; with `--token-env` it reads a token from the environment variable `NAME` (never printed), runs the GraphQL tier (falling back to REST as the app does, and saying so) and prints contributions per year to hold against the github.com profile. Exits 3 on a core rate limit, without retrying (a GraphQL limit falls back instead) |

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

## Person mode

Type a GitHub login where a repo goes (`octocat`, `@octocat`, or a
`github.com/octocat` link), or open `?user=octocat`, with `&view=garden`,
`&view=lines`, `&view=constellation`, `&view=phosphor`, `&view=htop`,
`&view=gitlog` or `&view=minimap` to pick the view. It grows one user's
coding life: when each repo was born, when it was busy, when it went quiet,
which languages led when, and their milestones (joining GitHub, the first
repo, the most starred one, language switches, and with a token the first pull
request, the first issue and the longest streak). `owner/repo` in the same
input goes back to the repo garden. An organization is not a user: its login
shows "that's an organization" (a bot's, "that's a bot"), and its repos still
grow as `owner/repo`. A user with no repos to show gets a note saying so,
with "add a token" when a token would show more.

Seven views, picked in the side panel (the life views on its first row, the
console views on its second), paint the same life on one canvas and share the
panel, the inspector (hover a repo or a day), the theme, the
time-lapse and the poster:

- **garden** (the default): time runs left to right along a horizon. Each repo
  is a plant rooted where the person's part in it starts (its birth for their
  own repos, their first counted day, with a ring at its root, for one they
  only contributed to). Its height is the commits GitHub counted, or without a
  token how long it was active; leaves mark its active spans, a bloom its
  stars. Archived repos are dry, forks are cuttings.
- **lines**: each repo is a line along the time axis, thick while active and
  thin while dormant, with milestones as stations and the leading language of
  each stretch as bands behind.
- **constellation**: each repo is a star, placed by when the person's part in
  it starts (across) and its language (down), sized by activity, glowing by
  stars, with faint links between repos active in the same months.

The console views keep their own terminal colours whatever the theme (the
labels, the time-lapse caption and the poster follow them):

- **phosphor**: a green CRT screen with scanlines; each repo is a stack of
  blocks rising where the person's part in it starts, as tall as a garden
  plant, its head brighter for stars.
- **htop**: a system monitor; each repo is a numbered row whose meter is lit
  where it was active, brighter for busier stretches.
- **git log**: like `git log --graph`; each repo is a branch forking off the
  trunk where the person's part in it starts, with commit dots and a short
  hash (from its dates, never its name).
- **minimap**: a code editor; each repo is a numbered line whose syntax-coloured
  tokens are its active spans, with a minimap strip of every line at the right.

The side panel also holds the repo list (search, hide, pick one to spotlight
it), the milestones, and the legend, which ends with what GitHub's data leaves
out (below). The status strip shows the repos, the years and, with a token,
the contributions; after a live fetch, the GitHub requests left this hour;
and "add a token for commits" when none is set.

- **Time-lapse**: "watch it grow" in the status strip replays the life from
  its first day (the account's creation, or earlier backdated commits) to
  today, in the view on show. Each month with any activity gets the same share
  of the play and a quiet one a tenth of it, so quiet years do not play as
  dead air. Play, pause, scrub, pick a length (10 to 60 seconds), and rec
  saves the play as a silent video (WebM, mp4 in Safari),
  `<login>-life-timelapse-<day>`.
- **Poster**: the poster button in the panel, or Save image in the top bar,
  saves a PNG of the view on show, fully grown, framed with the avatar, the
  login, the span of years and the top three milestones:
  `<login>-life-poster-<day>.png`. Person mode has no Save data: the garden
  file format is the repo garden's.
- **Share link**: the address bar names the user and the view
  (`?user=<login>&view=<view>`), and the copy-link button in the panel copies
  it. Nothing hidden, picked or revealed goes into it.

**Private repos.** A profile can hold private repos: your own, on your own
login with a token that can read them, or one the person contributed to that
your token can see. Their names are hidden by default, everywhere on the
page: "private repo" with a lock, and the panel's search matches only what is
shown, so a name cannot be found by guessing it. The panel's toggle shows them
on this screen, for this login only; a reload, a new grow or leaving person
mode hides them again. A poster or a recording shows names as the screen shows
them when it is made (the toggle stays put while a recording runs and saves),
and their file names carry only the login. No link, address bar or analytics
event ever carries a repo name.

**Cache.** A profile fetched in this browser within a day shows again at no
API cost (IndexedDB, in its own `repo-garden-profiles` database, six profiles
at most). Grow on the person on show, or refresh in the status strip, fetches
it again from GitHub. Copies fetched with and without a token are kept apart,
so adding a token never serves the tokenless copy, and a copy fetched with a
token is never shown without one.

### Two tiers

Both tiers start with `GET /users/{login}` over REST (1 request), which
settles a login that does not exist, or is an organization or a bot, before
anything else.

**Without a token: REST, 3 to 9 requests.** After the identity call:

1. `GET /users/{login}/repos?type=owner&sort=created&direction=asc`, 100 a
   page, at most 5 pages: the user's own public repos, the oldest 500.
2. `GET /users/{login}/events/public`, at most 3 pages (GitHub keeps 300
   events), for the days they pushed. If these fail, the profile stands
   without them.

They come out of the same anonymous 60 an hour that the repo garden spends.
Each repo is one span, from its creation to its last push, and the last 30 or
so days add pushes per repo per day.

**With a token: GraphQL, about one query per year of account age.** After the
identity call, one query lists the years the user contributed in and their own
repos (one more per 100 repos, up to 500), private ones too when the login is
your own and the token can read them. Then the contributions are read in
calendar quarters, four to a query (one query per year since the first year
they contributed in), one query after another. A query GitHub is too slow for
is asked again in halves, down to one quarter (still too slow, and the
fallback below takes over). A quarter that comes back with an error is asked
once more on its own; if that fails too, the quarter keeps whatever came back
for it, counts as cut short, and the legend names it. This tier adds the contribution calendar day by day, commits per repo per
day, the repos they only contributed to (up to 100 a quarter), and the first
pull request and issue. GraphQL spends the token's GraphQL points, not the core
budget the requests-left counter shows.

**The fallback.** With a token, GraphQL failing does not lose the profile:
when it refuses the token, hits a GraphQL rate limit (primary or secondary),
still times out after the halving, or answers with anything unexpected, the
profile is read with the same REST plan as without a token (the token's 5000
an hour paying for it), and the status strip says why
("GraphQL limit reached until 14:05; showing the public profile", with "try
again"). A profile filled this way is not cached, so the next grow tries
GraphQL again. There is no fallback when the REST identity call itself fails:
an abort, a network error, a token GitHub rejects (an expired or revoked one),
a core rate limit (REST would hit the same wall), or a login that is not found
or not a user. Those show their error card.

### Limits

What GitHub's data leaves out, as each view's legend lists it:

- Without a token there are no commit counts. A repo is one span from its
  creation to its last push, recent activity is pushes per repo per day (since
  2025-10-07 a push event carries no commit count), and GitHub keeps only about
  30 days of events, so the days before them are unknown, not quiet. Only the
  user's own public repos show: repos they only contributed to, and private
  ones, need a token.
- With a token, GitHub counts a commit only on a repo's default branch (or
  `gh-pages`), made with an email linked to the account, and not in a fork.
  The user's own repos show even with no counted commits.
- Contributions to private repos count only with a token that has `read:user`
  and can see the repo. Otherwise GitHub gives only their number, and only if
  the user shares it; the legend says how many.
- Days are GitHub's, in US Pacific time, not the viewer's time zone.
- GitHub's GraphQL calendar can differ from the count on the github.com profile
  by a few contributions a year.
- Caps: 500 own repos in either tier, and with a token 100 repos a quarter. A
  profile cut short says so ("profile truncated" in the status strip, and the
  legend names any quarter lost).

## Analytics

The live site counts visits with Umami, self-hosted at `stats.latesailor.dev`.
The tracker sets no cookies and writes nothing to the browser's storage.

**What reaches Umami**

Each pageview and each event is one request to `stats.latesailor.dev`
carrying:

- The page as its origin only, `https://repogarden.latesailor.dev/`: never
  the path, the query string or the fragment. A share link keeps its repo,
  contributors and battle (or its user and view) in the query string, so a
  pageview says someone opened repo-garden, not what they looked at. The app
  rewrites the query string as you click; those rewrites are not pageviews.
- The referrer, cut down: `/` when the visitor came from this site, the
  origin alone (`https://github.com`, say) when from another site, empty when
  there is none. Only the pageview, and events sent before the app first
  rewrites the address bar, carry another site's origin: the tracker takes
  each rewrite for a move within the site, so later events carry `/`.
- The screen size, the browser's language, the page title (always
  `repo-garden`), the hostname (`repogarden.latesailor.dev`) and the website
  ID.
- For an event, its name and data: the events in the two tables below, and no
  others.

The repo garden sends these:

| Event | Data | Sent when |
|---|---|---|
| `grow` | `mode: 'repo'`, `branches` (a bucket: `1`, `2-5`, `6-20`, `21-50`, `51-100`, `101+`), `cached`, `token`; `repo` only for a live fetch without a token | the repo on show was grown or refreshed (Grow, an example chip, opening a share link, the refresh button in the status strip or the inspector) and its data arrived, from GitHub or the cache: once per request. Not for a battle challenger, a token change, a background refetch or an opened file; a request that fails sends `fetch-error` instead |
| `layout-switch` | `layout`: `organic`, `metro` or `garden` | another layout is picked in the side panel |
| `theme-switch` | `theme`: the theme's id (`obsidian`, `paper`, ...) | once when the theme picker closes on a different theme than it opened with, naming that one; themes tried on the way do not count |
| `view-mode` | `view`: `skeleton` or `full` | another view is picked in the side panel |
| `timelapse-play` | none | the time-lapse is opened |
| `export` | `format`: `png` (Save image), `webm` (the time-lapse recording, also when Safari records mp4), `json` (Save data) or `garden-file` | a file is saved: an image or the data from the export menu, or a time-lapse recording when it stops; or a saved garden file is opened (`garden-file`) |
| `battle-start` | none | a battle is started from the side panel (not when a share link opens one) |
| `pr-overlay` | `state`: `on` when open pull requests put rings on tips, `off` when they put none | once per answer from GitHub about the repo's open pull requests (there is no overlay toggle); looking up one pull request's review and checks does not count |
| `share-copy` | none | the share link is copied |
| `token-added` | none | a new token is saved in the key field, replacing one included (clearing it sends nothing) |
| `fetch-error` | `code`: the `GitHubFetchError` code (`not_found`, `rate_limited`, `unauthorized`, ...) | the repo on show fails to load: the code only, no message and no repo |

Person mode sends these (`src/profile/analytics.ts` has the `grow` rules):

| Event | Data | Sent when |
|---|---|---|
| `grow` | `mode: 'person'`, `source`: `rest` or `graphql` (the tier that filled the profile, so `rest` after a GraphQL fallback), `cached`, `token` (whether the profile was fetched with a token, read from the fetch result, not the token set now); `login` only for a live fetch without a token | the person on show was grown or refreshed (a login typed in either input, the same one again included, a `?user=` link, refresh or "try again" in the status strip) and the profile arrived, from GitHub or the cache: once per request. Not for a token change, a background refetch or a view switch; a request that fails sends nothing |
| `view-switch` | `view`: `garden`, `lines`, `constellation`, `phosphor`, `htop`, `gitlog` or `minimap` | another view is picked in the side panel |
| `timelapse-play` | none | the time-lapse is opened ("watch it grow") |
| `export` | `format: 'webm'`, also when Safari records mp4 | a time-lapse recording is saved; the only `export` person mode sends |
| `poster-export` | none | a poster is saved (the panel's poster button, or Save image in the top bar), after its download; a save that fails sends nothing |
| `share-copy` | none | the panel's copy-link button copies the link |
| `theme-switch` | `theme`, as above | the top bar's theme picker, as in the repo garden |
| `token-added` | none | the top bar's key field, as in the repo garden |

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
  links carry repo names, contributor logins, battle repos or a user's login,
  and with a token the repos can be private. The tracker is told to drop the
  query string and the fragment (`data-exclude-search`, `data-exclude-hash`),
  and the function it calls before every send (`data-before-send`,
  `beforeSend` in `src/analytics/umami.ts`) cuts the page URL down to the
  origin and the referrer down to `/` or its origin, so no path or query
  string goes out even if those attributes ever stop working. No `Referer`
  carries them either: the script is fetched with `no-referrer`, and the
  site's `Referrer-Policy` sends only the origin to other hosts.
- An event names a repo or a login only when the data was fetched without a
  token, which proves it public. With a token set, events carry no names, only
  counts and modes: `track()` drops the `repo` and `login` keys whatever the
  caller passed. A copy from the cache is never named either, since it may
  have been fetched with a token since removed. In person mode `grow`'s
  `login` is the only name any event carries: none names a repo, even while
  the privacy toggle shows private names on screen.
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
for the original design notes and [PROFILE_SPEC.md](PROFILE_SPEC.md) for person
mode's.
