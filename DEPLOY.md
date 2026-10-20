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
| URL | https://repo-garden.latesailor.dev |
| VPS | `ubuntu@146.235.217.254` |
| Web root | `/var/www/repo-garden` |
| nginx vhost | `deploy/nginx/repo-garden.conf` to `/etc/nginx/sites-available/repo-garden` |
| Security headers | `deploy/nginx/repo-garden-headers.conf` to `/etc/nginx/snippets/repo-garden-headers.conf` |
| Pipeline | `.github/workflows/deploy.yml`, runs on every push to `master` |
| Secret | `VPS_SSH_KEY`, the same deploy key the portfolio uses |

## 1. DNS (Namecheap, once)

Domain List, then latesailor.dev, then Advanced DNS, then Add New Record:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| A Record | `repo-garden` | `146.235.217.254` | Automatic |

Check it from your laptop before running certbot:

```bash
nslookup repo-garden.latesailor.dev
```

## 2. The VPS (once)

Copy the two nginx files up from the repo folder on your laptop:

```bash
scp deploy/nginx/repo-garden.conf deploy/nginx/repo-garden-headers.conf ubuntu@146.235.217.254:/tmp/
```

Then on the VPS:

```bash
ssh ubuntu@146.235.217.254
sudo install -d -o www-data -g www-data -m 755 /var/www/repo-garden
sudo mv /tmp/repo-garden-headers.conf /etc/nginx/snippets/
sudo mv /tmp/repo-garden.conf /etc/nginx/sites-available/repo-garden
sudo ln -s /etc/nginx/sites-available/repo-garden /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d repo-garden.latesailor.dev
```

`nginx -t` guards the other sites on the box: if it fails, nothing is reloaded.
Certbot adds the 443 block and the HTTP to HTTPS redirect to the vhost file.
Ports 80 and 443 are already open, because the portfolio uses them.

## 3. GitHub (once)

Create the repo without pushing, so the first push happens after the secret exists:

```bash
gh repo create repo-garden --public --source .
```

Add the deploy key: the private half of the key whose public half is in
`/home/ubuntu/.ssh/authorized_keys` on the VPS, the same one the portfolio's
`VPS_SSH_KEY` secret holds. Either paste it in the browser under Settings,
Secrets and variables, Actions, or pipe the key file:

```bash
gh secret set VPS_SSH_KEY < path/to/your/deploy_key
```

The workflow accepts the raw key file or the key as one base64 line.

## 4. Ship

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
copy it up and reload nginx by hand, as in step 2.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `VPS_SSH_KEY is not set` | Secret missing on this repo. Secrets are per repo, so the portfolio's copy does not count. |
| `Permission denied (publickey)` in the rsync step | The secret's key is not in `authorized_keys` on the VPS. |
| `Host key verification failed` | The VPS was rebuilt. Update `VPS_HOST_KEY` in the workflow from `ssh-keyscan -t ed25519 146.235.217.254`. |
| Smoke test fails on the first push | DNS or certbot (steps 1 and 2) not done yet. The files are already synced, so rerun the job afterwards. |
| Graph never loads, console shows a CSP error | Something new is fetched from another host. Add it to `connect-src` in the headers snippet. |
