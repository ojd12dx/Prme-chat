import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const profilesTable = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarPath: text("avatar_path"),
    isPrivate: boolean("is_private").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("profiles_username_unique").on(table.username)],
);

export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
