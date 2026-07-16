-- Borrar una lista fallaba con 500 (violación de FK): `records.list_id`
-- y `public_lists.list_id` eran los ÚNICOS FKs hacia lists sin ON DELETE
-- CASCADE (todo lo demás — fields/views/automations/comments/activity/
-- recurrences/mentions/portal_links — ya cascadeaba, y lo que cuelga de
-- records también). Se recrean con cascade.
ALTER TABLE "records" DROP CONSTRAINT IF EXISTS "records_list_id_lists_id_fk";--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_lists" DROP CONSTRAINT IF EXISTS "public_lists_list_fk";--> statement-breakpoint
ALTER TABLE "public_lists" ADD CONSTRAINT "public_lists_list_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;
