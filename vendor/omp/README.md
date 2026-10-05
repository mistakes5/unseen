# Pinned local OMP build

The installed Classroom Copilot uses **OMP 18.3.1 with local patches**, rather
than an arbitrary npm release. Its upstream source is MIT-licensed
[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi), based at
`6204b7508014bcdf12d95f0b3fd470905fd99344`. `local.patch` captures the 25 changed
source/example/test files; `source.json` pins the base, patch hash, each patched
file hash, Bun version and the captured executable hash. The included `LICENSE`
preserves upstream attribution. No private reports or authentication stores are
included.

The private configuration bundle can carry the **exact installed darwin-arm64
executable**, SHA-256:

```text
19dc7b41d3eba878fb6b796ccf91a0d6cbb7bb8b132056d0a65d013cb2f56849
```

Restoring that captured executable is the direct route to the current runtime.
A fresh compilation of the source may differ in binary bytes because of native
toolchains, build metadata and code signing; source equality alone does not
prove equality to a previously compiled executable.

## Reconstruct the source

From the Classroom Copilot repository:

```sh
npm run omp:source -- --dest "$HOME/Developer/omp-classroom-pinned"
```

The tool refuses an existing destination, fetches the exact commit, checks the
patch, applies it, and verifies all 25 changed files. It does not install a global
executable or modify another OMP checkout. It needs Git and network access.

## Alternative: compile the reconstructed source

Use Bun **1.3.14**, the source's `bun.lock`, Xcode Command Line Tools and the
native Rust build prerequisites documented in that pinned source. On the target
Apple Silicon Mac:

```sh
cd "$HOME/Developer/omp-classroom-pinned"
bun install --frozen-lockfile
OMP_NATIVE_BUILD_BACKEND=cargo bun run build:native
bun --cwd=packages/coding-agent run build
packages/coding-agent/dist/omp --version
```

The upstream binary build generates the native embedding and UI assets and
ad-hoc signs the resulting executable. Set `CLASSROOM_OMP_BIN` to its absolute
path for an app invocation, or put a symlink in a default app-discovered location
(`~/.bun/bin/omp`, `~/.local/bin/omp`, `/opt/homebrew/bin/omp`, `/usr/local/bin/omp`).
No package publish, global symlink replacement, source PR or paid evaluation is
part of these steps. Source reconstruction is verified independently from the
captured runtime; the native compilation recipe is an alternative, not a claim
of byte-identical binary reproduction.

Sign in through this OMP executable's interactive `/login` before using the app.
Its auth store is private and separate from the repository. The app supplies its
own temporary per-request settings; a global OMP config backup is unnecessary for
the captured classroom answer route.
