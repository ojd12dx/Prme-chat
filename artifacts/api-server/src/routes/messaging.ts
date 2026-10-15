import { getAuth } from "@clerk/express";
import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetConversationsResponse,
  ListMessagesParams,
  ListMessagesResponse,
  SendMessageBody,
  SendMessageParams,
  SendMessageResponse,
  StartConversationBody,
  StartConversationResponse,
} from "@workspace/api-zod";
import {
  conversationsTable,
  messagesTable,
  notificationsTable,
  profilesTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { publishUserEvent, subscribeUser } from "../lib/realtime";
import { requireAuth } from "../middlewares/requireAuth";
import { canViewProfile } from "./social";

const router: IRouter = Router();
router.use(requireAuth);

function getUserId(req: Parameters<typeof getAuth>[0]): string {
  const userId = getAuth(req).userId;
  if (!userId) throw new Error("Authenticated route is missing a user id");
  return userId;
}

async function serializeMessage(
  message: typeof messagesTable.$inferSelect,
  viewerId: string,
) {
  const [sender] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.id, message.senderId))
    .limit(1);
  if (!sender) throw new Error("Message sender profile is missing");
  return {
    id: message.id,
    conversationId: message.conversationId,
    sender: {
      id: sender.id,
      username: sender.username,
      displayName: sender.displayName,
      avatarPath: (await canViewProfile(sender.id, viewerId)) ? sender.avatarPath : null,
    },
    text: message.text,
    createdAt: message.createdAt,
    readAt: message.readAt,
  };
}

async function getConversationForUser(conversationId: number, userId: string) {
  const [conversation] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.id, conversationId),
        or(
          eq(conversationsTable.memberA, userId),
          eq(conversationsTable.memberB, userId),
        ),
      ),
    )
    .limit(1);
  return conversation;
}

router.get("/conversations", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const rows = await db
    .select()
    .from(conversationsTable)
    .where(
      or(
        eq(conversationsTable.memberA, userId),
        eq(conversationsTable.memberB, userId),
      ),
    )
    .orderBy(desc(conversationsTable.updatedAt));
  const conversations = await Promise.all(
    rows.map(async (conversation) => {
      const otherId =
        conversation.memberA === userId
          ? conversation.memberB
          : conversation.memberA;
      const [[other], [lastMessage], [unreadRow]] = await Promise.all([
        db
          .select()
          .from(profilesTable)
          .where(eq(profilesTable.id, otherId))
          .limit(1),
        db
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.conversationId, conversation.id))
          .orderBy(desc(messagesTable.createdAt), desc(messagesTable.id))
          .limit(1),
        db
          .select({ value: count() })
          .from(messagesTable)
          .where(
            and(
              eq(messagesTable.conversationId, conversation.id),
              eq(messagesTable.senderId, otherId),
              isNull(messagesTable.readAt),
            ),
          ),
      ]);
      if (!other) return null;
      return {
        id: conversation.id,
        otherUser: {
          id: other.id,
          username: other.username,
          displayName: other.displayName,
          avatarPath: (await canViewProfile(other.id, userId))
            ? other.avatarPath
            : null,
        },
        lastMessage: lastMessage?.text ?? null,
        unreadCount: Number(unreadRow?.value ?? 0),
        updatedAt: conversation.updatedAt,
      };
    }),
  );
  res.json(GetConversationsResponse.parse(conversations.filter(Boolean)));
});

router.post("/conversations", async (req, res): Promise<void> => {
  const parsed = StartConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getUserId(req);
  const [sender] = await db
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(eq(profilesTable.id, userId))
    .limit(1);
  if (!sender) {
    res.status(409).json({ error: "Create your profile before messaging" });
    return;
  }
  const [recipient] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.username, parsed.data.username.toLowerCase()))
    .limit(1);
  if (!recipient || recipient.id === userId || !(await canViewProfile(recipient.id, userId))) {
    res.status(404).json({ error: "Profile not found or not reachable" });
    return;
  }
  const [memberA, memberB] = [userId, recipient.id].sort();
  let [conversation] = await db
    .insert(conversationsTable)
    .values({ memberA, memberB })
    .onConflictDoNothing()
    .returning();
  if (!conversation) {
    [conversation] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.memberA, memberA),
          eq(conversationsTable.memberB, memberB),
        ),
      )
      .limit(1);
  }
  if (!conversation) {
    res.status(500).json({ error: "Could not open conversation" });
    return;
  }
  const response = {
    id: conversation.id,
    otherUser: {
      id: recipient.id,
      username: recipient.username,
      displayName: recipient.displayName,
      avatarPath: recipient.avatarPath,
    },
    lastMessage: null,
    unreadCount: 0,
    updatedAt: conversation.updatedAt,
  };
  res.json(StartConversationResponse.parse(response));
});

router.get("/conversations/events", (req, res): void => {
  const userId = getUserId(req);
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("event: ready\ndata: {}\n\n");
  const unsubscribe = subscribeUser(userId, (event) => {
    res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25000);
  heartbeat.unref();
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get(
  "/conversations/:conversationId/messages",
  async (req, res): Promise<void> => {
    const params = ListMessagesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const userId = getUserId(req);
    const conversation = await getConversationForUser(
      params.data.conversationId,
      userId,
    );
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const otherId =
      conversation.memberA === userId
        ? conversation.memberB
        : conversation.memberA;
    await db
      .update(messagesTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messagesTable.conversationId, conversation.id),
          eq(messagesTable.senderId, otherId),
          isNull(messagesTable.readAt),
        ),
      );
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversation.id))
      .orderBy(messagesTable.createdAt, messagesTable.id)
      .limit(100);
    res.json(
      ListMessagesResponse.parse(
        await Promise.all(messages.map((message) => serializeMessage(message, userId))),
      ),
    );
  },
);

router.post(
  "/conversations/:conversationId/messages",
  async (req, res): Promise<void> => {
    const params = SendMessageParams.safeParse(req.params);
    const parsed = SendMessageBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid message" });
      return;
    }
    const userId = getUserId(req);
    const conversation = await getConversationForUser(
      params.data.conversationId,
      userId,
    );
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const text = parsed.data.text.trim();
    if (!text) {
      res.status(400).json({ error: "Message cannot be empty" });
      return;
    }
    const [message] = await db
      .insert(messagesTable)
      .values({
        conversationId: conversation.id,
        senderId: userId,
        text,
      })
      .returning();
    const [updatedConversation] = await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversation.id))
      .returning();
    if (!message || !updatedConversation) {
      res.status(500).json({ error: "Could not send message" });
      return;
    }
    const otherId =
      conversation.memberA === userId
        ? conversation.memberB
        : conversation.memberA;
    const serialized = SendMessageResponse.parse(
      await serializeMessage(message, userId),
    );
    const [notification] = await db
      .insert(notificationsTable)
      .values({
        recipientId: otherId,
        actorId: userId,
        type: "message",
        targetId: conversation.id,
        text: "sent you a message",
      })
      .returning();
    await Promise.all([
      publishUserEvent(userId, "message", serialized),
      publishUserEvent(otherId, "message", serialized),
      notification
        ? publishUserEvent(otherId, "notification", {
            id: notification.id,
            type: notification.type,
            targetId: notification.targetId,
            text: notification.text,
            createdAt: notification.createdAt,
          })
        : Promise.resolve(),
    ]);
    res.status(201).json(serialized);
  },
);

export default router;
