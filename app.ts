import config from "config";
import RedisStore from "connect-redis";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { RequestHandler } from "express";
import bearerToken from "express-bearer-token";
import session from "express-session";
import helmet from "helmet";
import createError from "http-errors";
import morgan from "morgan";
import { createClient } from "redis";
import swaggerJSDoc from "swagger-jsdoc";
import { csrf } from "lusca";
import { serve, setup } from "swagger-ui-express";

// Route Files
import indexRouter from "./src/routes/index.js";
import leaderboardRouter from "./src/routes/leaderboard.js";
import legacyAPICalls from "./src/routes/legacy/api.js";
import mapListRouter from "./src/routes/maps.js";
import mapstatsRouter from "./src/routes/mapstats.js";
import matchesRouter from "./src/routes/matches/matches.js";
import matchServerRouter from "./src/routes/matches/matchserver.js";
import playerstatsRouter from "./src/routes/playerstats/playerstats.js";
import playerstatsextraRouter from "./src/routes/playerstats/extrastats.js";
import queueRouter from "./src/routes/queue.js";
import seasonsRouter from "./src/routes/seasons.js";
import serversRouter from "./src/routes/servers.js";
import teamsRouter from "./src/routes/teams.js";
import usersRouter from "./src/routes/users.js";
import vetoesRouter from "./src/routes/vetoes.js";
import vetosidesRouter from "./src/routes/vetosides.js";
import passport, { createSteamStrategy } from "./src/utility/auth.js";
import {router as v2Router} from "./src/routes/v2/api.js";
import {router as v2DemoRouter} from "./src/routes/v2/demoapi.js";
import { router as v2BackupRouter } from "./src/routes/v2/backupapi.js";
import settingsRouter from "./src/routes/settings.js";
import imageRouter from "./src/routes/image/image.js";
// End Route Files

function logError(err: unknown): void {
  if (process.env.NODE_ENV !== "test") {
    console.error(err);
  }
}

function getSessionMessage(err: any, req: any, fallback: string): string {
  if (req && req.session && Array.isArray(req.session.messages) && req.session.messages.length > 0) {
    return req.session.messages[req.session.messages.length - 1];
  }
  return err && err.message ? err.message : fallback;
}

const app = express();

const morganFormat = process.env.NODE_ENV === "production" ? "combined" : "dev";
app.use(morgan(morganFormat));
app.use(express.raw({ type: "application/octet-stream", limit: "2gb" }));
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(csrf());
app.use("/demo", express.static("public/demos"));
app.use("/backups", express.static("public/backups"));
app.use("/static/img/logos", express.static("public/img/logos"));
app.use("/resource/flash/econ/tournaments/teams", express.static("public/img/logos"));
app.use("/materials/panorama/images/tournaments/teams", express.static("public/img/logos"));


// Security defaults with helmet
app.use(helmet());

let sessionMiddleware: RequestHandler;
if (config.get("server.useRedis")) {
  const redisClient = createClient({
    url: config.get("server.redisUrl"),
  });

  redisClient.connect().catch((err) => {
    console.log("Redis connection error: ", err);
  });
  redisClient.on("error", (err) => {
    console.log("Redis error: ", err);
  });

  const redisCfg = {
    client: redisClient,
  };
  sessionMiddleware = session({
    secret: config.get("server.sharedSecret"),
    name: "MatchZy",
    resave: false,
    saveUninitialized: true,
    store: new RedisStore(redisCfg),
    cookie: { maxAge: 2628000000 },
  });

  let isShuttingDown = false;
  const handleShutdown = (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    (async () => {
      try {
        await redisClient.quit();
      } catch (err) {
        console.error(`Error quitting Redis client on ${signal}:`, err);
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
} else {
  sessionMiddleware = session({
    secret: config.get("server.sharedSecret"),
    name: "MatchZy",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 2628000000 },
  });
}

app.use(sessionMiddleware);

app.use(passport.initialize() as any);
app.use(passport.session());
app.use(bearerToken());

const allowedOrigins = (config.get("server.clientHome") as string)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// enabling CORS for all requests
app.use(
  cors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
  })
);

// adding morgan to log HTTP requests

// swagger UI

const options = {
  definition: {
    openapi: "3.0.0", // Specification (optional, defaults to swagger: '2.0')
    info: {
      title: "MatchZy API", // Title (required)
      version: "2.0.2.4" // Version (required)
    }
  },
  // Path to the API docs
  apis: [
    "./dist/src/routes/**/*.js",
    "./dist/src/services/**/*.js",
    "./dist/src/routes/*.js"
  ]
};
const swaggerSpec = swaggerJSDoc(options);

app.use(
  "/api-docs",
  (_req: any, res: any, next: any) => { res.setHeader("Content-Security-Policy", ""); next(); },
  serve as any,
  setup(swaggerSpec) as any
);

// END API SETUP

// Begin Routes
app.use("/", indexRouter);
app.use("/users", usersRouter);
app.use("/teams", teamsRouter);
app.use("/servers", serversRouter);
app.use("/vetoes", vetoesRouter);
app.use("/vetosides", vetosidesRouter);
app.use("/matches", matchesRouter, matchServerRouter);
app.use("/mapstats", mapstatsRouter);
app.use("/playerstats", playerstatsRouter);
app.use("/playerstatsextra", playerstatsextraRouter);
app.use("/seasons", seasonsRouter);
app.use("/match", legacyAPICalls);
app.use("/leaderboard", leaderboardRouter);
app.use("/queue", queueRouter);
app.use("/maps", mapListRouter);
app.use("/v2", v2Router);
app.use("/v2/demo", v2DemoRouter);
app.use("/v2/backup", v2BackupRouter);
app.use("/settings", settingsRouter);
app.use("/image", imageRouter);
// END ROUTES

// Steam API Calls.
app.get("/auth/steam", (req, res, next) => {
  const referer = req.get("referer") || req.get("origin") || "";
  const origin = allowedOrigins.find((o) => referer.startsWith(o)) || allowedOrigins[0];
  const apiURL = `${req.protocol}://${req.get("host")}/api`;
  const strategy = createSteamStrategy(apiURL, origin);
  passport.use("steam-dynamic", strategy);
  passport.authenticate("steam-dynamic", { failureRedirect: "/" })(req, res, next);
});

app.get(
  "/auth/steam/return",
  (req, res, next) => {
    req.url = req.originalUrl;
    next();
  },
  (req, res, next) => {
    passport.authenticate("steam-dynamic", { failureRedirect: "/" })(req, res, next);
  },
  (req, res) => {
    if (process.env.NODE_ENV === "test") {
      res.redirect("/");
    } else {
      const from = (req.query.from as string) || "";
      const target = allowedOrigins.find((o) => o === from) || allowedOrigins[0];
      res.redirect(target);
    }
  }
);

app.get('/logout', function(req, res, next) {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});
// END Steam API Calls.

// Local Passport Calls
app.post(
  "/login",
  passport.authenticate("local-login", {
    failWithError: true,
    failureMessage: true,
  }),
  (req: any, res: any) => {
    return res.json({ message: "Success!" });
  },
  (err: any, req: any, res: any, next: any) => {
    logError(err);
    err.message = getSessionMessage(err, req, "Authentication failed");
    return res.json(err);
  }
);

app.post(
  "/register",
  passport.authenticate("local-register", {
    failWithError: true,
    failureMessage: true,
  }),
  (req: any, res: any) => {
    return res.json({ message: "Success!" });
  },
  (err: any, req: any, res: any, next: any) => {
    err.message = getSessionMessage(err, req, "Registration failed");
    return res.json(err);
  }
);

// END Local Passport Calls

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err: any, req: any, res: any, next: any) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.json({ error: err.message });
});

export default app;
