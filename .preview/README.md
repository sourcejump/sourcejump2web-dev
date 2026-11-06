# sourcejump2web-dev previews

This repo is a playground for the SourceJump website. Fork it, change things and open a pull request. Your
change goes live at `https://<your-github-name>-sj.okwhiteli.st`, showing real data from the SourceJump beta.

## How it works
- `main` follows [sourcejump/sourcejump](https://github.com/sourcejump/sourcejump). It's upstream plus
  this folder and the `preview-*` workflows. `preview-sync` merges upstream in every 15 minutes.
- **Open a PR against `main`.** It's moved to your own branch, `u/<your-name>`, and merged there. That
  branch is created from `main` the first time.
- **Open a PR against someone's `u/<name>`** to work on their branch. It stays there.
- PRs that change `.github/` or `.preview/` are never merged automatically.
- Each merge rebuilds that branch's site. Deleting the branch takes the site down.
- Previews run only the website (`web/`). Changes under `api/` won't show up in a preview. The data comes
  from the beta API, read-only: sign-in and anything else that writes is turned off on previews.
- Finished work goes to upstream as a normal PR to `sourcejump/sourcejump`. Leave out this folder and the
  `preview-*` workflows.
