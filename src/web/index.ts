import pgSession from "connect-pg-simple";
import express, { ErrorRequestHandler, Express } from "express";
import session from "express-session";
import helmet from "helmet";
import { resolve } from "path";
import { TxgateError } from "../services/types";
import { adminCookie, createAdmin, sessionName } from "./admin";
import { createApi } from "./api";
import { createCheckout } from "./checkout";
import { badgeClass, formatAmount, formatTime } from "./format";
import { stringifyBigInts } from "./http";
import { WebServices } from "./types";

export { WebServices } from "./types";

interface Options {
  services: WebServices;
  databaseUrl: string;
  apiKey: string;
  adminPassword: string;
  sessionSecret: string;
  secureCookies: boolean;
}

function statusCode(error: Error & { status?: number }): number {
  if (error instanceof TxgateError) return error.statusCode;
  if (typeof error.status === "number" && error.status >= 400 && error.status < 500) return error.status;
  return 500;
}

const handleError: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = statusCode(error);
  if (status >= 500) console.error(error);
  const message = error instanceof TxgateError && status < 500 ? error.message : {
    400: "Invalid request", 413: "Request body too large", 415: "Unsupported content type"
  }[status as 400 | 413 | 415] || "Request failed";
  res.set("Cache-Control", "no-store").status(status);
  if (req.path === "/v1" || req.path.startsWith("/v1/")) {
    res.json({ error: message });
    return;
  }
  res.render("error", { title: `HTTP ${status}`, status, message });
};

export function createApp(options: Options): Express {
  const { services, databaseUrl, apiKey, adminPassword, sessionSecret, secureCookies } = options;
  const app = express();
  const store = new (pgSession(session))({ conString: databaseUrl });
  app.disable("x-powered-by");
  app.set("json replacer", stringifyBigInts);
  app.set("view engine", "ejs");
  app.set("views", resolve(process.cwd(), "src/views"));
  if (secureCookies) app.set("trust proxy", 1);

  app.locals.authenticated = false;
  app.locals.badgeClass = badgeClass;
  app.locals.formatAmount = formatAmount;
  app.locals.formatTime = formatTime;
  app.locals.prettyJson = (value: unknown) => JSON.stringify(value, stringifyBigInts, 2);
  app.locals.closeSessionStore = async () => {
    await store.close();
  };

  app.use(helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: secureCookies ? [] : null } },
    hsts: secureCookies
  }));
  app.get("/assets/bootstrap.min.css", (_req, res) => {
    res.sendFile(require.resolve("bootstrap/dist/css/bootstrap.min.css"), { maxAge: "1d" });
  });
  app.use("/assets", express.static(resolve(process.cwd(), "public")));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/", (_req, res) => res.redirect("/admin"));
  app.use(createCheckout(services));
  app.use("/v1", createApi(services, apiKey));
  app.use("/admin", session({
    name: sessionName, store, secret: sessionSecret, resave: false, saveUninitialized: false,
    cookie: adminCookie(secureCookies)
  }), createAdmin(services, adminPassword, secureCookies));

  app.use((_req, _res, next) => next(new TxgateError(404, "Page not found")));
  app.use(handleError);
  return app;
}
