import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function GET() {
  try {
    const [sweep, findings] = await Promise.all([
      convex.query(api.humint.getLatestSweep),
      convex.query(api.humint.getAllRecentFindings, { limit: 30 }),
    ]);
    const agents = sweep
      ? await convex.query(api.humint.getAgents, { sweepId: sweep._id })
      : [];
    return Response.json({ sweep, findings, agents });
  } catch {
    return Response.json({ findings: [], agents: [] });
  }
}

export async function POST() {
  try {
    const result = await convex.mutation(api.humint.triggerSweep, {});
    return Response.json(result);
  } catch {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
