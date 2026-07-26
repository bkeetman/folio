# Architecture and UX optimization roadmap

This roadmap turns the July 2026 codebase, performance, layout, and GUI audit into an executable program. GitHub is the source of truth for status, ownership, and blocking relationships.

- [Milestone: Architecture & UX optimization](https://github.com/bkeetman/folio/milestone/1)
- Work rule: implement one issue from the dependency frontier at a time and keep the repository green between slices.

## Phase 1: Stable foundation

- [#1 Make the full build and verification baseline green](https://github.com/bkeetman/folio/issues/1)
- [#2 Introduce a web/native platform adapter](https://github.com/bkeetman/folio/issues/2)
- [#3 Document runtime and schema ownership](https://github.com/bkeetman/folio/issues/3)
- [#4 Remove the legacy scanner path](https://github.com/bkeetman/folio/issues/4)

## Phase 2: Frontend feature boundaries

- [#5 Extract a dedicated Changes module](https://github.com/bkeetman/folio/issues/5)
- [#6 Add integration tests for change apply and undo](https://github.com/bkeetman/folio/issues/6)
- [#7 Consolidate background operation state](https://github.com/bkeetman/folio/issues/7)
- [#8 Extract the Library route module](https://github.com/bkeetman/folio/issues/8)
- [#9 Extract the Fix route module](https://github.com/bkeetman/folio/issues/9)
- [#10 Extract the eReader route module](https://github.com/bkeetman/folio/issues/10)
- [#11 Extract Organizer and Settings route modules](https://github.com/bkeetman/folio/issues/11)
- [#12 Reduce the application component to a thin shell](https://github.com/bkeetman/folio/issues/12)

## Phase 3: Backend feature boundaries

- [#13 Extract Rust library, scanner, and import domains](https://github.com/bkeetman/folio/issues/13)
- [#14 Extract Rust metadata and cover domains](https://github.com/bkeetman/folio/issues/14)
- [#15 Extract Rust changes, eReader, and organizer domains](https://github.com/bkeetman/folio/issues/15)
- [#16 Reduce the Tauri root to command wiring](https://github.com/bkeetman/folio/issues/16)

## Phase 4: Layout, GUI, and accessibility

- [#17 Make the toolbar route-aware](https://github.com/bkeetman/folio/issues/17)
- [#18 Restructure sidebar navigation](https://github.com/bkeetman/folio/issues/18)
- [#19 Make the inspector context-aware](https://github.com/bkeetman/folio/issues/19)
- [#20 Complete an accessibility pass](https://github.com/bkeetman/folio/issues/20)
- [#21 Establish a consistent visual and loading foundation](https://github.com/bkeetman/folio/issues/21)

## Phase 5: Scale and verification

- [#22 Improve cover delivery and cache behavior](https://github.com/bkeetman/folio/issues/22)
- [#23 Benchmark libraries at 1k, 5k, and 20k items](https://github.com/bkeetman/folio/issues/23)
- [#24 Add server-side projection and paging if benchmarks require it](https://github.com/bkeetman/folio/issues/24)
- [#25 Automate critical user flows](https://github.com/bkeetman/folio/issues/25)
- [#26 Update architecture, performance, and contributor documentation](https://github.com/bkeetman/folio/issues/26)
