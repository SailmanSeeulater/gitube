# Deploying gitube

gitube goes on the Oracle VPS the same way the portfolio does: GitHub
Actions builds it, then rsyncs the static `dist/` folder into a web root that
the host nginx serves. There is no container and no server process, because the
app is plain files that talk to the GitHub API from the visitor's browser.

```
browser ─https─▶ host nginx (TLS, certbot) ─▶ /var/www/gitube (static files)
browser ─https─▶ api.github.com             (direct, with the visitor's own token if they add one)
browser ─https─▶ stats.latesailor.dev       (Umami: page and event counts, never the token)
```

| Thing | Value |
| --- | --- |
| URL | https://gitube.latesailor.dev (https://repogarden.latesailor.dev, the old address, redirects there) |
| VPS | `ubuntu@146.235.217.254` |
| Web root | `/var/www/gitube` |
| nginx vhost | `deploy/nginx/gitube.conf` to `/etc/nginx/sites-available/gitube` |
| Security headers | `deploy/nginx/gitube-headers.conf` to `/etc/nginx/snippets/gitube-headers.conf` |
| Pipeline | `.github/workflows/deploy.yml`, runs on every push to `master` |
| Secret | `VPS_SSH_KEY`, the private half of `~/.ssh/repogarden_deploy` |
| Analytics | Umami at https://stats.latesailor.dev; website ID in `.env.production` (`VITE_UMAMI_WEBSITE_ID`); the headers snippet needs it in its CSP first (step 6) |

## 1. DNS (Namecheap, once)

Domain List, then latesailor.dev, then Advanced DNS, then Add New Record:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| A Record | `gitube` | `146.235.217.254` | Automatic |

Check it from your laptop before running certbot:

```bash
nslookup gitube.latesailor.dev
```

## 2. A deploy key for this repo (laptop, once)

Run the laptop commands from the repo folder. They are written for Git Bash;
the two that differ in Windows PowerShell have a PowerShell version below them. GitHub Actions logs
in to the VPS with its own key, separate from your Oracle login key, so it can
be revoked on its own if this repo ever leaks.

```bash
ssh-keygen -t ed25519 -C "repo-garden deploy" -f ~/.ssh/repogarden_deploy -N ""
```

In Windows PowerShell, `-N ""` loses its empty value and ssh-keygen fails with
"option requires an argument -- N". Use this there instead:

```powershell
ssh-keygen -t ed25519 -C "repo-garden deploy" -f "$HOME\.ssh
epogarden_deploy" -N '""'
```

That makes two files. `repogarden_deploy` is the private half and goes into the
GitHub secret. `repogarden_deploy.pub` is the public half and goes on the VPS.

## 3. The VPS (once)

Copy the public key and the two nginx files up, logging in with your Oracle key:

```bash
scp -i "/c/Users/lesst/OneDrive/Documents/Coding Space/Mordi_keys/ssh-key-2026-05-26.key" ~/.ssh/repogarden_deploy.pub deploy/nginx/gitube.conf deploy/nginx/gitube-headers.conf ubuntu@146.235.217.254:/tmp/
```

Log in:

```bash
ssh -i "/c/Users/lesst/OneDrive/Documents/Coding Space/Mordi_keys/ssh-key-2026-05-26.key" ubuntu@146.235.217.254
```

On the VPS, let the deploy key in:

```bash
cat /tmp/repogarden_deploy.pub >> ~/.ssh/authorized_keys && rm /tmp/repogarden_deploy.pub
```

Install the site:

```bash
sudo install -d -o www-data -g www-data -m 755 /var/www/gitube
sudo install -m 644 /tmp/gitube-headers.conf /etc/nginx/snippets/gitube-headers.conf
sudo install -m 644 /tmp/gitube.conf /etc/nginx/sites-available/gitube
sudo ln -s /etc/nginx/sites-available/gitube /etc/nginx/sites-enabled/gitube
sudo nginx -t
```

Only if `nginx -t` says the test is successful, reload and add HTTPS:

```bash
sudo systemctl reload nginx
sudo certbot --nginx -d gitube.latesailor.dev
```

If certbot asks whether to redirect HTTP to HTTPS, choose redirect. `nginx -t`
guards the other sites on the box: if it fails, nothing is reloaded. Ports 80
and 443 are already open, because the portfolio uses them.

## 4. The GitHub secret (laptop, once)

The secret holds the private half of the deploy key:

```bash
gh secret set VPS_SSH_KEY -R SailmanSeeulater/repo-garden < ~/.ssh/repogarden_deploy
```

PowerShell has no `<` redirect, so pipe the file instead:

```powershell
Get-Content "$HOME\.ssh
epogarden_deploy" -Raw | gh secret set VPS_SSH_KEY -R SailmanSeeulater/repo-garden
```

The workflow accepts the raw key file or the key as one base64 line.

## 5. Ship

```bash
git push -u origin master
```

Watch it with `gh run watch`. The job runs the tests, builds, rsyncs, then
smoke-tests the live site: the page loads, hashed assets get a one-year cache,
and the security policy allows `api.github.com` and `stats.latesailor.dev`.
After that, every push to `master` redeploys. To redeploy without a new
commit, use Run workflow on the Actions tab.

The sync runs in two passes. The hashed files go into `assets/` first, with
nothing deleted there; then `index.html` and the rest, with `--delete`. Last,
hashed files that no deploy has shipped for 30 days are deleted on the VPS
(`sudo find ... -mtime +30 -delete`). So a tab opened before a deploy can still
load the optional parts of its own build: they load on first use
(`src/lazy/parts.ts`) and import that build's `index-<hash>.js` by name.

## 6. Analytics (Umami): update the headers snippet before merging

**Do this before merging the analytics branch into `master`.** The pipeline
only ships `dist/`, and the snippet on the VPS still has the policy from
step 3, which lets no script or request reach `stats.latesailor.dev`. The
tracker would be blocked with no visible error (only a console message), and
Umami would simply show no visits. The deploy's smoke test checks the live
policy for `stats.latesailor.dev` too, so a merge made before this step fails
the job loudly, though only after the files are synced: install the snippet
as below, then rerun the job. A fresh setup can skip this: step 3 already
copies the current snippet.

Copy the snippet up, logging in with your Oracle key:

```bash
scp -i "/c/Users/lesst/OneDrive/Documents/Coding Space/Mordi_keys/ssh-key-2026-05-26.key" deploy/nginx/gitube-headers.conf ubuntu@146.235.217.254:/tmp/
```

Log in:

```bash
ssh -i "/c/Users/lesst/OneDrive/Documents/Coding Space/Mordi_keys/ssh-key-2026-05-26.key" ubuntu@146.235.217.254
```

On the VPS, install it and test the config:

```bash
sudo install -m 644 /tmp/gitube-headers.conf /etc/nginx/snippets/gitube-headers.conf
sudo nginx -t
```

Only if `nginx -t` says the test is successful, reload:

```bash
sudo systemctl reload nginx
```

If it fails, do not reload. nginx keeps serving the old headers, but the
broken file is on disk now: fix it and install it again before nginx is next
restarted (a reboot included). A reload would only fail, but a restart would
leave every site on the box down.

Back on the laptop, check the live policy:

```bash
curl -sI https://gitube.latesailor.dev/ | grep -i content-security-policy
```

The line must list `https://stats.latesailor.dev` twice, in `script-src` and
in `connect-src`. Then merge. Analytics stays off until `.env.production` has
a website ID. In Umami, open Websites (add one for `gitube.latesailor.dev`
if there is none), then Edit on that site; on older versions it is Settings,
then Websites, then Edit. Copy its Website ID into `VITE_UMAMI_WEBSITE_ID=` and
commit it. The next deploy loads the tracker. What it counts, and what it
never gets, is in the README under Analytics.

## Moving from repogarden.latesailor.dev (once)

The app used to live at https://repogarden.latesailor.dev, served from
`/var/www/repo-garden`. This moves it to https://gitube.latesailor.dev and
turns the old address into a redirect, in an order that keeps the site up
throughout. Do steps 1 to 3 **before merging** the change that moves the
deploy to `/var/www/gitube`; the deploy's smoke test fails until the new
address answers.

1. **DNS.** In Namecheap, add an A Record for `gitube` to `146.235.217.254`,
   as in step 1 above. Keep the `repogarden` record: the redirect needs it.
   Check with `nslookup gitube.latesailor.dev`.

2. **The new site, with the current build.** Copy the two files up:

   ```bash
   scp -i "/c/Users/lesst/OneDrive/Documents/Coding Space/Mordi_keys/ssh-key-2026-05-26.key" deploy/nginx/gitube.conf deploy/nginx/gitube-headers.conf deploy/nginx/repogarden-redirect.conf ubuntu@146.235.217.254:/tmp/
   ```

   On the VPS, make the new web root a copy of the old one (so tabs opened
   before the move still find their files), then install the site:

   ```bash
   sudo install -d -o www-data -g www-data -m 755 /var/www/gitube
   sudo rsync -a /var/www/repo-garden/ /var/www/gitube/
   sudo install -m 644 /tmp/gitube-headers.conf /etc/nginx/snippets/gitube-headers.conf
   sudo install -m 644 /tmp/gitube.conf /etc/nginx/sites-available/gitube
   sudo ln -s /etc/nginx/sites-available/gitube /etc/nginx/sites-enabled/gitube
   sudo nginx -t
   ```

   Only if `nginx -t` says the test is successful:

   ```bash
   sudo systemctl reload nginx
   sudo certbot --nginx -d gitube.latesailor.dev
   ```

   Choose redirect if certbot asks. Check `curl -sI https://gitube.latesailor.dev/`:
   both addresses now serve the same site.

3. **Umami.** In Umami, edit the website and set its domain to
   `gitube.latesailor.dev`. The website ID stays the same, so the stats keep
   one history.

4. **Merge.** The deploy now ships to `/var/www/gitube` and smoke-tests
   https://gitube.latesailor.dev. It warns (without failing) while the old
   address does not redirect yet.

5. **The redirect.** On the VPS, keep a copy of the old site's vhost, put the
   redirect in its place, and test:

   ```bash
   sudo cp /etc/nginx/sites-available/repo-garden ~/repo-garden.vhost.bak
   sudo install -m 644 /tmp/repogarden-redirect.conf /etc/nginx/sites-available/repo-garden
   sudo nginx -t
   ```

   Only if `nginx -t` says the test is successful, let certbot put HTTPS back
   on the old address (it reloads nginx itself):

   ```bash
   sudo certbot --nginx -d repogarden.latesailor.dev
   ```

   Choose to reinstall the existing certificate. If it offers to add an
   HTTP-to-HTTPS redirect, choose no redirect: the file already sends every
   request to the new address. Then check that a share link survives the move:

   ```bash
   curl -sI "https://repogarden.latesailor.dev/?repo=octocat/Hello-World" | grep -i '^location'
   ```

   It must say `location: https://gitube.latesailor.dev/?repo=octocat/Hello-World`.
   The next deploy's smoke test stops warning.

6. **Clean up, later.** Once the redirect has run for a while, the old web
   root can go: `sudo rm -r /var/www/repo-garden`. Keep the old certificate
   and the `repogarden` DNS record for as long as old links should work;
   certbot renews the certificate on its own.

**What visitors lose.** A browser keeps a site's storage per address, so
settings saved on the old address (a token, the theme, the layout, the sound)
and the repo and profile caches do not follow the redirect. Each visitor adds
their token and picks their theme once more on the new address. Nothing moves
the token across on purpose: it would have to travel in a URL.

## Updating headers or the vhost

The pipeline only ships `dist/`. If you change a file in `deploy/nginx/`, put
it on the VPS by hand before merging the change that needs it.

For the headers snippet, step 6 has the commands (copy, `nginx -t`, reload,
check).

The vhost does not go the same way. In step 3 certbot added the HTTPS (443)
server block and the HTTP-to-HTTPS redirect to the live
`/etc/nginx/sites-available/gitube`, and `deploy/nginx/gitube.conf`
has neither, so installing it over the live file removes them. Copy it up as
in step 6, with `deploy/nginx/gitube.conf` in place of the snippet. On
the VPS, keep the live file (certbot's lines included) and install the new
one:

```bash
sudo cp /etc/nginx/sites-available/gitube ~/gitube.vhost.bak
sudo install -m 644 /tmp/gitube.conf /etc/nginx/sites-available/gitube
sudo nginx -t
```

Only if `nginx -t` says the test is successful, rerun certbot, without
reloading nginx first:

```bash
sudo certbot --nginx -d gitube.latesailor.dev
```

It finds the existing certificate: choose to reinstall it (not renew), and
redirect if it asks. Certbot puts the 443 block and the redirect back and
reloads nginx itself; a reload before that would serve the site without
HTTPS. If `nginx -t` fails, do not run certbot or reload: fix the file and
install it again. Then check `curl -sI https://gitube.latesailor.dev/`.

For a small change you can instead edit the live, certbot-managed file
(`sudo nano /etc/nginx/sites-available/gitube`, then `nginx -t` and a
reload), which keeps certbot's lines. Make the same change in
`deploy/nginx/gitube.conf`, without certbot's lines, so the two agree.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `VPS_SSH_KEY is not set` | Secret missing on this repo. Secrets are per repo, so the portfolio's copy does not count. |
| `Permission denied (publickey)` in the rsync step | The secret's key is not in `authorized_keys` on the VPS. |
| `Host key verification failed` | The VPS was rebuilt. Update `VPS_HOST_KEY` in the workflow from `ssh-keyscan -t ed25519 146.235.217.254`. |
| Smoke test fails on the first push | DNS or certbot (steps 1 and 3) not done yet. The files are already synced, so rerun the job afterwards. |
| Smoke test fails with "does not allow https://stats.latesailor.dev" | The headers snippet on the VPS predates analytics: step 6 was not done before merging. The files are already synced, so install the snippet as in step 6, then rerun the job. |
| Graph never loads, console shows a CSP error | Something new is fetched from another host. Add it to `connect-src` in the headers snippet. |
| Tracker blocked by CSP, or no pageviews in Umami | A console error naming `stats.latesailor.dev` under `script-src` or `connect-src`: the headers snippet on the VPS was not updated (step 6). No request for `script.js` in the Network tab: the website ID is empty (or not a UUID) in `.env.production`, so the build never adds the tracker. `script.js` loads but nothing is posted to `/api/send`: Do Not Track is on in that browser, `umami.disabled` is set in its localStorage, or the page's hostname is not exactly `gitube.latesailor.dev` (`npm run preview` on localhost counts only in a build made with `VITE_UMAMI_DOMAINS`, see README; `npm run dev` never loads the tracker). An ad blocker can block the script too. |
| "couldn't load that part of gitube", "couldn't load this part", "couldn't load the recorder" or "couldn't load the part of gitube that saves videos" | An optional part (replay, vs, metro, themes, export, people or cleanup tab; or person mode, a `?user=` link, with its recorder and poster) could not be fetched, even on its retry under a new URL (`src/lazy/chunk.ts`). Usually the connection dropped. A deploy is not the cause unless the tab was left open across deploys for more than 30 days (step 5 keeps earlier builds' files that long). Reloading fixes it, and the message offers the reload. |
| `assets/` keeps growing | It should not: each deploy deletes the hashed files that no build has shipped for 30 days. Every deploy refreshes the modification time of each file in the current build, so a vendor chunk that never changes is never pruned. If the prune step fails, check that the deploy user can run `sudo find` without a password. |
