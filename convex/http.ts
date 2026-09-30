import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { upload as uploadAppRelease } from "./appUpdate";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({ path: "/app-release", method: "POST", handler: uploadAppRelease });

export default http;
