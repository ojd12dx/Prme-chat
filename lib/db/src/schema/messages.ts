import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { conversationsTable } from "./conversations";
import { profilesTable } from "./profiles";

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
    senderId: text("sender_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [index("messages_conversation_created_idx").on(table.conversationId, table.createdAt)],
);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({
  id: true,
  createdAt: true,
  readAt: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
