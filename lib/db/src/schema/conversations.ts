import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    memberA: text("member_a").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    memberB: text("member_b").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("conversations_members_unique").on(table.memberA, table.memberB),
    index("conversations_member_a_idx").on(table.memberA, table.updatedAt),
    index("conversations_member_b_idx").on(table.memberB, table.updatedAt),
  ],
);

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;
