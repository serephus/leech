# Development

## Toolchain

- **Node ≥ 20** (the dev shell and CI use Node 24; the action runs on the
  runner's Node 24)
- **pnpm** (CI pins `11.22.0`)
- **Nix** (optional, via the flake, for a reproducible dev shell and packaged
  CLI)

## Commands

```sh
nix develop # node 24 + pnpm dev shell (flake.nix)
nix build   # build the packaged CLI (packages.default)
nix run .# -- --help # run the packaged CLI without installing

pnpm install
pnpm typecheck # tsc --noEmit
pnpm test      # vitest
pnpm build     # esbuild -> dist/index.js + dist/cli.js
```

`pnpm build` bundles two entry points with esbuild: `src/index.ts` (the action)
and `src/cli.ts` (the CLI). `dist/` is gitignored.

## Tests

`vitest` covers the pure and near-pure units — config parsing, filters, render
templates, assets, the LeetCode client, the watermark helper, git plumbing, and
hooks (including environment scrubbing and the workspace round-trip).

```sh
pnpm test        # one shot
pnpm test:watch  # watch mode
```

## The flake

`flake.nix` packages the CLI as `packages.default` and provides the dev shell.
Because it uses `fetchPnpmDeps`, the dependency hash is pinned: when
`pnpm-lock.yaml` changes, run `nix build` and paste the new hash it reports into
`flake.nix`.

## Continuous integration

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | pull requests | install, `typecheck`, `test`, `build` |
| `git-linear-checks.yml` | pull requests | linear-history check via [`serephus/perch`](https://github.com/serephus/perch) |
| `dist.yml` | tag push (`v*`) | builds `dist/`, commits it on top of the tag, force-moves the tag |
| `monthly-semver-release.yml` | monthly cron | opens a version-bump PR (updates `README.md` and `package.json`) |
| `tag-on-merge.yml` | version-bump PR merged | creates the release tag |
| `pages.yml` | pushes to `site/**` | builds and deploys this website |

### Why `dist/` isn't committed to `main`

GitHub Actions requires the bundled `dist/index.js` to exist at the ref you
reference. Rather than commit build output to `main` (and fight merge
conflicts), `dist.yml` bundles it onto the pushed tag. That's why you must
reference a release tag (`@<ActionTag />`) and not `@main`.

### Release flow

1. The monthly workflow bumps the patch version in `README.md` and
   `package.json` and opens a PR.
2. Merging that PR triggers `tag-on-merge.yml`, which reads the new tag out of
   `README.md` and creates it.
3. The tag push triggers `dist.yml`, which builds `dist/` and moves the tag to
   the commit containing it.

The website reads its version directly from `package.json`, so it stays in sync
automatically.

## Repository layout

```text
src/            TypeScript sources (the action + CLI)
test/           vitest suites
docs/           design docs (hooks.md)
site/           this website (VitePress; its own isolated pnpm project)
.github/        CI, release, and Pages workflows
flake.nix       Nix package + dev shell
```
