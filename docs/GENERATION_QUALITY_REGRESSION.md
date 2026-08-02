# Generation Quality Golden Regression

Deterministic structural evidence set. It intentionally changes geometry and finish independently; it does not call a paid VLM or generation provider.

Generated with structural evidence version: `structural-evidence-v1`.

| Case | Expected | Contours | Layout | Protected zones | Result |
|---|---|---:|---:|---:|---|
| finish-only-color-change | Facade finish color changes while structural edges stay fixed | 9762 | 8556 | 9554 | PASS |
| house-position-shift | Whole house moves horizontally | 7280 | 8419 | 5297 | PASS |
| roof-outline-change | Roof ridge moves and changes the roof outline | 8385 | 8842 | 8185 | PASS |
| opening-position-change | A protected window is moved | 9629 | 9933 | 9088 | PASS |
| allowed-roof-change | Roof change explicitly allowed by the user | 8385 | 8842 | 8636 | PASS |

Summary: 5/5 cases passed.
