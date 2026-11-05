# MEMORY BANK — FundFXT

## 7. Commit Log

- 2026-11-05 — `fix: implement server-aware terminal restart in mt5_sync.py`: Added broker-server tracking to the MT5 worker, forced a terminal restart when switching broker servers, recorded the active server only after successful login, and repaired fallback reboot initialization and re-login checks.
