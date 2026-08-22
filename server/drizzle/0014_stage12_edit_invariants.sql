ALTER TABLE "generations" DROP CONSTRAINT "generations_edit_shape_chk";--> statement-breakpoint
ALTER TABLE "generations" DROP CONSTRAINT "generations_custom_mask_chk";--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_edit_shape_chk" CHECK (
    ("generations"."kind" <> 'edit' AND "generations"."parent_generation_id" IS NULL AND "generations"."edit_scope" IS NULL
      AND "generations"."edit_prompt" IS NULL AND "generations"."edit_mask_bucket" IS NULL
      AND "generations"."edit_mask_key" IS NULL AND "generations"."edit_mask_mime_type" IS NULL)
    OR ("generations"."kind" = 'edit' AND "generations"."parent_generation_id" IS NOT NULL AND "generations"."edit_scope" IS NOT NULL
      AND length(btrim("generations"."edit_prompt")) BETWEEN 1 AND 700)
  );--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_custom_mask_chk" CHECK (
    ("generations"."edit_scope" = 'custom_mask' AND "generations"."edit_mask_bucket" IS NOT NULL AND "generations"."edit_mask_key" IS NOT NULL
      AND "generations"."edit_mask_mime_type" = 'image/png')
    OR ("generations"."edit_scope" <> 'custom_mask' AND "generations"."edit_mask_bucket" IS NULL
      AND "generations"."edit_mask_key" IS NULL AND "generations"."edit_mask_mime_type" IS NULL)
    OR "generations"."edit_scope" IS NULL
  );