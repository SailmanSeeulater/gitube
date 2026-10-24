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

GitHub's GraphQL API always needs a token, so person mode has a no-token tier on REST and a richer
tier on GraphQL when the visitor has added a token (the existing key icon). Both produce the same
`ProfileData` shape; the views never care which tier filled it, they only read `profile.source`.

### Tier 1 — no token (REST, about 3–6 requests)
1. `GET /users/{login}` → name, avatar, `created_at`, `type` (reject `Organization`), `public_repos`.
2. `GET /users/{login}/repos?type=owner&sort=created&per_page=100` (paginate, cap 500 repos) →
   per repo: name, `created_at`, `pushed_at`, `language`, `stargazers_count`, `forks_count`,
   `fork`, `archived`, `size`.
3. `GET /users/{login}/events/public?per_page=100` (up to 3 pages) → recent push activity only.
   This endpoint only covers roughly the last 90 days; use it for the "recent" end of the timeline
   and say so in the UI.

Each repo's activity in this tier is a span: `created_at` to `pushed_at`, no inner detail.

### Tier 2 — token (GraphQL `POST /graphql`, about 1 query per year of account age)
1. `user(login)` → `createdAt`, profile fields.
2. For each year from `createdAt` to now (a `contributionsCollection` span may not exceed one year):
   `contributionsCollection(from, to)` →
   - `contributionCalendar.weeks.contributionDays { date contributionCount }`
   - `commitContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner
     createdAt primaryLanguage { name color } isFork isPrivate stargazerCount }
     contributions(first: 100) { nodes { occurredAt commitCount } pageInfo { hasNextPage endCursor } } }`
   - `firstPullRequestContribution`, `firstIssueContribution`, `firstRepositoryContribution`,
     `joinedGitHubContribution`, `restrictedContributionsCount`
3. Follow-up queries only for repos whose `contributions` had `hasNextPage`.

**Before writing the fetcher, verify these field names against the live schema** (one real query
with the dev token) and record the responses as fixtures, the same way `replay-cache/` and
`tests/fixtures/github/` already work. Adjust this spec if the schema differs; do not guess.

Known limits to surface in the UI legend, not hide:
- GitHub only counts commits on a repo's default branch (or `gh-pages`), made with an email linked
  to the account, and not in forks.
- Contributions to private repos the visitor cannot see arrive as a count only
  (`restrictedContributionsCount`).
- CSP needs no change: GraphQL is `https://api.github.com/graphql`, already allowed by
  `connect-src`.

### Privacy rule
When a token can see the user's private repos (usually: the visitor looking at themselves),
private repo names are **hidden by default** in the view, in exports and in share links, shown as
"private repo" with a lock. A toggle in the panel reveals them on screen only; exports always
respect the toggle's current state and the toggle resets to hidden on reload.

## 3. Contracts (add to `src/types.ts`)

```ts
export interface ProfileRepo {
  nameWithOwner: string
  createdAt: string            // ISO
  lastActiveAt: string         // pushed_at (tier 1) or last contribution day (tier 2)
  language: string | null
  languageColor: string | null // tier 2 only
  stars: number
  forks: number
  isFork: boolean
  isArchived: boolean
  isPrivate: boolean
  /** Tier 2: commits per day, ascending. Tier 1: empty. */
  activity: { date: string; commits: number }[]
}

export interface ProfileMilestone {
  kind: 'joined' | 'first-repo' | 'first-pr' | 'first-issue' | 'first-star' | 'top-repo'
      | 'longest-streak' | 'language-switch'
  date: string
  label: string
  repo?: string
}

export interface ProfileData {
  login: string
  name: string | null
  avatarUrl: string
  createdAt: string
  source: 'rest' | 'graphql'
  repos: ProfileRepo[]
  /** Tier 2: the contribution calendar, every day since createdAt. Tier 1: empty. */
  days: { date: string; count: number }[]
  /** Tier 1: recent push events (last ~90 days). */
  recent: { date: string; repo: string; commits: number }[]
  milestones: ProfileMilestone[]   // the ones the API states directly; derived ones come later
  restrictedContributions: number
  truncated: boolean               // repo cap or pagination cap hit
}
```

Errors reuse `GitHubFetchError`; add the code `'not_a_user'` for organizations.

## 4. The pure timeline model

`src/profile/timeline.ts`: `buildLifeTimeline(profile: ProfileData): LifeTimeline`. Pure,
deterministic, no DOM, no clock (pass `now` in), fully unit-tested, like `src/graph/*`.

It produces:
- **Lanes**: one per repo, ordered by birth date, with active spans (runs of activity with gaps
  under 30 days merged) and dormant spans. Tier 1: one span, birth → last push.
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

1. **Life garden (v1 default).** A horizon with time running left to right. Each repo is a plant
   rooted at its birth date. Height follows total activity, leaves mark active spans, a bloom marks
   stars, archived repos are drawn dry, forks are drawn as cuttings. Reuse what can be reused from
   `components/gardenPaint.ts` and `gardenLook.ts` rather than copying it.
2. **Life lines (metro).** Each repo is a line along the time axis, thick while active and thin
   while dormant; milestones are stations; language eras are background bands. Build this as its
   own small layout module. Do not bend the branch-DAG engine in `graph/metro.ts` to fit.
3. **Constellation.** Each repo is a star placed by birth date (x) and language (y band), sized by
   activity, glowing by stars, with faint lines linking repos active at the same time.

## 6. Reused machinery

- **Input**: the existing repo input accepts `login`, `@login` or `github.com/login` and switches
  to person mode; `owner/repo` keeps working as before. Put the parsing in a pure
  `api/parseSubject.ts` with tests, wrapping `parseRepoUrl`.
- **Share links**: `?user=login` in `share/shareUrl.ts`, plus `&view=` for the chosen view. Never
  put private repo names in the URL.
- **Cache**: `api/profileCache.ts` on the same IndexedDB policy as `repoCache.ts` (fresh for 24 h,
  versioned, small LRU), with its own store name.
- **Time-lapse and export**: the person garden grows year by year from the account's creation date,
  with play, scrub and WebM recording through the existing time-lapse and `export/` code. Add a PNG
  "poster" export framed with the user's avatar, login, year span and top three milestones.
- **Lazy loading**: person mode is its own chunk in `lazy/parts.ts`, so the repo garden's first
  load does not get heavier.

## 7. Phases

### Phase 0 — Branch, contracts, input, share link
- Cut `feat/person-mode`. Add the contracts from section 3.
- `api/parseSubject.ts` with tests; `?user=` in the share URL with tests.
- App routes a user subject to an empty "person mode" placeholder; repo mode is unchanged.

**Done when**
- [ ] `npm test` and `npm run typecheck` pass.
- [ ] Typing `SailmanSeeulater` or opening `?user=SailmanSeeulater` shows the person placeholder;
      `?repo=vitejs/vite` still grows the repo garden exactly as before.

### Phase 1 — Tier 1 fetcher (no token) and cache
- `api/profile.ts`: `fetchProfileRest(login, opts)` with progress events, abort, rate-limit
  reading and error codes, reusing the Octokit setup from `api/github.ts` where it can.
- Recorded fixtures for a real user, offline tests on them.
- `api/profileCache.ts` with tests.

**Done when**
- [ ] Tests cover: normal user, user with 0 public repos, organization (`not_a_user`), 404,
      rate limited, more than 100 repos (pagination).
- [ ] `npx tsx scripts/smoke-profile.ts <login>` prints repo count, request count and the span.
- [ ] A second load within 24 h spends no requests.

### Phase 2 — Tier 2 fetcher (token, GraphQL)
- Verify the schema with one live query first (section 2) and record fixtures.
- `fetchProfileGraphql(login, opts)`: year loop, follow-up pagination, merged into `ProfileData`.
- With a token, `fetchProfile` tries GraphQL and falls back to REST on a GraphQL error, saying so
  in the status strip.

**Done when**
- [ ] Offline tests on the recorded fixtures pass, including an account older than 3 years and a
      repo whose contributions needed a second page.
- [ ] The smoke script with a token prints total contributions per year and matches the numbers on
      the user's github.com profile within the known limits.

### Phase 3 — Timeline model
- `profile/timeline.ts` exactly as section 4, pure and tested.

**Done when**
- [ ] Tests on hand-made fixtures cover: span merging, dormancy, a language switch, streaks,
      tier 1 vs tier 2 inputs, an empty profile, and determinism (same input, same output).

### Phase 4 — Life garden view
- Canvas view, side panel, inspector, legend with the data limits, privacy toggle.
- Works in all ten themes.

**Done when**
- [ ] `SailmanSeeulater` renders with and without a token, in a light and a dark theme.
- [ ] Hover shows repo name (or "private repo"), born date, active spans, commits, stars.
- [ ] Private names are hidden by default and never appear in the URL.

### Phase 5 — Time-lapse, poster export, share
- Year-by-year growth with play and scrub, WebM recording, PNG poster export.

**Done when**
- [ ] A recording plays from the join year to today and respects the privacy toggle.
- [ ] Opening a copied `?user=…&view=garden` link reproduces the view.

### Phase 6 — Life lines and Constellation views
- The two remaining views from section 5, with a view switcher like the layout switcher.

**Done when**
- [ ] All three views share the panel, inspector, theme, time-lapse and exports.
- [ ] Each view's layout code is pure and has tests for placement determinism.

### Phase 7 — Polish and ship
- Error and empty states, request counter and "add a token" nudge in person mode, README section,
  `scripts/smoke-profile.ts` documented.
- PR into `master`; CI (tests + build) must pass; merging deploys through the existing workflow.

**Done when**
- [ ] Lighthouse-style check: the repo garden's first-load size is unchanged (person mode is lazy).
- [ ] README documents person mode, both tiers and their limits.
- [ ] PR open, CI green.

## 8. Risks

- **GraphQL contribution data is not the whole truth** (default-branch-only, linked emails, no
  forks). Mitigation: the legend says so, and tier 1 spans still show repos with no counted commits.
- **Very old or very busy accounts** mean many year queries and pages. Mitigation: progress per
  year in the status strip, cap at 100 repos per year, `truncated` flag shown in the legend.
- **Leaking private repo names** through export or share. Mitigation: the privacy rule in section 2,
  plus a test that a serialized share URL and an export with private repos contains no private names.
