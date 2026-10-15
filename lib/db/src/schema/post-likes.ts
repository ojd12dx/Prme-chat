import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { postsTable } from "./posts";
import { profilesTable } from "./profiles";

export const postLikesTable = pgTable(
  "post_likes",
  {
    postId: integer("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.userId] }),
    index("post_likes_user_idx").on(table.userId, table.createdAt),
  ],
);

export const insertPostLikeSchema = createInsertSchema(postLikesTable).omit({ createdAt: true });
export type InsertPostLike = z.infer<typeof insertPostLikeSchema>;
export type PostLike = typeof postLikesTable.$inferSelect;
