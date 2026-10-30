# repo-garden — Person mode: Build Spec

> **For Claude Code:** This is the full spec for a new feature in the existing repo-garden app.
> Build it **phase by phase**. At the end of each phase, stop, summarize what was built, list how to
> verify it, and wait for a go-ahead before starting the next phase. Work on the branch
> `feat/person-mode` (cut from `master`), commit at the end of every phase, and open a PR only when
> told to. Read `README.md`, `PLAN.md` and `src/types.ts` before Phase 0.

## 1. What it is

Today repo-garden grows **one repo** (`?repo=owner/repo`). Person mode grows **one GitHub user's
whole coding life** (`?user=login`): when each repo was born, when it was busy, when it went quiet,
how their languages shifted, and their milestones, drawn in the same themes and with the same
time-lapse, export and share features the repo garden already has.

It is a second *subject* in the same app, not a new app. Same Vite/React/TS stack, same theme
system (`src/theme`), same token handling, same browser-only rule (no server), same deploy.

### Non-goals for v1
- Organizations as the subject (users only; an org login gets a friendly error).
- A backend or proxy. Everything stays in the browser against `api.github.com`.
- Person-vs-person battle, and overlaying Claude Code session logs. Both are v2 ideas; keep the
  data model open to them but do not build them.

## 2. Data: two tiers

GitHub's GraphQL API always needs a token (an anonymous `POST /graphql` gets HTTP 403 with
`x-ratelimit-limit: 0`), so person mode has a no-token tier on REST and a richer tier on GraphQL
when the visitor has added a token (the existing key icon). Both produce the same `ProfileData`
shape; the views never care which tier filled it, they only read `profile.source`.

Both tiers start with the same REST identity call:
`GET /users/{login}` → `login` (GitHub's casing), name, avatar, `created_at`, `type`. Anything but
`type === 'User'` (an `Organization`, a `Bot`) is `not_a_user`. Tier 2 makes this call over REST
too: one identity path serves both tiers and the fallback, and it settles `not_found` and
`not_a_user` before any GraphQL refusal or limit can hide them. (GraphQL's `user(login)` answers
`NOT_FOUND` for an organization and a missing login alike; `repositoryOwner(login) { __typename }`
could tell them apart but is not used.)

### Tier 1 — no token (REST, 3 to 9 requests)
1. The identity call above.
2. `GET /users/{login}/repos?type=owner&sort=created&direction=asc&per_page=100` (paginate with
   `hasNextLink`, cap 5 pages = 500 repos; `direction=asc` because the default for `sort=created`
   is newest first, which would make the cap drop the start of the career) → per repo: name,
   `created_at`, `pushed_at`, `language`, `stargazers_count`, `forks_count`, `fork`, `archived`.
3. `GET /users/{login}/events/public?per_page=100` (at most 3 pages; GitHub keeps 300 events and
   answers page 4 with HTTP 422) → push days only. GitHub keeps **30 days** of events, and since
   2025-10-07 a `PushEvent` carries no commit list or count, so this tier records pushes per repo
   per day, not commits. Optional: an events failure leaves `recent` empty and the profile stands.

These requests come out of the same anonymous 60 an hour (per IP) that repo mode spends, about one
per branch.

Each repo's activity in this tier is a span from `created_at` to `pushed_at`, no inner detail.
`pushed_at` may be null, and a fork's can be earlier than its `created_at` (it keeps the parent's
push time): the span ends at `max(created_at, pushed_at ?? created_at)`.

### Tier 2 — token (GraphQL `POST /graphql`, about 1 query per year of account age)
1. The identity call above (1 core request).
2. One query: `user(login) { contributionsCollection { contributionYears }
   repositories(ownerAffiliations: OWNER, first: 100, orderBy: {field: CREATED_AT, direction: ASC})
   { nodes { nameWithOwner createdAt pushedAt isFork isArchived isPrivate stargazerCount forkCount
   primaryLanguage { name color } } pageInfo { hasNextPage endCursor } } }` plus
   `rateLimit { cost remaining resetAt }`; more `repositories` pages up to 500 repos. This lists the
   user's own repos even when GitHub counted no commits to them (unlinked email, work off the
   default branch, forks). With a repo-scoped token on one's own login it also lists private repos.
3. Contribution windows: calendar quarters from January 1 of the earliest of `contributionYears`
   (which can precede `createdAt`: backdated commits count) up to today. A quarter that starts
   after `now` is not asked for, and the current quarter's `to` is `now` (GitHub otherwise returns
   zero-count calendar days up to the quarter's end). Each window is **its own
   `user(login)` alias** (`w2019q1: user(login: $login) { contributionsCollection(from, to) { … } }`),
   because everything below `user` is non-null: an error anywhere in a window nulls its enclosing
   `user`, so windows that shared one `user` would all be lost together. Per window:
   - `contributionCalendar { weeks { contributionDays { date contributionCount } } }`
   - `commitContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner createdAt
     pushedAt isFork isArchived isPrivate stargazerCount forkCount primaryLanguage { name color } }
     contributions(first: 100) { nodes { occurredAt commitCount } pageInfo { hasNextPage } } }`
   - `pullRequestContributionsByRepository(maxRepositories: 100) { repository { …the same fields }
     contributions(first: 100) { nodes { occurredAt pullRequest { merged mergedAt } } pageInfo
     { hasNextPage } } }` ("landed elsewhere"; field names checked against the live schema on
     2026-10-28): one node per pull request opened in the window (`occurredAt` is when it was
     opened). The merged ones into repos whose owner is not the user (the owner part of
     `nameWithOwner`, compared without case) become `landed`, each on the GitHub day of its
     `mergedAt`, which can fall in a later window. A repo named only here joins `repos` as one they
     only contributed to (`isOwn` false, no activity), from its first landed day to its last; one
     with counted commits too starts at the earlier of the two and ends at the later. Private
     repos are kept: the namer hides their names like any other's. A window still paging its pull
     requests, or returning 100 repositories of them, sets `truncated`.
   - `firstPullRequestContribution`, `firstIssueContribution`, `firstRepositoryContribution` (unions:
     select through `... on Created…Contribution { occurredAt … }` and
     `... on RestrictedContribution { occurredAt }`), `joinedGitHubContribution { occurredAt }`,
     `restrictedContributionsCount`
   - `rateLimit { cost remaining resetAt }` once per query.

   `contributions` has one node per repo per day, so a quarter (at most 92 days) fits in one page
   of 100: no follow-up pagination. A single repo's contributions cannot be paged on its own anyway
   (`CommitContributionsByRepository` takes no repository argument and its cursor is shared). A
   window that still reports `hasNextPage`, or returns exactly 100 repositories, sets `truncated`.
   `from`/`to` must span at most a year, and `to` is inclusive: a window ends 1 ms before the next
   one starts. The `first*Contribution` fields are null outside their window: keep the earliest
   non-null one across windows.
4. Batches: 4 windows (one year) per query, sent one after another. On a timeout, 502 or 504, the
   batch is retried in halves, down to one window (GitHub stops a query after 10 s). Live checks:
   every batch costs 1 point whatever its size (8 windows: nodeCount 800), but duration is the
   limit: 8 windows took 1.3 s for torvalds (one repo a quarter) and up to 9.9 s for sindresorhus
   (100 repos a quarter), and one such run passed 10 s and came back empty.

**Before writing the fetcher, verify this plan against the live schema** (one real query with the
dev token) and record the responses as fixtures in `tests/fixtures/github/`, like the pull request
fixtures there (`replay-cache/` is not checked in, and tests that need it skip in CI). Record them
with a token without `read:user`, or for a public account that shares no private repo or org with
the token's owner, so no private repo names land in the repo (restricted counts are public and may
stay). Adjust this spec if the schema differs; do not guess.

Known limits to surface in the UI legend, not hide:
- GitHub only counts commits on a repo's default branch (or `gh-pages`), made with an email linked
  to the account, and not in forks.
- Contributions in private repos are only included with the `read:user` scope. Viewers without
  read access to the repo see them only as `restrictedContributionsCount`, and only if the user
  shares private contribution counts; otherwise private work does not show at all. Viewers with
  access (oneself, or a collaborator or org member, with `read:user`) see them in full, names
  included.
- Days are GitHub's: a contribution's `occurredAt` is midnight US Pacific time. Day keys come from
  the calendar's `date` strings (or `occurredAt` read in `America/Los_Angeles`), never the viewer's
  time zone.
- GitHub's GraphQL calendar can differ from the github.com heading by a few contributions a year,
  and a day's count can vary with the span of the query window that read it. Seen live: torvalds
  was short by 1 to 3 in 3 of 16 years; kepano's 2019 sums to 145 over quarter windows against 147
  over a whole-year window (2019-04-08 reads 1 in its quarter, 3 in its year).
- CSP needs no change: GraphQL is `https://api.github.com/graphql`, already allowed by
  `connect-src`. The poster draws the avatar through an `<img crossOrigin="anonymous">` (the avatar
  host sends `access-control-allow-origin: *`); a `fetch()` of it would be blocked.

### Privacy rule
When the profile holds any repo with `isPrivate: true` (a token owner looking at themselves, through
`repositories`, or any viewer with access to a private repo the user contributed to), private repo
names are **hidden by default** in the view, in
exports and in share links, shown as "private repo" with a lock. A toggle in the panel reveals them
on screen only; exports always respect the toggle's current state and the toggle resets to hidden
on reload.

## 3. Contracts (add to `src/types.ts`)

In the style of `src/types.ts`: JSDoc comments, no `readonly`, `T | null`. Timestamps are ISO 8601;
day keys are `'YYYY-MM-DD'` (GitHub's days, see section 2).

```ts
export interface ProfileRepo {
  nameWithOwner: string
  /** ISO: when the repo was created on GitHub */
  createdAt: string
  /** ISO: when this person's part in it starts: createdAt for their own repos, their first counted or landed day otherwise */
  firstActiveAt: string
  /** ISO: max(createdAt, pushedAt) in tier 1; the last contribution or landed day (or pushedAt) in tier 2 */
  lastActiveAt: string
  /** owned by the user; false for a repo they only contributed to (tier 2) */
  isOwn: boolean
  language: string | null
  /** GitHub's linguist colour, tier 2 only. Not painted: views colour languages from the theme. */
  languageColor: string | null
  stars: number
  forks: number
  isFork: boolean
  isArchived: boolean
  isPrivate: boolean
  /** Tier 2: commits per day, ascending. Tier 1: empty. */
  activity: { date: string; commits: number }[]
}

export interface ProfileMilestone {
  kind: 'joined' | 'first-repo' | 'first-pr' | 'first-issue' | 'top-repo' | 'longest-streak' | 'language-switch'
  /** ISO */
  date: string
  label: string
  repo?: string
}

export interface ProfileData {
  /** as GitHub spells it */
  login: string
  name: string | null
  avatarUrl: string
  /** ISO */
  createdAt: string
  source: 'rest' | 'graphql'
  repos: ProfileRepo[]
  /** Tier 2: the contribution calendar, one entry per day from the first window's start (which can
   *  precede createdAt) through today, in GitHub's days; never a future day. Tier 1: empty. */
  days: { date: string; count: number }[]
  /** Tier 1: pushes per repo per day, from recentFrom to now. Tier 2: empty. */
  recent: { date: string; repo: string; pushes: number }[]
  /** Tier 1: the first day `recent` covers: the oldest event's day when the third (last) page of
   *  events was served (GitHub keeps 300, but live pages ran 99, 100 and 80, so the count cannot
   *  tell), else 30 days ago. Days before it are unknown, not zero. null in tier 2. */
  recentFrom: string | null
  /** Tier 2: pull requests of theirs merged into repos they do not own, one entry each, by the GitHub
   *  day of the merge, sorted by day then repo (nameWithOwner). A repo named only here is in repos
   *  too (isOwn false, no activity). Private repos are kept. Tier 1: empty. */
  landed: { day: string; repo: string }[]
  /** the ones the API states directly; derived ones come from the timeline model */
  milestones: ProfileMilestone[]
  /** Tier 2 only (0 in tier 1) */
  restrictedContributions: number
  /** a repo cap (500, or 100 in a window), a window still paging, or a window lost to an error */
  truncated: boolean
  /** Tier 2: windows lost to errors after their retry, as 'YYYYqN', for the legend. [] otherwise. */
  lostWindows: string[]
  /** a token was set but GraphQL failed and REST filled the profile: why, for the status strip */
  fallback: { message: string; limit: 'graphql' | 'secondary' | null; resetAt: string | null } | null
}

/** The person fetchers' stages. */
export type ProfileFetchStage = 'user' | 'repos' | 'events' | 'windows' | 'done'
```

`ProfileFetchStage` comes in Phase 0 as a type only. `FetchProgress.stage` widens to
`FetchStage | ProfileFetchStage` in Phase 1, in the same commit as `stageLabel`'s new cases
(`stageLabel` is exhaustive, so typecheck fails otherwise).

Errors reuse `GitHubFetchError`; add the code `'not_a_user'` (raised from the identity call). Its
`ErrorCard` copy and its key in `tests/umami.test.ts`'s `FETCH_ERROR_CODES` come in the same
commit, or typecheck fails (both are exhaustive). `first-star` is left out: neither tier fetches a
date for a first star.

## 4. The pure timeline model

`src/profile/timeline.ts`: `buildLifeTimeline(profile: ProfileData): LifeTimeline`. Pure,
deterministic, no DOM, no clock (pass `now` in), fully unit-tested, like `src/graph/*`.

It produces:
- **Lanes**: one per repo, ordered by `firstActiveAt` (a repo they only contributed to roots where
  they arrived, not at its own birth), with active spans (runs of activity with gaps under 30 days
  merged) and dormant spans. Tier 1: one span, birth → last push.
- **Eras**: calendar years, each with total contributions (tier 2) or repos born (tier 1).
- **Language eras**: the dominant language per quarter, weighted by commits (tier 2) or by active
  repo spans (tier 1); a change of dominant language becomes a `language-switch` milestone.
- **Streaks**: longest run of contribution days, current streak (tier 2 only).
- **Derived milestones**: first repo, top-starred repo, longest streak, language switches, merged
  with the API-stated ones and sorted by date.
- **Time mapping**: a function from date to 0..1 progress for the time-lapse, at an even pace per
  active month rather than per day, so a quiet year does not play as dead air (same idea as
  `graph/timeline.ts`).

## 5. Views

All views paint on canvas, read colours from the active theme (`src/theme/themes.ts`) so all ten
themes work with no extra work, and share one side panel (repo list with hide toggles, milestones,
legend) and one inspector (hover a repo or a day for details).

> **Retired.** The life garden below was removed when the app moved to its metro look: life lines
> is the default view, and a `?user=…&view=garden` link opens life lines. The rest of this spec
> keeps its history as it was built.

1. **Life garden (v1 default).** A horizon with time running left to right. Each repo is a plant
   rooted at its `firstActiveAt` (its birth for the person's own repos, their first counted day for
   repos they only contributed to). Height follows total activity, leaves mark active spans, a bloom marks
   stars, archived repos are drawn dry, forks are drawn as cuttings. Reuse what can be reused from
   `components/gardenPaint.ts` and `gardenLook.ts` rather than copying it.
2. **Life lines (metro).** Each repo is a line along the time axis, thick while active and thin
   while dormant; milestones are stations; language eras are background bands. Build this as its
   own small layout module. Do not bend the branch-DAG engine in `graph/metro.ts` to fit.
3. **Constellation.** Each repo is a star placed by `firstActiveAt` (x) and language (y band), sized by
   activity, glowing by stars, with faint lines linking repos active at the same time.

## 6. Reused machinery

- **Input**: the existing input accepts `login`, `@login` or `github.com/login` and switches to
  person mode; `owner/repo` keeps working as before. Parsing lives in a pure `api/parseSubject.ts`
  that wraps `parseRepoUrl` (Phase 0 has the details).
- **Share links**: `?user=login` in `share/shareUrl.ts`, plus `&view=` for the chosen view (Phase 0).
  Never put private repo names in the URL.
- **Cache**: `api/profileCache.ts`, fresh for 24 h, versioned, a few profiles kept, on the same
  policy as `repoCache.ts`: extract that policy into a function generic over the entry type, used
  by both, without changing repo-cache behaviour or its tests. Its own IndexedDB **database**
  (`repo-garden-profiles`), not a second store in `repo-garden`: adding a store needs a version
  bump, after which `repoCache`'s `indexedDB.open('repo-garden', 1)` fails with a VersionError and,
  its errors being swallowed, the repo cache would silently stop. The key is the lowercased login
  plus the tier (`rest` or `graphql`): a tokenless run reads only `rest` entries, a token run only
  `graphql` ones, so adding a token never keeps serving a REST profile, and a profile fetched with a
  token is never served without one. A profile REST filled after a GraphQL fallback
  (`fallback !== null`) is not cached: the next token run tries GraphQL again.
- **Time-lapse and export**: the view on show grows from the life's first day (the account's
  creation, or earlier backdated activity) to today, at an even pace per active month, with play,
  scrub and WebM recording. Reused as they are: `export/video.ts` and `export/image.ts`; the person
  time-lapse is silent, so `audio/context.ts` is not used. `TimelapseBar` is repo-shaped (it takes
  a `Graph`, `RepoData` and a graph timeline, scores music from branches, names files from
  owner/repo), so person mode gets its own small controls built on those helpers. Add a PNG
  "poster" export framed with the user's avatar, login, year span and top three milestones. No
  JSON save in person mode for v1: the garden-file format is `RepoData`-only and would carry
  private names past the toggle.
- **Lazy loading**: person mode is its own chunk in `lazy/parts.ts`, so the repo garden's first
  load grows only by the routing code that must load first (Phase 0 has the wiring and the check). Every person-only module goes
  into `src/lazy/parts.test.ts`'s `LAZY_ONLY` as it is added. Person-mode files are imported by
  file path, never through a directory `index.tsx`: the split test's walker does not resolve those,
  so an eager import of one would slip past it.

### Analytics

Person mode reports through the repo garden's Umami tracker, under the README's "Analytics" rules.
Every event goes through `track()` in `src/analytics/umami.ts`, never `window.umami` directly. Add
each new name to its `AnalyticsEvent` union in the phase that first sends it, not earlier (the
union keys exhaustive tables, and a name nothing sends would be documented as sent).

| Event | Data |
| --- | --- |
| `grow` | `mode: 'person'`, `source`: `rest` or `graphql` (the tier that filled the profile, so `rest` after a GraphQL fallback), `cached` as in repo mode, `token` from the fetch result (`fetchedWithToken`); `login` only for a live fetch without a token |
| `view-switch` | `view`: `garden`, `lines` or `constellation` |
| `poster-export` | none |
| `timelapse-play` | none (the repo garden's event, reused) |

- `grow` counts requests, as in repo mode (README, "Analytics"): it fires once per grow or refresh
  request for a profile (the input, an example, a `?user=` share link, the refresh button), when
  its data has arrived, from GitHub or the cache. A token change, a background refetch or a view
  switch sends none by itself. It first fires in Phase 4, when the life garden can show a profile;
  Phases 1 and 2 only build and test the rule for its data.
- That rule is pure: `source` and `login` are decided from the fetch result. `login` is the only
  name a person-mode event carries, and only when the profile was fetched live without a token.
  Never from `profileCache.ts`, as defence in depth (the cache keys by tier, but a cached copy is
  never proof of a tokenless fetch).
  Decide `login` in that rule, as `growEventData` in `src/analytics/useRepoAnalytics.ts` does for
  repo mode; `track()` dropping `login` under a token is only the backstop.
- Never send a private repo name, even while the privacy toggle reveals them on screen. No event
  carries a repo name at all.
- Shared controls keep sending the repo garden's events in person mode: `theme-switch` and
  `token-added` from the top bar, and `share-copy` if the copy-link button is reused. The person
  time-lapse controls send `export` `{ format: 'webm' }` when a recording is saved, as
  `TimelapseBar` does (the call lives there, not in `export/video.ts`). None carries a name.

## 7. Phases

### Phase 0 — Branch, contracts, subject routing, share link
- Cut `feat/person-mode`. Add the contracts from section 3, with `'not_a_user'`, its `ErrorCard`
  copy (title "that's an organization", hint "person mode shows users: try one of its repos as
  owner/repo") and its `FETCH_ERROR_CODES` key.
- `src/api/parseSubject.ts` (eager): `type Subject = { kind: 'repo'; repo: RepoRef } | { kind:
  'user'; login: string }`, `parseSubject(input): Subject | null`, `parseLogin(input): string | null`.
  Order: trim (empty is null); `parseRepoUrl` first, and any repo it returns is the subject, so repo
  parsing is byte-identical; otherwise `parseLogin`: `@login`, a bare `login` with one optional
  trailing `/`, or a `github.com` / `www.github.com` URL (any scheme or none) whose path has exactly
  one segment (trailing slash, `?query` and `#hash` ignored). Login grammar
  `/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/`: 1 to 39 characters, no leading hyphen; doubled and trailing
  hyphens allowed on purpose for legacy accounts (a wrongly accepted login costs one 404, a wrongly
  rejected one locks that person out). A short list of github.com routes is rejected
  case-insensitively (about, account, apps, codespaces, collections, contact, dashboard, enterprise,
  enterprises, explore, features, issues, join, login, logout, marketplace, new, notifications,
  organizations, orgs, pricing, pulls, search, sessions, settings, signup, site, sponsors, topics,
  trending, users). `parseRepoUrl.ts` exports the host helpers `parseLogin` needs (its scheme, host
  and decode helpers) without changing them; `OWNER_RE` stays as it is. Only the main input uses `parseSubject`: the battle field, `?repo=`, `?vs=` and garden
  files keep `parseRepoUrl`. The login keeps its typed case and compares case-insensitively.
- `tests/parseSubject.test.ts`: every accepted row of `tests/parseRepoUrl.test.ts` gives a repo
  subject. Those rows move unchanged into `tests/fixtures/repoUrls.ts`, which both test files
  import (`parseRepoUrl.test.ts`'s cases and expectations stay the same). Users: `octocat`, `OctoCat` (case kept), `@octocat`, `octocat/`,
  `github.com/octocat`, `www.github.com/octocat`, `https://github.com/octocat/`,
  `https://GitHub.com/octocat?tab=repositories`, `https://github.com/octocat#pinned`, `a`, a
  39-character login, `a-b-c`, `foo-`, `foo--bar`, `SailmanSeeulater`. Null: `''`, `-octocat`, a
  40-character login, `octo_cat`, `octo.cat`, `@octocat/repo`, `git@github.com:octocat`,
  `https://gitlab.com/octocat`, `gist.github.com/octocat`, `https://github.com/`,
  `https://github.com.evil.com/octocat`, `login`, `Settings`, `https://github.com/explore`.
  Documented as today: `github.com/owner/repo` and `github.com/settings/profile` stay repos.
- `share/shareUrl.ts`: `ShareState` and `readShareState` stay as they are (`person` already means a
  contributor; person mode says `user` and `login`). Add `type PersonView = 'garden' | 'lines' |
  'constellation'`, `readSubject(search)` returning the repo share state, or `{ login, view }`, or
  null, and `writeUserShare({ login, view }, current)`. A `?repo=` that parses wins and `user`/`view`
  are ignored; otherwise a `?user=` that passes `parseLogin` (so `?user=@x` and full URLs work, as
  `?repo=` takes URLs) is the subject, and `branch`, `by` and `vs` are ignored. `&view=` must be one
  of the three exactly, and is read only with a user. `writeShareState` now also deletes `user` and
  `view`; `writeUserShare` deletes `repo`, `branch`, `by` and `vs`, writes `user` and `&view=` when
  it is not null (person mode always passes its view, so its links carry `&view=garden`), and keeps
  every other parameter. Tests in `tests/shareUrl.test.ts`: user and view round trip, bad views,
  repo wins, an unparsable `?repo=` next to a valid `?user=`, and a repo write on
  `?user=x&view=lines` leaving only `?repo=…`.
- App split. `App.tsx` is already 650 lines and does not grow:
  - `src/RepoApp.tsx` is today's App body, renamed, with only these deltas: (a) props `onUser(login)`
    and `initial?: { input: string } | { file: File }`, the latter run once on mount (guarded by a
    ref against StrictMode's double effect) through `pickExample` or `openFile`, the same paths as
    an example chip or a dropped file, so grow, analytics and the URL behave as if it were typed;
    (b) `grow()` parses with `parseSubject`: null shows the invalid input card as today, a user calls
    `onUser(login)` and returns before any reset, fetch or `noteGrow`, a repo runs today's code;
    (c) the theme layout effect and the `storage` listener (and their imports) move to `App.tsx`,
    and `useTheme()` stays; (d) an unmount cleanup calls `releaseAudio()`, so leaving while the
    time-lapse loads frees the audio it unlocked. Everything else is byte-for-byte.
  - `src/App.tsx` becomes a thin router (well under 100 lines). `import RepoApp from './RepoApp'`
    is its first import: importing the store or theme modules ahead of it makes Rolldown split a
    new first-load chunk. It owns the theme effects and the subject, read once from
    `readSubject(location.search)`: `{ kind: 'repo', initial? }` or `{ kind: 'user', login, request }`,
    where `request` counts submits, so a later phase can refetch the same login the way Grow
    refetches the same repo. Every switch calls `useGardenStore.getState().resetForNewRepo()`
    first, so no hidden branch or selection of one repo reaches another. Switching to a user
    writes `?user=` with `history.replaceState` (as today's share effect does) before switching, so
    a reload reopens person mode. Switching to a repo passes `initial` and lets RepoApp's own share
    effect write `?repo=`.
  - `src/PersonApp.tsx` (default export) is a placeholder: the shared `TopBar` (its input takes both
    kinds; a repo goes back through the router as `initial: { input }`; export disabled; "Open a
    saved file", and a `.json` dropped on the page, go to the router as `initial: { file }`), and the
    login with "person mode coming soon". It carries an incoming `&view=` through unchanged.
  - `src/lazy/parts.ts`: `export const personAppChunk = defineChunk(() => import('../PersonApp'))`.
    `App.tsx` renders `lazyPart(personAppChunk)` (module scope) inside a `LazySlot` labelled
    "loading person mode", without `onFailed`, so a failed load shows the reload notice and the
    reload reopens `?user=`. Other modules may only `import type` from `PersonApp`, and `PersonApp`
    reaches the time-lapse recorder, the exporters and metro only through chunks in
    `lazy/parts.ts`. No existing chunk exposes `export/video.ts` (only `TimelapseBar` imports it),
    so Phase 5 adds `videoChunk = defineChunk(() => import('../export/video'))`, with its entry in
    `parts.test.ts`'s dynamic-import list.
  - Tests that move with it: `src/lazy/parts.test.ts` gets `PersonApp.tsx` in `LAZY_ONLY` and in
    the dynamic-import list, and `RepoApp.tsx` in the eager list;
    `src/components/prMarks.placement.test.ts` reads `../RepoApp.tsx?raw`.
- Visible repo-mode changes, the only ones: a valid login (`vite`, `@vite`, `github.com/vite`) now
  opens person mode instead of the invalid input card; the input's placeholder reads "owner/repo or
  a GitHub user" and its aria-label "GitHub repository or user"; the invalid input card reads
  "that doesn't look like a GitHub repo or user" with the hint "try owner/repo, a login, or a
  github.com link". The battle field stays repo-only.
- Known and accepted: RepoApp's analytics state restarts with each mount, so a repo re-entered from
  person mode while TanStack still holds its pull requests may send `pr-overlay` again for the same
  answer.

**Done when**
- [ ] `npm test` and `npm run typecheck` pass.
- [ ] Typing `SailmanSeeulater` or opening `?user=SailmanSeeulater` shows the person placeholder,
      and typing a repo there goes back to the repo garden.
- [ ] `?repo=vitejs/vite` grows exactly as before: branches, PR overlay, metro, garden, time-lapse.
      vite needs more than the anonymous 60 requests an hour, so check it with a token.
- [ ] First load unchanged: `vite build` on master and on the branch; the files `dist/index.html`
      names (module script, every modulepreload, stylesheet) are the same set (only `index-*.js` and
      `index-*.css` change hash), and their summed gzip size grows by at most 1 kB (the router,
      `parseSubject` and the share functions: about 0.5 kB gzip). A new modulepreload file fails the
      check even if `index-*.js` shrinks. "person mode coming soon" is absent from the entry chunk.
- [ ] Sends no new analytics event names. The shared `TopBar` keeps sending `theme-switch` and
      `token-added` from the placeholder (section 6); repo mode's events are unchanged.

### Phase 1 — Tier 1 fetcher (no token) and cache
- `api/profile.ts`: `fetchProfileRest(login, opts)` reuses `src/api/http.ts`: `RateState`,
  `noteRateLimit`, `toFetchError` (the `(err, ctx)` one in `http.ts`, not the narrowing one in
  `hooks/useRepoData.ts`), `hasNextLink`, `runPool`, `scrub`, `PER_PAGE`. Nothing is copied out of
  `api/github.ts`: its Octokit construction and the request-counting hook (the only code that
  increments `RateState.requestsUsed`) move into `http.ts` as one exported helper, and `github.ts`
  calls it, with repo behaviour and its tests unchanged. `http.ts` changes only as needed:
  `ErrorContext`'s `owner`/`repo` become a subject (a repo, or a login), and the 404 gets a user
  wording ("<login> was not found. Check the spelling."); every repo message stays byte-identical.
- Options `{ token?, signal?, fetch?, onProgress?, now? }`; progress events with the
  `ProfileFetchStage`s (widening `FetchProgress.stage`, with `stageLabel`'s new cases in the same
  commit), ending with a `'done'` event that carries
  `requestsUsed`, which the smoke script reads. Requests follow section 2, tier 1.
- Recorded fixtures for a real public user in `tests/fixtures/github/`, offline tests on them.
- `api/profileCache.ts` as in section 6, with tests on an in-memory store.
- The pure rule for `grow`'s data (section 6, Analytics), with tests. Nothing calls `track()` yet.

**Done when**
- [ ] Tests cover: normal user, user with 0 public repos, organization (`not_a_user`), 404 (user
      wording), rate limited, more than 100 repos (pagination), a fork whose `pushed_at` is before
      its `created_at`, and an events failure that still yields a profile.
- [ ] `npx tsx scripts/smoke-profile.ts <login>` prints repo count, request count and the span.
- [ ] A test shows a second load within 24 h, through `profileCache` on an in-memory store, makes no
      requests (the smoke script runs where there is no IndexedDB), and that a `rest` entry is not
      read once a token is set.
- [ ] Tests of the `grow` data rule: `mode: 'person'`, `source: 'rest'`; `login` only for a live
      fetch without a token, never for a profile from `profileCache.ts`.
- [ ] Sends no new analytics events: nothing shows a profile until Phase 4.

### Phase 2 — Tier 2 fetcher (token, GraphQL)
- Verify the plan in section 2 with one live query first, and record fixtures.
- `fetchProfileGraphql(login, opts)`, modelled on `src/api/pulls.ts`: `octokit.graphql` with
  `request: { signal }` from a `GRAPHQL_TIMEOUT_MS` abort. `GRAPHQL_TIMEOUT_MS` and `withTimeout`
  move from `pulls.ts` into a small `api/graphql.ts` that `pulls.ts` imports, unchanged: importing
  them from `pulls.ts` would put that whole lazy module on person mode's path. Its only importers
  are lazy, so it is lazy-only: it goes into `LAZY_ONLY`, and the bundler gives it a small shared
  chunk.
- The query plan of section 2: identity over REST, repositories, then quarter windows as separate
  `user(login)` aliases, 4 per query, halved on a timeout like `graphqlBatch`.
- Partial errors are mapped per window the way `gqlErrorMarks` maps them per branch: an answer with
  errors arrives as a `GraphqlResponseError` with `.data` and `.errors`; windows that came back are
  kept, and a window whose alias is null with an error on its path is retried once alone, then
  counted as lost (`truncated`, and `lostWindows` lists it, so the legend can name the missing
  quarters). `gqlErrorMarks` itself
  is keyed to `repository.bN` paths, so this is a sibling function for `/^w\d{4}q[1-4]$/` aliases,
  not a reuse. An SSO `FORBIDDEN` inside one window loses that window, not the profile.
- Rate limits reported the same way `usePulls`/`describePullsError` does, classified as
  `pulls.ts` and `toFetchError` classify them (GitHub sends `x-ratelimit-resource: graphql` on
  every `/graphql` answer, so that header alone says nothing). A primary GraphQL limit, a
  `RATE_LIMITED` error or an HTTP 403/429 with `x-ratelimit-remaining: 0`, becomes `rate_limited`
  with a message that says "GraphQL rate limit" (`limit: 'graphql'`). A secondary limit, a 403/429
  with `retry-after` or a message naming it, gets a message that says "secondary rate limit"
  (`limit: 'secondary'`). Any other 401/403 is a refusal (`limit: null`). The messages hold no
  login: a login like `graphql-fan` would otherwise flip `describePullsError`'s regex. `resetAt`
  comes from `rateLimit.resetAt` or the headers. GraphQL points never reach `RateState` or `store.rate` (core only): the counting hook
  notes only responses whose `x-ratelimit-resource` is `core` or absent, as `coreRateFromHeaders`
  does.
- With a token, `fetchProfile` tries GraphQL and falls back to REST (tier 1) on a GraphQL failure:
  a refusal (`FORBIDDEN` or SAML for the whole query, or a 401/403 that is not a rate limit), a
  GraphQL rate limit, primary or secondary (the core budget REST spends is separate), a timeout
  after the ladder, a schema error or anything unknown. It does not fall back on an abort, a network
  error, a core rate limit from the identity call (REST would hit the same wall), or
  `not_found`/`not_a_user` (the identity call already decided).
  The fallback's reason goes into `ProfileData.fallback` in `describePullsError`'s shape, and the
  status strip says it ("GraphQL limit reached until 14:05; showing the public profile").
- Contributions are bucketed by GitHub's day (section 2), and a repo the user only contributed to
  gets `isOwn: false` and its `firstActiveAt` from the first counted day.

**Done when**
- [ ] Offline tests on the recorded fixtures pass, including an account older than 3 years, a
      window that returned 100 repositories (`truncated`), a batch answered with one window's error
      (the other windows kept), a GraphQL rate limit (falls back, `limit: 'graphql'`), and a core
      rate limit (no fallback).
- [ ] The smoke script with a token prints total contributions per year and matches the numbers on
      the user's github.com profile within the known limits.
- [ ] Tests of the `grow` data rule: `source: 'graphql'`, and `source: 'rest'` after a fallback;
      neither carries `login` (a token is set).
- [ ] Still sends no new analytics events.

### Phase 3 — Timeline model
- `profile/timeline.ts` exactly as section 4, pure and tested.

**Done when**
- [ ] Tests on hand-made fixtures cover: span merging, dormancy, a language switch, streaks,
      tier 1 vs tier 2 inputs, an empty profile, and determinism (same input, same output).
- [ ] Sends no new analytics events (the model is pure).

### Phase 4 — Life garden view
- Canvas view, side panel, inspector, legend with the data limits, privacy toggle.
- Works in all ten themes.

**Done when**
- [ ] `SailmanSeeulater` renders with and without a token, in a light and a dark theme.
- [ ] Hover shows repo name (or "private repo"), born date, active spans, commits, stars.
- [ ] Private names are hidden by default and never appear in the URL.
- [ ] `grow` with `mode: 'person'` fires once per grow or refresh request for a profile, when its
      data has arrived (as in repo mode), with `source: 'rest'` or `source: 'graphql'`, with and
      without a token; with a token it carries no name. A token change or a background refetch sends none.

### Phase 5 — Time-lapse, poster export, share
- Year-by-year growth with play and scrub, WebM recording, PNG poster export.

**Done when**
- [ ] A recording plays from the join year to today and respects the privacy toggle.
- [ ] Opening a copied `?user=…&view=garden` link reproduces the view.
- [ ] `timelapse-play` fires when the person time-lapse opens, `poster-export` when a poster is
      saved, and `export` `{ format: 'webm' }` when a person recording is saved.

### Phase 6 — Life lines and Constellation views
- The two remaining views from section 5, with a view switcher like the layout switcher.

**Done when**
- [ ] All three views share the panel, inspector, theme, time-lapse and exports.
- [ ] Each view's layout code is pure and has tests for placement determinism.
- [ ] `view-switch` fires with `view`: `garden`, `lines` or `constellation` when the view changes.

### Phase 7 — Polish and ship
- Error and empty states, request counter and "add a token" nudge in person mode, README section,
  `scripts/smoke-profile.ts` documented.
- PR into `master`; CI (tests + build) must pass; merging deploys through the existing workflow.

**Done when**
- [ ] The Phase 0 first-load check, run against master: the same files in `dist/index.html` apart
      from `index-*.js`/`index-*.css`, summed gzip growth within 1.5 kB (the routing and parsing
      that must load first, plus Phases 1-2's small eager changes), and no person-only strings in
      the entry chunk.
- [ ] README documents person mode, both tiers and their limits, and lists its events under
      Analytics.
- [ ] All person-mode events show up in Umami from the live site, and with a token none carries a
      name (no `login`, no repo).
- [ ] PR open, CI green.

## 8. Risks

- **GraphQL contribution data is not the whole truth** (default-branch-only, linked emails, no
  forks). Mitigation: the legend says so, and tier 2 lists the user's own repos through
  `repositories`, so repos with no counted commits still show.
- **Very old or very busy accounts** mean many windows. A 15-year account is about 60 quarters, 15
  queries. Mitigation: progress per batch in the status strip, cap at 100 repos per window,
  `truncated` flag shown in the legend.
- **Leaking private repo names** through export or share. Mitigation: the privacy rule in section 2,
  plus a test that a serialized share URL and an export with private repos contains no private names.
