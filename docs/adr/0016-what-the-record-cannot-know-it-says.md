# 0016. What the record cannot know, it says it cannot know

- Status: accepted
- Amends: 0003, § "Decision"
- Date: 2026-10-09

## Context

Two gaps showed up as confident, wrong answers:

- The engine counts lines for only the first few files a Bash command changes and lists the rest by
  path alone. A script that wrote fourteen files showed five with counts and nine as `+0 −0` — which
  reads as "changed nothing", the opposite of what happened.
- A directory was labelled `not git` though it is a repository. Git can fail to run in a directory
  for reasons that say nothing about it — a timeout, a refusal — and the record took any failure
  for "no", then cached the "no" for the session. A headless reproduction ran git there without
  trouble, so the failure was passing; the label was not.

## Decision

- A file the engine lists without counts is counted from git's view of the repository before and
  after the command, when it lies in the command's repository; a file new to git is counted whole.
  Otherwise it is recorded as changed but **uncounted**, drawn `±?`, never `+0 −0`.
- A directory is `not git` only when git ran there and said so. When git could not run in a
  directory that exists, it is **repo unknown**. A missing directory — a deleted file's — is still
  probed through its parent. Only a repository is cached; a "no" is asked again next time.

## Consequences

- `±?` is honest and unhelpful: a file outside the command's repository, changed by a command the
  engine did not fully count, has no line count anywhere.
- A directory recorded as repo unknown keeps that label in the record even if git later runs there;
  the next touch of it is filed under its repository as a group of its own.

## Alternatives considered

- Counting every listed file from git whatever the engine reported — slower on every command, and it
  would replace the engine's exact counts with git's net ones.
- Retrying git before giving up — it delays the tool call the recording follows, for a case that
  should be rare.
