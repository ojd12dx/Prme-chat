import express, { type ErrorRequestHandler, type Express } from "express";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
// The app always runs behind one reverse proxy (Replit deployment edge). Without
// this, req.ip is the proxy's address, so every anonymous client shares a
// single rate-limit bucket and express-rate-limit rejects X-Forwarded-For.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000");
  }
  next();
});
const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator(req) {
    const userId = getAuth(req).userId;
    return userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? "127.0.0.1");
  },
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", apiRateLimit, router);

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status =
    typeof err?.status === "number" && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  if (status >= 500) req.log.error({ err }, "Unhandled request error");
  res.status(status).json({
    error: status >= 500 ? "Something went wrong. Please try again." : String(err?.message ?? "Bad request"),
  });
};
app.use(errorHandler);

export default app;
