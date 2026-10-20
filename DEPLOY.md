# Deploying repo-garden

repo-garden goes on the Oracle VPS the same way the portfolio does: GitHub
Actions builds it, then rsyncs the static `dist/` folder into a web root that
the host nginx serves. There is no container and no server process, because the
app is plain files that talk to the GitHub API from the visitor's browser.

```
browser ─https─▶ host nginx (TLS, certbot) ─▶ /var/www/repo-garden (static files)
browser ─https─▶ api.github.com             (direct, with the visitor's own token if they add one)
```

| Thing | Value |
| --- | --- |
| URL | https://repogarden.latesailor.dev |
| VPS | `ubuntu@146.235.217.254` |
| Web root | `/var/www/repo-garden` |
| nginx vhost | `deploy/nginx/repo-garden.conf` to `/etc/nginx/sites-available/repo-garden` |
| Security headers | `deploy/nginx/repo-garden-headers.conf` to `/etc/nginx/snippets/repo-garden-headers.conf` |
| Pipeline | `.github/workflows/deploy.yml`, runs on every push to `master` |
| Secret | `VPS_SSH_KEY`, the private half of `~/.ssh/repogarden_deploy` |

## 1. DNS (Namecheap, once)

Domain List, then latesailor.dev, then Advanced DNS, then Add New Record:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| A Record | `repogarden` | `146.235.217.254` | Automatic |

Check it from your laptop before running certbot:

```bash
nslookup repogarden.latesailor.dev
```

## 2. A deploy key for this repo (laptop, once)

Run the laptop commands in Git Bash, from the repo folder. GitHub Actions logs
in to the VPS with its own key, separate from your Oracle login key, so it can
be revoked on its own if this repo ever leaks.

```bash
ssh-keygen -t ed25519 -C "repo-garden deploy" -f ~/.ssh/repogarden_deploy -N ""
```

That makes two files. `repogarden_deploy` is the private half and goes into the
GitHub secret. `repogarden_deploy.pub` is the public half and goes on the VPS.

## 3. The VPS (once)

Copy the public key and the two nginx files up, logging in with your Oracle key:

```bash
scp -i "/c/Users/lesst/OneDrive/Documents/Coding Space/Mordi_keys/ssh-key-2026-05-26.key" ~/.ssh/repogarden_deploy.pub deploy/nginx/repo-garden.conf deploy/nginx/repo-garden-headers.conf ubuntu@146.235.217.254:/tmp/
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
sudo install -d -o www-data -g www-data -m 755 /var/www/repo-garden
sudo install -m 644 /tmp/repo-garden-headers.conf /etc/nginx/snippets/repo-garden-headers.conf
sudo install -m 644 /tmp/repo-garden.conf /etc/nginx/sites-available/repo-garden
sudo ln -s /etc/nginx/sites-available/repo-garden /etc/nginx/sites-enabled/repo-garden
sudo nginx -t
```

Only if `nginx -t` says the test is successful, reload and add HTTPS:

```bash
sudo systemctl reload nginx
sudo certbot --nginx -d repogarden.latesailor.dev
```

If certbot asks whether to redirect HTTP to HTTPS, choose redirect. `nginx -t`
guards the other sites on the box: if it fails, nothing is reloaded. Ports 80
and 443 are already open, because the portfolio uses them.

## 4. The GitHub secret (laptop, once)

The secret holds the private half of the deploy key:

```bash
gh secret set VPS_SSH_KEY -R SailmanSeeulater/repo-garden < ~/.ssh/repogarden_deploy
```

The workflow accepts the raw key file or the key as one base64 line.

## 5. Ship

```bash
git push -u origin master
```

Watch it with `gh run watch`. The job runs the tests, builds, rsyncs, then
smoke-tests the live site: the page loads, hashed assets get a one-year cache,
and the security policy allows `api.github.com`. After that, every push to
`master` redeploys. To redeploy without a new commit, use Run workflow on the
Actions tab.

## Updating headers or the vhost

The pipeline only ships `dist/`. If you change a file in `deploy/nginx/`,
copy it up and reload nginx by hand, as in step 3.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `VPS_SSH_KEY is not set` | Secret missing on this repo. Secrets are per repo, so the portfolio's copy does not count. |
| `Permission denied (publickey)` in the rsync step | The secret's key is not in `authorized_keys` on the VPS. |
| `Host key verification failed` | The VPS was rebuilt. Update `VPS_HOST_KEY` in the workflow from `ssh-keyscan -t ed25519 146.235.217.254`. |
| Smoke test fails on the first push | DNS or certbot (steps 1 and 3) not done yet. The files are already synced, so rerun the job afterwards. |
| Graph never loads, console shows a CSP error | Something new is fetched from another host. Add it to `connect-src` in the headers snippet. |
