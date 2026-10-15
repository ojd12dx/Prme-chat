import { Router, type IRouter } from "express";
import healthRouter from "./health";
import socialRouter from "./social";
import messagingRouter from "./messaging";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(socialRouter);
router.use(messagingRouter);
router.use(storageRouter);

export default router;
