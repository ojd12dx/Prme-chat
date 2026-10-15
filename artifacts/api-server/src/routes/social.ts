import { getAuth } from "@clerk/express";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateCommentBody,
  CreateCommentParams,
  CreateCommentResponse,
  CreatePostBody,
  CreatePostResponse,
  DeletePostParams,
  GetFeedQueryParams,
  GetFeedResponse,
  GetFollowRequestsResponse,
  GetMyProfileResponse,
  GetNotificationsResponse,
  GetPostCommentsParams,
  GetPostCommentsResponse,
  GetProfileParams,
  GetProfilePostsParams,
  GetProfilePostsResponse,
  GetProfileResponse,
  MarkAllNotificationsReadResponse,
  ResolveFollowRequestBody,
  ResolveFollowRequestParams,
  ResolveFollowRequestResponse,
  SaveMyProfileBody,
  SaveMyProfileResponse,
  SearchSocialQueryParams,
  SearchSocialResponse,
  ToggleFollowParams,
  ToggleFollowResponse,
  ToggleLikeParams,
  ToggleLikeResponse,
  UpdatePostBody,
  UpdatePostParams,
  UpdatePostResponse,
} from "@workspace/api-zod";
import {
  commentsTable,
  followsTable,
  mediaUploadsTable,
  notificationsTable,
  postLikesTable,
  postsTable,
  profilesTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { publishUserEvent } from "../lib/realtime";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
router.use(requireAuth);

function currentUserId(req: Parameters<typeof getAuth>[0]): string {
  const userId = getAuth(req).userId;
  if (!userId) throw new Error("Authenticated route is missing a user id");
  return userId;
}

async function acceptedFollowingIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ followedId: followsTable.followedId })
    .from(followsTable)
    .where(
      and(eq(followsTable.followerId, userId), eq(followsTable.status, "accepted")),
    );
  return rows.map((row) => row.followedId);
}

export async function canViewProfile(profileId: string, viewerId: string): Promise<boolean> {
  if (profileId === viewerId) return true;
  const [profile] = await db
    .select({ isPrivate: profilesTable.isPrivate })
    .from(profilesTable)
    .where(eq(profilesTable.id, profileId))
    .limit(1);
  if (!profile) return false;
  if (!profile.isPrivate) return true;
  const [follow] = await db
    .select({ status: followsTable.status })
    .from(followsTable)
    .where(
      and(
        eq(followsTable.followerId, viewerId),
        eq(followsTable.followedId, profileId),
      ),
    )
    .limit(1);
  return follow?.status === "accepted";
}

async function canViewPost(postId: number, viewerId: string) {
  const [post] = await db
    .select({ id: postsTable.id, authorId: postsTable.authorId })
    .from(postsTable)
    .where(eq(postsTable.id, postId))
    .limit(1);
  if (!post || !(await canViewProfile(post.authorId, viewerId))) return null;
  return post;
}

async function serializeProfile(profile: typeof profilesTable.$inferSelect, viewerId: string) {
  const [followerRow, followingRow, postRow, follow] = await Promise.all([
    db
      .select({ value: count() })
      .from(followsTable)
      .where(and(eq(followsTable.followedId, profile.id), eq(followsTable.status, "accepted"))),
    db
      .select({ value: count() })
      .from(followsTable)
      .where(and(eq(followsTable.followerId, profile.id), eq(followsTable.status, "accepted"))),
    db.select({ value: count() }).from(postsTable).where(eq(postsTable.authorId, profile.id)),
    profile.id === viewerId
      ? Promise.resolve([{ status: "accepted" as const }])
      : db
          .select({ status: followsTable.status })
          .from(followsTable)
          .where(
            and(
              eq(followsTable.followerId, viewerId),
              eq(followsTable.followedId, profile.id),
            ),
          )
          .limit(1),
  ]);
  const allowed = await canViewProfile(profile.id, viewerId);
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarPath: allowed ? profile.avatarPath : null,
    isPrivate: profile.isPrivate,
    followerCount: Number(followerRow[0]?.value ?? 0),
    followingCount: Number(followingRow[0]?.value ?? 0),
    postCount: allowed ? Number(postRow[0]?.value ?? 0) : 0,
    followedByMe: follow[0]?.status === "accepted",
    followPending: follow[0]?.status === "pending",
    createdAt: profile.createdAt,
  };
}

async function serializePost(post: typeof postsTable.$inferSelect, viewerId: string) {
  const [[author], likes, comments, liked] = await Promise.all([
    db.select().from(profilesTable).where(eq(profilesTable.id, post.authorId)).limit(1),
    db.select({ value: count() }).from(postLikesTable).where(eq(postLikesTable.postId, post.id)),
    db.select({ value: count() }).from(commentsTable).where(eq(commentsTable.postId, post.id)),
    db
      .select({ userId: postLikesTable.userId })
      .from(postLikesTable)
      .where(and(eq(postLikesTable.postId, post.id), eq(postLikesTable.userId, viewerId)))
      .limit(1),
  ]);
  if (!author) throw new Error("Post author profile is missing");
  return {
    id: post.id,
    author: {
      id: author.id,
      username: author.username,
      displayName: author.displayName,
      avatarPath: await canViewProfile(author.id, viewerId) ? author.avatarPath : null,
    },
    caption: post.caption,
    mediaPath: post.mediaPath,
    mediaType: post.mediaType,
    likeCount: Number(likes[0]?.value ?? 0),
    commentCount: Number(comments[0]?.value ?? 0),
    likedByMe: liked.length > 0,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

async function createNotification(
  recipientId: string,
  actorId: string,
  type: "follow" | "like" | "comment" | "message",
  targetId: number | null,
  text: string,
): Promise<void> {
  if (recipientId === actorId) return;
  const [notification] = await db
    .insert(notificationsTable)
    .values({ recipientId, actorId, type, targetId, text })
    .returning();
  if (notification) {
    try {
      await publishUserEvent(recipientId, "notification", {
        id: notification.id,
        type: notification.type,
        targetId: notification.targetId,
        text: notification.text,
        createdAt: notification.createdAt,
      });
    } catch (error) {
      logger.warn({ err: error }, "Notification was saved but its live event could not be delivered");
    }
  }
}

async function validateOwnedUpload(objectPath: string, userId: string) {
  if (!objectPath.startsWith("/objects/")) return null;
  const [upload] = await db
    .select()
    .from(mediaUploadsTable)
    .where(
      and(
        eq(mediaUploadsTable.objectPath, objectPath),
        eq(mediaUploadsTable.ownerId, userId),
        eq(mediaUploadsTable.status, "pending"),
      ),
    )
    .limit(1);
  if (!upload) return null;
  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size ?? 0);
    const actualType = String(metadata.contentType ?? "");
    if (
      actualSize < 1 ||
      actualSize > 10 * 1024 * 1024 ||
      actualSize > upload.size ||
      actualType !== upload.contentType ||
      !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(actualType)
    ) {
      return null;
    }
    return { upload, file };
  } catch {
    return null;
  }
}

router.get("/profiles/me", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.id, userId))
    .limit(1);
  if (!profile) {
    res.status(404).json({ error: "Profile setup is required" });
    return;
  }
  res.json(GetMyProfileResponse.parse(await serializeProfile(profile, userId)));
});

router.put("/profiles/me", async (req, res): Promise<void> => {
  const parsed = SaveMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = currentUserId(req);
  const username = parsed.data.username.toLowerCase();
  let avatarPath: string | null = parsed.data.avatarPath ?? null;
  if (avatarPath) {
    const [existing] = await db
      .select({ avatarPath: profilesTable.avatarPath })
      .from(profilesTable)
      .where(eq(profilesTable.id, userId))
      .limit(1);
    if (avatarPath !== existing?.avatarPath) {
      const ownedUpload = await validateOwnedUpload(avatarPath, userId);
      if (!ownedUpload) {
        res.status(400).json({ error: "Avatar upload is invalid or expired" });
        return;
      }
      await db
        .update(mediaUploadsTable)
        .set({ status: "attached" })
        .where(eq(mediaUploadsTable.id, ownedUpload.upload.id));
    }
  }
  try {
    const [profile] = await db
      .insert(profilesTable)
      .values({
        id: userId,
        username,
        displayName: parsed.data.displayName.trim(),
        bio: parsed.data.bio.trim(),
        avatarPath,
        isPrivate: parsed.data.isPrivate,
      })
      .onConflictDoUpdate({
        target: profilesTable.id,
        set: {
          username,
          displayName: parsed.data.displayName.trim(),
          bio: parsed.data.bio.trim(),
          avatarPath,
          isPrivate: parsed.data.isPrivate,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!profile) {
      res.status(500).json({ error: "Could not save profile" });
      return;
    }
    res.json(SaveMyProfileResponse.parse(await serializeProfile(profile, userId)));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "That username is already taken" });
      return;
    }
    throw error;
  }
});

router.get("/profiles/me/follow-requests", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const requests = await db
    .select({
      id: profilesTable.id,
      username: profilesTable.username,
      displayName: profilesTable.displayName,
      avatarPath: profilesTable.avatarPath,
      createdAt: followsTable.createdAt,
    })
    .from(followsTable)
    .innerJoin(profilesTable, eq(profilesTable.id, followsTable.followerId))
    .where(and(eq(followsTable.followedId, userId), eq(followsTable.status, "pending")))
    .orderBy(desc(followsTable.createdAt));
  res.json(GetFollowRequestsResponse.parse(requests));
});

router.put("/profiles/me/follow-requests/:username", async (req, res): Promise<void> => {
  const params = ResolveFollowRequestParams.safeParse(req.params);
  const body = ResolveFollowRequestBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid follow request resolution" });
    return;
  }
  const userId = currentUserId(req);
  const [requester] = await db
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(eq(profilesTable.username, params.data.username.toLowerCase()))
    .limit(1);
  if (!requester) {
    res.status(404).json({ error: "Pending follow request not found" });
    return;
  }
  const [pending] = await db
    .select()
    .from(followsTable)
    .where(
      and(
        eq(followsTable.followerId, requester.id),
        eq(followsTable.followedId, userId),
        eq(followsTable.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) {
    res.status(404).json({ error: "Pending follow request not found" });
    return;
  }
  if (body.data.accepted) {
    await db
      .update(followsTable)
      .set({ status: "accepted" })
      .where(
        and(
          eq(followsTable.followerId, requester.id),
          eq(followsTable.followedId, userId),
        ),
      );
    await createNotification(requester.id, userId, "follow", null, "accepted your follow request");
  } else {
    await db
      .delete(followsTable)
      .where(
        and(
          eq(followsTable.followerId, requester.id),
          eq(followsTable.followedId, userId),
        ),
      );
  }
  res.json(
    ResolveFollowRequestResponse.parse({
      resolved: true,
      accepted: body.data.accepted,
    }),
  );
});

router.get("/profiles/:username", async (req, res): Promise<void> => {
  const params = GetProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.username, params.data.username.toLowerCase()))
    .limit(1);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(GetProfileResponse.parse(await serializeProfile(profile, currentUserId(req))));
});

router.put("/profiles/:username/follow", async (req, res): Promise<void> => {
  const params = ToggleFollowParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = currentUserId(req);
  const [target] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.username, params.data.username.toLowerCase()))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  if (target.id === userId) {
    res.status(400).json({ error: "You cannot follow your own profile" });
    return;
  }
  const [existing] = await db
    .select()
    .from(followsTable)
    .where(and(eq(followsTable.followerId, userId), eq(followsTable.followedId, target.id)))
    .limit(1);
  if (existing) {
    await db
      .delete(followsTable)
      .where(and(eq(followsTable.followerId, userId), eq(followsTable.followedId, target.id)));
  } else {
    const status = target.isPrivate ? "pending" : "accepted";
    const inserted = await db
      .insert(followsTable)
      .values({ followerId: userId, followedId: target.id, status })
      .onConflictDoNothing()
      .returning({ followerId: followsTable.followerId });
    if (inserted.length > 0) await createNotification(
      target.id,
      userId,
      "follow",
      null,
      status === "pending" ? "requested to follow you" : "started following you",
    );
  }
  const [followerRow] = await db
    .select({ value: count() })
    .from(followsTable)
    .where(and(eq(followsTable.followedId, target.id), eq(followsTable.status, "accepted")));
  const [state] = await db
    .select({ status: followsTable.status })
    .from(followsTable)
    .where(and(eq(followsTable.followerId, userId), eq(followsTable.followedId, target.id)))
    .limit(1);
  res.json(
    ToggleFollowResponse.parse({
      following: state?.status === "accepted",
      pending: state?.status === "pending",
      followerCount: Number(followerRow?.value ?? 0),
    }),
  );
});

router.get("/profiles/:username/posts", async (req, res): Promise<void> => {
  const params = GetProfilePostsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = currentUserId(req);
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.username, params.data.username.toLowerCase()))
    .limit(1);
  if (!profile || !(await canViewProfile(profile.id, userId))) {
    res.status(404).json({ error: "Profile not found or posts are private" });
    return;
  }
  const posts = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.authorId, profile.id))
    .orderBy(desc(postsTable.createdAt), desc(postsTable.id))
    .limit(60);
  const response = await Promise.all(posts.map((post) => serializePost(post, userId)));
  res.json(GetProfilePostsResponse.parse(response));
});

router.get("/feed", async (req, res): Promise<void> => {
  const parsed = GetFeedQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = currentUserId(req);
  const limit = parsed.data.limit ?? 12;
  const cursor = parsed.data.cursor ?? "0";
  const offset = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    res.status(400).json({ error: "Invalid feed cursor" });
    return;
  }
  const followingIds = await acceptedFollowingIds(userId);
  const visibleAuthorIds =
    parsed.data.scope === "discover"
      ? undefined
      : [userId, ...followingIds];
  const whereClause =
    parsed.data.scope === "discover"
      ? followingIds.length > 0
        ? or(eq(profilesTable.isPrivate, false), inArray(profilesTable.id, followingIds))
        : eq(profilesTable.isPrivate, false)
      : inArray(postsTable.authorId, visibleAuthorIds!);
  const rows = await db
    .select({ post: postsTable })
    .from(postsTable)
    .innerJoin(profilesTable, eq(profilesTable.id, postsTable.authorId))
    .where(whereClause)
    .orderBy(desc(postsTable.createdAt), desc(postsTable.id))
    .limit(limit + 1)
    .offset(offset);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const posts = await Promise.all(page.map(({ post }) => serializePost(post, userId)));
  res.json(
    GetFeedResponse.parse({
      posts,
      nextCursor: hasMore ? String(offset + limit) : null,
    }),
  );
});

router.post("/posts", async (req, res): Promise<void> => {
  const parsed = CreatePostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = currentUserId(req);
  const [profile] = await db
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(eq(profilesTable.id, userId))
    .limit(1);
  if (!profile) {
    res.status(409).json({ error: "Create your profile before publishing" });
    return;
  }
  const caption = parsed.data.caption.trim();
  const mediaPath = parsed.data.mediaPath;
  if (!caption && !mediaPath) {
    res.status(400).json({ error: "Add a caption or an image" });
    return;
  }
  let uploadId: number | undefined;
  if (mediaPath) {
    const ownedUpload = await validateOwnedUpload(mediaPath, userId);
    if (!ownedUpload) {
      res.status(400).json({ error: "Image upload is invalid, incomplete, or not yours" });
      return;
    }
    uploadId = ownedUpload.upload.id;
  }
  const [post] = await db
    .insert(postsTable)
    .values({ authorId: userId, caption, mediaPath, mediaType: mediaPath ? "image" : null })
    .returning();
  if (uploadId) {
    await db
      .update(mediaUploadsTable)
      .set({ status: "attached" })
      .where(eq(mediaUploadsTable.id, uploadId));
  }
  if (!post) {
    res.status(500).json({ error: "Could not publish post" });
    return;
  }
  res.status(201).json(CreatePostResponse.parse(await serializePost(post, userId)));
});

router.patch("/posts/:postId", async (req, res): Promise<void> => {
  const params = UpdatePostParams.safeParse(req.params);
  const parsed = UpdatePostBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid post update" });
    return;
  }
  const userId = currentUserId(req);
  const [post] = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.id, params.data.postId))
    .limit(1);
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (post.authorId !== userId) {
    res.status(403).json({ error: "Only the post owner can edit it" });
    return;
  }
  const [updated] = await db
    .update(postsTable)
    .set({ caption: parsed.data.caption.trim(), updatedAt: new Date() })
    .where(eq(postsTable.id, post.id))
    .returning();
  res.json(UpdatePostResponse.parse(await serializePost(updated!, userId)));
});

router.delete("/posts/:postId", async (req, res): Promise<void> => {
  const params = DeletePostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = currentUserId(req);
  const [post] = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.id, params.data.postId))
    .limit(1);
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (post.authorId !== userId) {
    res.status(403).json({ error: "Only the post owner can delete it" });
    return;
  }
  await db.delete(postsTable).where(eq(postsTable.id, post.id));
  if (post.mediaPath) {
    try {
      const file = await objectStorage.getObjectEntityFile(post.mediaPath);
      await file.delete();
      await db.delete(mediaUploadsTable).where(eq(mediaUploadsTable.objectPath, post.mediaPath));
    } catch (error) {
      req.log.warn({ err: error, postId: post.id }, "Post media cleanup failed");
    }
  }
  res.status(204).end();
});

router.put("/posts/:postId/like", async (req, res): Promise<void> => {
  const params = ToggleLikeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = currentUserId(req);
  const post = await canViewPost(params.data.postId, userId);
  if (!post) {
    res.status(404).json({ error: "Post not found or not visible" });
    return;
  }
  const [existing] = await db
    .select()
    .from(postLikesTable)
    .where(and(eq(postLikesTable.postId, post.id), eq(postLikesTable.userId, userId)))
    .limit(1);
  if (existing) {
    await db
      .delete(postLikesTable)
      .where(and(eq(postLikesTable.postId, post.id), eq(postLikesTable.userId, userId)));
  } else {
    const inserted = await db
      .insert(postLikesTable)
      .values({ postId: post.id, userId })
      .onConflictDoNothing()
      .returning({ postId: postLikesTable.postId });
    if (inserted.length > 0) {
      await createNotification(post.authorId, userId, "like", post.id, "liked your post");
    }
  }
  const [likeRow] = await db
    .select({ value: count() })
    .from(postLikesTable)
    .where(eq(postLikesTable.postId, post.id));
  res.json(
    ToggleLikeResponse.parse({
      liked: !existing,
      likeCount: Number(likeRow?.value ?? 0),
    }),
  );
});

router.get("/posts/:postId/comments", async (req, res): Promise<void> => {
  const params = GetPostCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = currentUserId(req);
  if (!(await canViewPost(params.data.postId, userId))) {
    res.status(404).json({ error: "Post not found or not visible" });
    return;
  }
  const comments = await db
    .select({ comment: commentsTable, author: profilesTable })
    .from(commentsTable)
    .innerJoin(profilesTable, eq(profilesTable.id, commentsTable.authorId))
    .where(eq(commentsTable.postId, params.data.postId))
    .orderBy(commentsTable.createdAt, commentsTable.id)
    .limit(100);
  const output = comments.map(({ comment, author }) => ({
    id: comment.id,
    postId: comment.postId,
    parentCommentId: comment.parentCommentId,
    author: {
      id: author.id,
      username: author.username,
      displayName: author.displayName,
      avatarPath: author.avatarPath,
    },
    text: comment.text,
    createdAt: comment.createdAt,
  }));
  res.json(GetPostCommentsResponse.parse(output));
});

router.post("/posts/:postId/comments", async (req, res): Promise<void> => {
  const params = CreateCommentParams.safeParse(req.params);
  const parsed = CreateCommentBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid comment" });
    return;
  }
  const userId = currentUserId(req);
  const post = await canViewPost(params.data.postId, userId);
  if (!post) {
    res.status(404).json({ error: "Post not found or not visible" });
    return;
  }
  const text = parsed.data.text.trim();
  if (!text) {
    res.status(400).json({ error: "Comment cannot be empty" });
    return;
  }
  if (parsed.data.parentCommentId !== null) {
    const [parent] = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(
        and(
          eq(commentsTable.id, parsed.data.parentCommentId),
          eq(commentsTable.postId, post.id),
        ),
      )
      .limit(1);
    if (!parent) {
      res.status(404).json({ error: "Reply target not found" });
      return;
    }
  }
  const [comment] = await db
    .insert(commentsTable)
    .values({
      postId: post.id,
      authorId: userId,
      parentCommentId: parsed.data.parentCommentId,
      text,
    })
    .returning();
  const [author] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.id, userId))
    .limit(1);
  if (!comment || !author) {
    res.status(500).json({ error: "Could not save comment" });
    return;
  }
  await createNotification(post.authorId, userId, "comment", post.id, "commented on your post");
  res.status(201).json(
    CreateCommentResponse.parse({
      id: comment.id,
      postId: comment.postId,
      parentCommentId: comment.parentCommentId,
      author: {
        id: author.id,
        username: author.username,
        displayName: author.displayName,
        avatarPath: author.avatarPath,
      },
      text: comment.text,
      createdAt: comment.createdAt,
    }),
  );
});

router.get("/search", async (req, res): Promise<void> => {
  const parsed = SearchSocialQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = currentUserId(req);
  const query = parsed.data.q.trim().replace(/[\\%_]/g, "\\$&");
  const pattern = `%${query}%`;
  const followingIds = await acceptedFollowingIds(userId);
  const visibilityFilter =
    followingIds.length > 0
      ? or(eq(profilesTable.isPrivate, false), eq(profilesTable.id, userId), inArray(profilesTable.id, followingIds))
      : or(eq(profilesTable.isPrivate, false), eq(profilesTable.id, userId));
  const profiles = await db
    .select()
    .from(profilesTable)
    .where(
      and(
        visibilityFilter,
        or(ilike(profilesTable.username, pattern), ilike(profilesTable.displayName, pattern)),
      ),
    )
    .limit(20);
  const matchingPosts = await db
    .select({ post: postsTable })
    .from(postsTable)
    .innerJoin(profilesTable, eq(profilesTable.id, postsTable.authorId))
    .where(and(visibilityFilter, ilike(postsTable.caption, pattern)))
    .orderBy(desc(postsTable.createdAt))
    .limit(20);
  res.json(
    SearchSocialResponse.parse({
      profiles: profiles.map(({ id, username, displayName, avatarPath }) => ({
        id,
        username,
        displayName,
        avatarPath,
      })),
      posts: await Promise.all(matchingPosts.map(({ post }) => serializePost(post, userId))),
    }),
  );
});

router.get("/notifications", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const rows = await db
    .select({ notification: notificationsTable, actor: profilesTable })
    .from(notificationsTable)
    .innerJoin(profilesTable, eq(profilesTable.id, notificationsTable.actorId))
    .where(eq(notificationsTable.recipientId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(100);
  res.json(
    GetNotificationsResponse.parse(
      rows.map(({ notification, actor }) => ({
        id: notification.id,
        type: notification.type,
        actor: {
          id: actor.id,
          username: actor.username,
          displayName: actor.displayName,
          avatarPath: actor.avatarPath,
        },
        targetId: notification.targetId,
        text: notification.text,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
      })),
    ),
  );
});

router.put("/notifications/read-all", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const updated = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(and(eq(notificationsTable.recipientId, userId), isNull(notificationsTable.readAt)))
    .returning({ id: notificationsTable.id });
  res.json(MarkAllNotificationsReadResponse.parse({ updated: updated.length }));
});

export default router;
