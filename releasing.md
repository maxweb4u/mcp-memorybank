---
title: "Releasing a new version"
doc_kind: process
doc_function: canonical
purpose: "Read before publishing any version: the ordered steps, what must be verified on the tarball rather than the working tree, and which pins move before the publish and which only after."
derived_from:
  - backlog.md
status: active
audience: humans_and_agents
---

# Releasing a new version

Three releases went out on 7 September 2026 and each one found a defect the previous step should
have caught. This is the order that would have caught them, written down so the fourth release does
not rediscover it.

A release touches **four places**, and they are not interchangeable:

| | What | When it moves |
|---|---|---|
| 1 | `package.json` — `version` | before the publish |
| 2 | `server.json` — `version` **and** `packages[0].version` | before the publish |
| 3 | `README.md` — the pin line in *Running it* | before the publish |
| 4 | live `.mcp.json` in the wired projects, and `~/.claude.json` | **only after** npm has the version |

The split at row 4 is the whole point of the ordering and is explained under
[Why the live pins wait](#why-the-live-pins-wait).

## The steps

**1. Commit the change itself first.** A release commit that also carries the fix makes it
impossible to tell later which commit a published tarball was built from.

**2. Bump `package.json` by hand.** Not `npm version patch`: that writes a commit and a tag of its
own, which takes the commit out of the author's hands.

**3. Bump `server.json` in both places.** `version` at the top and `packages[0].version` inside.
They are separate fields and nothing warns when they disagree.

**4. Bump the README pin line.** It is documentation in this repository, not a running config —
nothing breaks if it names a version that is a few minutes from existing, and leaving it behind is
how it ends up two releases stale.

**5. Build and test.**

```bash
npm run build && npm test
```

**6. Verify the tarball, never the working tree.** Pack it, install it into an empty directory, and
ask the server what it is:

```bash
npm pack --pack-destination /tmp/rel
cd /tmp/rel && mkdir -p app && cd app && npm init -y && npm install /tmp/rel/*.tgz
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"1"}}}' \
  | ./node_modules/.bin/mcp-memorybank --root ./memory_bank
```

Two things are being checked, and neither is visible from the source tree:

- `serverInfo.version` matches the version being released. It did not in 0.1.1 — the number was a
  literal in `src/server.ts`, so the package announced its predecessor to every client. No build and
  no test can see this: the string is only ever read by a client on the far side of the transport.
- `mcpName` is inside the packed `package.json`. The registry reads it from the tarball and nowhere
  else, which is why 0.1.0 could not be registered at all.

**7. Validate the registry manifest.**

```bash
mcp-publisher validate
```

**8. Check that no pin was missed, then commit steps 2–4 as one commit.**

```bash
grep -rn "mcp-memorybank@" README.md releasing.md
```

This step exists because it was skipped in the release that first wrote this file down, and the
README pin went out a version behind.

**9. Publish to npm.**

```bash
npm publish --access public
```

The account has `auth-and-writes` two-factor, and modern npm does not ask for a typed code: it
prints a `npmjs.com/auth/cli/…` link and waits for ENTER to open a browser. `prepublishOnly` runs
the build and the tests again, so a stale `dist/` cannot ship.

Reading lags writing by a minute or two — `npm view` returning 404 straight after a successful
publish is propagation, not failure. The terminal line `+ @maxweb4u/mcp-memorybank@X.Y.Z` is the
authority.

**10. Tag the commit and push it.**

```bash
git tag -a vX.Y.Z <commit> -m "…"
git push origin vX.Y.Z
```

The tag goes on the commit the tarball was built from, which is the commit that was clean at publish
time — not necessarily `HEAD` by the time you get here.

**11. Publish to the MCP registry.**

```bash
mcp-publisher publish
```

If it answers "Invalid or expired Registry JWT token", re-run `mcp-publisher login github` first.

**12. Only now, move the live pins.** The three `.mcp.json` files and the `~/.claude.json` entry.

**13. Verify the pins by starting the server, not by reading the file.** From each project
directory:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"1"}}}' \
  | npx -y @maxweb4u/mcp-memorybank@X.Y.Z --root "$PWD/memory_bank"
```

This is not ceremony. The 0.1.1 version defect was found by exactly this check and by nothing else:
the config files all read correctly, and the server started from them reported the wrong number.

## Why the live pins wait

The four wired projects run `npx -y @maxweb4u/mcp-memorybank@X.Y.Z`. Point one at a version the
registry does not have yet and it does not degrade — it fails, and the server is simply gone from
that project until someone notices. The window between the commit and the publish is only minutes,
but there is nothing to gain by opening it: nothing in the repository depends on those files, and
they are not in this repository at all.

The README pin is the opposite case and moves early, for the same reason: nothing executes it.

## Traps already paid for

- **`npx` does not work inside this repository.** See *From a clone* in
  [README.md](README.md#from-a-clone). Check the published package from a temporary directory.
- **The registry caps `description` at 100 characters.** `package.json` has no such cap, so the two
  descriptions differ on purpose; `mcp-publisher validate` is what catches an over-long one, not
  `init`.
- **`mcp-publisher init` invents an `environmentVariables` block** with a `YOUR_API_KEY` this server
  has never read. It has to be replaced with `packageArguments` for `--root`. Re-running `init` will
  reintroduce it.
- **npm's similarity check ignores punctuation.** The unscoped name is unavailable for good; the
  package is scoped and the `bin` is not.
- **A 404 from `npm publish` means the login expired.** npm answers a write it will not authorise
  with `404 Not Found - PUT .../@maxweb4u%2fmcp-memorybank`, which reads as if the package did not
  exist. It does — the read side proves it, `npm view` still works. Browser auth does not last the
  day; `npm whoami` answers `401 Unauthorized` once it has, and that is the check to run first,
  because the publish output says nothing about it. `npm login` fixes it.

  On 0.2.1 this cost two attempts, because the first failure also happened to be missing
  `--access public` and that looked like the cause. It was not: the flag matters only on a
  package's **first** publish, when a scoped package would otherwise default to restricted. The
  publish that succeeded was a plain `npm publish` after logging in.
