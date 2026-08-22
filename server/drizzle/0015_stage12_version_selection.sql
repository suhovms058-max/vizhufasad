CREATE TABLE "project_generation_selections" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"generation_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_generation_selections" ADD CONSTRAINT "project_generation_selections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_generation_selections" ADD CONSTRAINT "project_generation_selections_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_generation_selections_generation_idx" ON "project_generation_selections" USING btree ("generation_id");