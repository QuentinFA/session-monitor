# 0029. A stat stacks its details and definition under its value

- Status: accepted
- Amends: 0027, § "Decision"
- Date: 2026-10-15

## Context

ADR 0027 laid each stat out on one line — label, value, bar, details — with its definition cut to
one line under it. The monitor is usually docked beside the conversation, some 45 columns wide:
there the bar left the details a few characters, every detail and definition ended in `…`, and a
cut bar spilled onto a line of its own.

## Decision

A stat is three lines: the label, the value and — for a percentage — its bar, sized to what the
pane's width leaves (5 to 30 cells); then its details; then its definition. Details and definitions
wrap rather than being cut. A blank line separates stats while definitions show.

## Consequences

- The tab is taller: about four lines a stat with definitions, two without.

## Alternatives considered

- Keeping one line and cutting less — at 45 columns nothing fits beside a label, a value and a bar.
