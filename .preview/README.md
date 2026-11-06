# sourcejump2web-dev previews

This repo is a playground for the SourceJump website. Fork it, change things and open a pull request. Your
change goes live at `https://<your-github-name>-sj.okwhiteli.st`, showing real data from the SourceJump beta.

## How it works
- `main` follows [sourcejump/sourcejump](https://github.com/sourcejump/sourcejump). It's upstream plus one
  commit: this folder and the `preview-*` workflows. `preview-sync` merges upstream in every 15 minutes.
- **Open a PR against `main`.** It's moved to your own branch, `u/<your-name>`, and merged there. That
  branch is created from `main` the first time.
- **Open a PR against someone's `u/<name>`** to work on their branch. It stays there.
- Your first PR waits for a maintainer to add the `preview-ok` label. Later ones merge straight away.
- PRs that change `.github/` or `.preview/` are never merged automatically.
- Each merge rebuilds that branch's site. Deleting the branch takes the site down.
- Previews run only the website (`web/`). Changes under `api/` won't show up in a preview. The data comes
  from the beta API, read-only: sign-in and anything else that writes is turned off on previews.
- Finished work goes to upstream as a normal PR to `sourcejump/sourcejump`. Leave out this folder and the
  `preview-*` workflows.

## Maintainer setup
1. **GitHub repo settings**
   - Actions → General → Workflow permissions: read-only. Tick "Allow GitHub Actions to create and approve
     pull requests". Fork PR workflows: require approval for first-time contributors.
   - Environments: create `mirror` and `preview-deploy`. Set deployment branches to `main` only on both.
   - `mirror` secret `MIRROR_DEPLOY_KEY`: private half of a repo deploy key with **write** access. Needed
     because upstream commits sometimes change workflow files, which GITHUB_TOKEN may not push.
   - `preview-deploy` secrets:
     - `PREVIEW_SSH_KEY`: private half of the server SSH key
     - `PREVIEW_SSH_TARGET`: `sjpreview@149.28.171.130`
     - `PREVIEW_SSH_KNOWN_HOSTS`: output of `ssh-keyscan 149.28.171.130`
   - Optional variables: `PREVIEW_API_URL` (default `https://beta.sourcejump.net`), `PREVIEW_HOST_SUFFIX`
     (default `-sj.okwhiteli.st`).
   - Create the `preview-ok` label.
2. **Server (AU):**
   - In Cloudflare, go to SSL/TLS → Origin Server → Create certificate for `*.okwhiteli.st`. Save it on AU
     as `/etc/ssl/sj-preview/origin.pem` and `origin.key`.
   - Copy `.preview/server/` to AU, then run `sudo ./install.sh "<public half of the preview key>"`.
   - Add a Cloudflare DNS record: `*` A → AU's IP, proxied.
3. Test by hand: Actions → Preview build → Run workflow on `main` with `branch: u/<you>`. Create the branch
   first.
