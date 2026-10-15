import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    recipientId: text("recipient_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    targetId: integer("target_id"),
    text: text("text").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_recipient_created_idx").on(table.recipientId, table.createdAt)],
);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
