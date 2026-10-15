import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

export const postsTable = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    authorId: text("author_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    caption: text("caption").notNull().default(""),
    mediaPath: text("media_path"),
    mediaType: text("media_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("posts_author_created_idx").on(table.authorId, table.createdAt)],
);

export const insertPostSchema = createInsertSchema(postsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
