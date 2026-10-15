import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { postsTable } from "./posts";
import { profilesTable } from "./profiles";

export const commentsTable = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
    parentCommentId: integer("parent_comment_id"),
    authorId: text("author_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("comments_post_created_idx").on(table.postId, table.createdAt)],
);

export const insertCommentSchema = createInsertSchema(commentsTable).omit({ id: true, createdAt: true });
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof commentsTable.$inferSelect;
