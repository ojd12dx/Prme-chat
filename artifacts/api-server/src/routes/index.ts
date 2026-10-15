import { Router, type IRouter } from "express";
import healthRouter from "./health";
import socialRouter from "./social";
import messagingRouter from "./messaging";
import storageRouter from "./storage";

const router: IRouter = Router();

// Storage must be mounted before the social/messaging routers: they apply
// requireAuth to every request passing through them, which would otherwise
// block the unauthenticated public-objects route.
router.use(healthRouter);
router.use(storageRouter);
router.use(socialRouter);
router.use(messagingRouter);

export default router;
