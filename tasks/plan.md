# Implementation Plan: Stage 12 Pro, editor, 4K and comparison

## Outcome

Add paid Pro generation, protected text/mask edits, verified 4K export and comparison of up to four completed variants. Reuse the existing queue, wallet, private S3 storage and mandatory automatic quality control. Keep every incomplete feature disabled by default.

## Architecture decisions

- Standard, Pro and edits remain generation records; `parent_generation_id` forms the version tree.
- 4K is a separate asynchronous upscale task linked to an approved completed generation.
- Every paid action uses its existing action code and a unique wallet reservation; provider failure refunds that reservation idempotently.
- Custom masks are private S3 objects; generated and upscaled files use short-lived owner-checked URLs.
- Comparison access is derived server-side from a paid Optimum/Maximum entitlement.
- Provider capabilities stay disabled until official documentation and a measured live smoke confirm them.

## Vertical slices

1. Durable model: generation kind, version links, edit scopes, 4K tasks and comparisons.
2. Pro: selected provider, 2-credit queue path and the existing quality control.
3. Editor: text/scoped/mask edits, protected zones, version tree and 1-credit refund-safe action.
4. 4K: separate provider/task, real output dimensions, artifact checks and 1-credit refund-safe action.
5. Comparison: up to four variants, Optimum/Maximum gate, winner, favorites and private collage.
6. Release: approved-budget live smokes, final complete tests/build/E2E and documentation.

## External gates

- A new explicit spending limit is required before paid GenAPI smoke tests.
- Pro, edit and 4K stay disabled until their individual live smokes pass.
- Stage 13 is out of scope.

