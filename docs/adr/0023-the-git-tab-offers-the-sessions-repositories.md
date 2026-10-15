# 0023. The Git tab offers the session's repositories, granted ones included

- Status: accepted
- Date: 2026-10-15

## Context

A session works across repositories (ADR 0002), so a history of the working directory's alone would
miss most of them. A directory granted during the session — `/add-dir` — is a repository the session
may work in next, before Outputs has seen anything there. The engine gives no list of the directories
granted; it raises `DirectoryAdded` as each is.

## Decision

The tab offers, in a picker: the working directory's repository first, then every repository Outputs
recorded, then the repository of every directory granted while the plugin ran, recorded from
`classic.DirectoryAdded` into state. A single repository is shown without a picker.

## Consequences

- A directory granted before the plugin loaded, or through settings, is not offered until the
  session works in it and Outputs records it.
- Listing the access granted during a session — directories and permissions — is a separate idea,
  for a tab of its own; this tab only offers the repositories.

## Alternatives considered

- The working directory's repository alone — misses multi-repository work, which is what the
  monitor is for.
- Reading the granted directories from settings — they are spread over several files and do not
  show what the session itself was granted.
