import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { Readable } from "node:stream";
import { Router, type IRouter } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  mediaUploadsTable,
  postsTable,
  profilesTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import { canViewProfile } from "./social";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

router.post(
  "/storage/uploads/request-url",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Sign-in required" });
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(parsed.data.contentType)) {
      res.status(400).json({ error: "Only JPEG, PNG, WebP, or GIF images are supported" });
      return;
    }
    const [profile] = await db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(eq(profilesTable.id, userId))
      .limit(1);
    if (!profile) {
      res.status(409).json({ error: "Create your profile before uploading media" });
      return;
    }
    try {
      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      await db.insert(mediaUploadsTable).values({
        ownerId: userId,
        objectPath,
        fileName: parsed.data.name,
        size: parsed.data.size,
        contentType: parsed.data.contentType,
      });
      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Could not prepare media upload");
      res.status(500).json({ error: "Could not prepare media upload" });
    }
  },
);

router.get(
  "/storage/public-objects/*filePath",
  async (req, res): Promise<void> => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      const file = await objectStorage.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      const response = await objectStorage.downloadObject(file);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, "Could not serve public media");
      res.status(500).json({ error: "Could not serve public media" });
    }
  },
);

router.get(
  "/storage/objects/*path",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Sign-in required" });
      return;
    }
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    try {
      const file = await objectStorage.getObjectEntityFile(objectPath);
      const [post] = await db
        .select({ authorId: postsTable.authorId })
        .from(postsTable)
        .where(eq(postsTable.mediaPath, objectPath))
        .limit(1);
      if (post) {
        if (!(await canViewProfile(post.authorId, userId))) {
          res.status(404).end();
          return;
        }
      } else {
        const [profile] = await db
          .select()
          .from(profilesTable)
          .where(eq(profilesTable.avatarPath, objectPath))
          .limit(1);
        if (!profile || !(await canViewProfile(profile.id, userId))) {
          res.status(404).end();
          return;
        }
      }
      const response = await objectStorage.downloadObject(file, 0);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Media not found" });
        return;
      }
      req.log.error({ err: error }, "Could not serve private media");
      res.status(500).json({ error: "Could not serve private media" });
    }
  },
);

export default router;
