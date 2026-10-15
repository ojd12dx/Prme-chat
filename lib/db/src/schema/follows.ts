import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

export const followsTable = pgTable(
  "follows",
  {
    followerId: text("follower_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    followedId: text("followed_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("accepted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followedId] }),
    index("follows_followed_idx").on(table.followedId, table.status),
  ],
);

export const insertFollowSchema = createInsertSchema(followsTable).omit({ createdAt: true });
export type InsertFollow = z.infer<typeof insertFollowSchema>;
export type Follow = typeof followsTable.$inferSelect;
