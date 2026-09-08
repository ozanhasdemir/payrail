# Roadmap

Six days, Sept 7 to 12, submission Friday night, hard stop Saturday Sept 13 10:00 EDT.

| Day | Goal | Gate |
|---|---|---|
| Sun 7 | Every external dependency proven with one real tx | DONE: Privy policy-gated pay on Arc, ENS records via wildcard, contracts deployed and verified |
| Mon 8 | Contracts deployed, agent parses and matches | DONE early: run-all gives paid / pending_approval / rejected on Arc |
| Tue 9 | Money moves both paths | DONE Mon: auto-pay, 2-of-3 approval pays the pool, receivable sold at 12% APR discount |
| Wed 10 | Dashboard complete, pool flow polished | DONE Mon: buyer/supplier/pool pages live, World ID onboarding wired, reset+replay for the video |
| Thu 11 | Stretch tracks, then polish | Feature freeze 20:00 ET |
| Fri 12 | Video, README, submit | Submitted |

## Bounties

Core: Privy B2B, Privy Financial Flow, Arc stablecoin pool, ENSv2.
Stretch (in order): The Graph AI, Bazantic x2, Arc Circle Agent Stack, World Selfie Check (gated beta, split prize, demoted 2026-09-07).
Skipped: every continuity track, 1inch, Uniswap, Hedera, Chainlink.

## Cut order

1. Subgraph
2. Bazantic registration
3. Circle Agent Wallet for the supplier agent
4. MCP server, keep a CLI
5. Pool deposit and withdraw UI

Never cut: Privy policy-gated payment on Arc, approval path, ENS resolution, sell-receivable, demo video.

## Submission rules to respect

- Video 2 to 4 minutes, 720p or better, clear narration, no music, no speed-ups.
- Public repo, frequent small commits, no single large dump.
- Start from scratch. No pre-existing code beyond boilerplate.
