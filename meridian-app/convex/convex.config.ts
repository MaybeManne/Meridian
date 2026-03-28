import { defineApp } from "convex/server";
import browserUse from "@convex-dev/browser-use/convex.config";

const app = defineApp();
app.use(browserUse);
export default app;
