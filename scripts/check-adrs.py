#!/usr/bin/env python3
"""Check that the ADRs in docs/adr agree with each other and with the index.

A decision that is superseded or amended is recorded in two places — the new ADR declares it,
the old one's Status line points back — and a reader who lands on the old ADR only learns it is
out of date from that pointer. Nothing but this check keeps the two halves in step.

Usage: python3 scripts/check-adrs.py   (exit 1 on any problem)
"""
import re
import sys
from pathlib import Path

ADR_DIR = Path(__file__).resolve().parent.parent / "docs" / "adr"
FILE_NAME = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
STATUS = re.compile(
    r"^(?:(?:proposed|accepted)(?:, amended by \d{4}(?:, \d{4})*)?|superseded by \d{4})$")
INDEX_ROW = re.compile(r"^\| \[(\d{4})\]\(([^)]+)\) \| .+ \| (.+?) \|$")


def amended_by(status):
    if "amended by" not in status:
        return set()
    return set(re.findall(r"\d{4}", status.split("amended by", 1)[1]))


def header_values(text, key):
    return [m.group(1).strip() for m in re.finditer(rf"^- {key}: (.+)$", text, re.MULTILINE)]


def main():
    problems = []
    adrs = {}
    for path in sorted(ADR_DIR.glob("*.md")):
        if path.name in ("README.md", "template.md"):
            continue
        match = FILE_NAME.match(path.name)
        if not match:
            problems.append(f"{path.name}: name is not NNNN-kebab-title.md")
            continue
        number = match.group(1)
        if number in adrs:
            problems.append(f"{path.name}: number {number} is already used by {adrs[number]['file']}")
            continue
        text = path.read_text(encoding="utf-8")
        if not text.startswith(f"# {number}. "):
            problems.append(f"{path.name}: first line must be '# {number}. <title>'")
        statuses = header_values(text, "Status")
        status = statuses[0] if len(statuses) == 1 else None
        if status is None:
            problems.append(f"{path.name}: needs exactly one '- Status:' line")
        elif not STATUS.match(status):
            problems.append(f"{path.name}: unknown status '{status}'")
        adrs[number] = {
            "file": path.name,
            "text": text,
            "status": status or "",
        }
        for key in ("Supersedes", "Amends"):
            values = header_values(text, key)
            if not all(re.match(r"\d{4}\b", v) for v in values):
                problems.append(f"{path.name}: each '- {key}:' line must start with an ADR number")
            adrs[number][key] = {v[:4] for v in values if re.match(r"\d{4}\b", v)}

    for number, adr in adrs.items():
        name = adr["file"]
        supersedes, amends = adr["Supersedes"], adr["Amends"]
        for target in sorted(supersedes | amends):
            if target not in adrs:
                problems.append(f"{name}: refers to ADR {target}, which does not exist")
        for target in sorted(supersedes & adrs.keys()):
            if adrs[target]["status"] != f"superseded by {number}":
                problems.append(f"{adrs[target]['file']}: Status must be 'superseded by {number}' "
                                f"(declared by {name})")
        for target in sorted(amends & adrs.keys()):
            other = adrs[target]
            if number not in amended_by(other["status"]):
                problems.append(f"{other['file']}: Status must list 'amended by {number}' "
                                f"(declared by {name})")
            if f"Amended by [ADR {number}]" not in other["text"]:
                problems.append(f"{other['file']}: the section {name} replaces needs a "
                                f"'> **Amended by [ADR {number}](...)**' line")

        # The reverse direction: a pointer back must be backed by a declaration.
        superseded_by = re.fullmatch(r"superseded by (\d{4})", adr["status"])
        if superseded_by and superseded_by.group(1) in adrs:
            if number not in adrs[superseded_by.group(1)]["Supersedes"]:
                problems.append(f"{adrs[superseded_by.group(1)]['file']}: must declare "
                                f"'- Supersedes: {number}' ({name} says it is superseded by it)")
        for source in sorted(amended_by(adr["status"])):
            if source not in adrs:
                problems.append(f"{name}: amended by ADR {source}, which does not exist")
            elif number not in adrs[source]["Amends"]:
                problems.append(f"{adrs[source]['file']}: must declare '- Amends: {number} ...' "
                                f"({name} says it is amended by it)")

    index = {}
    for line in (ADR_DIR / "README.md").read_text(encoding="utf-8").splitlines():
        row = INDEX_ROW.match(line)
        if row:
            number, target, status = row.groups()
            if number in index:
                problems.append(f"README.md: ADR {number} is listed twice")
            index[number] = (target, status)
    for number, adr in adrs.items():
        if number not in index:
            problems.append(f"README.md: ADR {number} is missing from the index")
            continue
        target, status = index[number]
        if target != adr["file"]:
            problems.append(f"README.md: ADR {number} links to {target}, not {adr['file']}")
        if status != adr["status"]:
            problems.append(f"README.md: ADR {number} is listed as '{status}' but its Status "
                            f"line says '{adr['status']}'")
    for number in sorted(index.keys() - adrs.keys()):
        problems.append(f"README.md: lists ADR {number}, which has no file")

    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        print(f"\n{len(problems)} ADR problem(s). See docs/adr/README.md.", file=sys.stderr)
        return 1
    print(f"{len(adrs)} ADRs consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
