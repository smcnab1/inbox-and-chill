# Contributing

Open issues and pull requests against [this fork](https://github.com/smcnab1/inbox-and-chill) for the iPhone companion, private relay, local installation or fork documentation. Use [upstream](https://github.com/brandonlucasgreen/inbox-and-chill) to check for existing reports about shared Mac functionality. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

1. Start a focused branch from the fork’s current `main`. Keep companion and repository changes separate from shared Mac fixes so upstream-ready changes can be reviewed independently.
2. Describe the behaviour, relevant source and affected versions. Use fictional queue items and remove tokens, pairing codes, endpoint names and personal information from logs and screenshots.
3. Run the relevant checks and record the results in the PR. For live checks, state which interactions you observed and which are still unverified.

## Local checks

| Area | Check |
| --- | --- |
| Mac app | Generate the project with `xcodegen generate`. Follow the [local test guide](docs/testing-locally.md) or the ad-hoc signing invocation in [CI](.github/workflows/ci.yml). |
| Shell scripts | Run `scripts/check-shell.sh` with ShellCheck installed. |
| Companion | From `companion/`, run `npm ci && npm test`, then `npx playwright install chromium webkit && npm run test:browser`. |
| Documentation | Check relative links and assets. Verify setup commands against the scripts and use sample data in captures. |

## Syncing upstream

Keep the GitHub fork relationship and bring upstream changes in through a PR to the fork. Fetch only upstream `main`, so upstream release tags stay out of the sync.

```sh
git remote add -t main --no-tags upstream https://github.com/brandonlucasgreen/inbox-and-chill.git
git fetch --no-tags origin main
git fetch --no-tags upstream main
git log --oneline origin/main..upstream/main
```

Add the remote only on first setup. If the log lists incoming commits, create a fresh branch and merge upstream into it.

```sh
git switch -c fix/sync-upstream-main origin/main
git merge upstream/main
```

Review changes to the shared Swift app and resolve overlaps with the companion, local installer and update configuration. Run CI and review the fork delta with `git diff upstream/main...HEAD` before submitting the sync PR. Use a **merge commit** for the sync PR to preserve upstream ancestry. Develop any future upstream contribution on a separate branch created from `upstream/main`, with only the relevant shared changes.
