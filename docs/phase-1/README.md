# Ludo League rebuild: Phase 1

Start with the repository assessment. These documents define the rebuild boundaries and explicitly separate observed implementation from proposed behavior.

- [Assessment and reuse/replacement ledger](assessment.md)
- [Production architecture, realtime, offline and dice policies](architecture.md)
- [MySQL model and migration safety](database-model.md)
- [Board structure and design proposal](board-redesign.md)
- [Twenty-phase build plan and acceptance checks](build-plan.md)
- [Baseline verification and limitations](verification.md)

Baseline source: a89b8e2. No application functionality is replaced in this phase. The next increment is the additive database/migration foundation; board work follows validated topology and engine behavior.
