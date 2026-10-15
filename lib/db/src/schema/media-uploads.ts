import { createInsertSchema } from "drizzle-zod";
import { pgTable, serial, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

export const mediaUploadsTable = pgTable(
  "media_uploads",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull(),
    fileName: text("file_name").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("media_uploads_object_path_unique").on(table.objectPath)],
);

export const insertMediaUploadSchema = createInsertSchema(mediaUploadsTable).omit({ id: true, createdAt: true });
export type InsertMediaUpload = z.infer<typeof insertMediaUploadSchema>;
export type MediaUpload = typeof mediaUploadsTable.$inferSelect;
