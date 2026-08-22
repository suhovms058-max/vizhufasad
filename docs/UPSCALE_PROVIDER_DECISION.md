# 4K upscale provider decision

## Current decision

Use GenAPI `drct-super-resolution` as the first 4K smoke candidate. Keep the feature disabled until a private facade result is actually enlarged, downloaded, decoded and confirmed to be at least 3840×2160 (or 2160×3840) without a material structure change.

## Evidence

| Candidate | Official input/control | Published positioning | Stage 12 decision |
| --- | --- | --- | --- |
| DRCT Super Resolution | `image_url`, `upscaling_factor` with 2–4× support | Photo/general upscale focused on structure and artifact removal | Primary smoke candidate because 4× can turn the current ~1K result into actual 4K |
| SeedVR2 Image Upscale | `image_url`, `upscale_factor`, default 3× | Faster restoration/upscale model | Reserve candidate; the documented default 3× does not itself guarantee 4K |
| Clarity Upscaler | Image input, factor and creative/resemblance controls | Detail-enhancing premium upscale | Not primary because creative controls increase the risk of facade-detail drift |

Official references:

- https://gen-api.ru/model/drct-super-resolution/api
- https://gen-api.ru/model/seedvr/api
- https://gen-api.ru/model/clarity-upscaler/api
- https://gen-api.ru/pricing

## Product guardrails

- The UI must not display “4K ready” from provider status alone.
- The server decodes the result and checks its actual dimensions, aspect ratio and a low-resolution structural comparison.
- A failed check hides the file and refunds the single `upscale_4k` credit idempotently.
- Source and result remain in private S3-compatible storage and are returned only through owner-checked temporary URLs.
- Published speed, price and quality are provider statements until the approved paid smoke is recorded here.

## Live smoke status

Not run. A new explicit GenAPI spending limit is required.
