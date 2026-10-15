import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign-in required" });
    return;
  }
  next();
};
