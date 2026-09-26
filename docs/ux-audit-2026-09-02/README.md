# Useful Brain UX audit, 2 September 2026

End-to-end record of the operator workspace on local loopback, captured to decide the page set, turn Evaluations into a read-only proof dashboard, and restyle the shell.

## Capture conditions

| | |
|---|---|
| Environment | Local Cloudflare preview, `http://127.0.0.1:8788` |
| Date | 2 September 2026 |
| Viewport | 1440 × 900 CSS px |
| Account | Loopback operator on `127.0.0.1` (single-operator product; no public signup) |
| Corpus | Northwind synthetic support set, 65 documents / 717 chunks, retrieval ready |

## How to read the files

- `NN-<flow>-scroll-01.png` is one viewport at the reference size.
- Companion documents below are the audit of record.

## Folders

| File prefix | Covers |
|---|---|
| `01-chat` | Empty composer + suggestions + conversation rail |
| `02-knowledge` | Corpus inventory and first-run / promote chrome |
| `03-evaluations` | Current live 10-case runner (not the 120-question campaign) |
| `04-settings` | Operator identity, assume-principal, retrieval status |

## Companion documents

- `flow-map.md`: what each page does, in journey order
- `friction-log.md`: what it costs the user
- `bugs.md`: defects with confirmed cause
- `HANDOFF.md`: sequence for the next session

## Coverage

Captured: Chat, Knowledge base, Evaluations, Settings at 1440×900. Not captured: a live 120-question run from the UI (that path is the thing we are removing), mobile 360px (follows after the shell lock), or a first-run empty corpus (this persist state is already seeded).
