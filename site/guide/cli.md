# Local CLI

The same pipeline that powers the action is available as a CLI, which is the
best way to iterate on templates before you push a workflow. It needs no GitHub
Actions runner.

## Build

```sh
pnpm build
```

This produces `dist/index.js` (the action) and `dist/cli.js` (the CLI) with
esbuild.

## Run

```sh
node dist/cli.js \
  --config @config.yaml \
  --session "$LEETCODE_SESSION" --csrf "$LEETCODE_CSRF_TOKEN" \
  --token "$GITHUB_TOKEN" --repo serephus/my-solutions \
  --dry-run
```

- `--config` accepts an inline YAML string **or** a path prefixed with `@`
  (e.g. `@config.yaml`).
- `--dry-run` renders everything and logs the commits it *would* create, without
  touching the remote. Always start here.

Environment fallbacks let you skip the flags: `LEECH_CONFIG`,
`LEETCODE_SESSION`, `LEETCODE_CSRF_TOKEN`, `GITHUB_TOKEN`.

## Under Nix

The flake packages the CLI as well:

```sh
nix develop            # node 24 + pnpm dev shell
nix build              # build the packaged CLI (packages.default)
nix run .# -- --help   # run the packaged CLI without installing
```

See [Development](/development) for tests, type checking, and the release
process.
