import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { listJobs, getJobWithDetails, paths } from "./db.js";
import { enqueueDiscoverJob, enqueueHrJob, subscribe } from "./jobRunner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = Number(process.env.PORT ?? 3940);
const HOST =
  process.env.HOST ??
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(ROOT, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/** Step 1: Find companies only */
app.post("/api/discover", (req, res) => {
  const companyQuery = String(req.body?.companyQuery ?? req.body?.query ?? "").trim();
  const companyLimit = Math.min(20, Math.max(1, Number(req.body?.companyLimit ?? 5)));
  const hrPerCompany = Math.min(50, Math.max(1, Number(req.body?.hrPerCompany ?? 10)));

  if (!companyQuery || companyQuery.length < 2) {
    return res.status(400).json({
      error: "Company search required",
      reason: "Enter a company name (e.g. Razorpay, Infosys, TCS).",
    });
  }

  const job = enqueueDiscoverJob({ companyQuery, companyLimit, hrPerCompany });
  res.status(201).json(job);
});

/** Step 2: HR search for selected companies */
app.post("/api/jobs/:id/find-hr", (req, res) => {
  const companyIds = (req.body?.companyIds ?? [])
    .map(Number)
    .filter((n) => n > 0);
  const hrPerCompany = Math.min(50, Math.max(1, Number(req.body?.hrPerCompany ?? 10)));
  const linkedinCookie = String(req.body?.linkedinCookie ?? "").trim() || undefined;

  if (!companyIds.length) {
    return res.status(400).json({ error: "Select at least one company" });
  }

  try {
    const job = enqueueHrJob({ jobId: req.params.id, companyIds, hrPerCompany, linkedinCookie });
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Legacy alias → Step 1 */
app.post("/api/jobs", (req, res) => {
  const companyQuery = String(req.body?.companyQuery ?? req.body?.query ?? "").trim();
  const companyLimit = Math.min(20, Math.max(1, Number(req.body?.companyLimit ?? 5)));
  const hrPerCompany = Math.min(50, Math.max(1, Number(req.body?.hrPerCompany ?? 10)));
  if (!companyQuery || companyQuery.length < 2) {
    return res.status(400).json({ error: "Company search required" });
  }
  res.status(201).json(enqueueDiscoverJob({ companyQuery, companyLimit, hrPerCompany }));
});

app.get("/api/jobs", (_req, res) => {
  res.json(listJobs(100));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

app.get("/api/jobs/:id/stream", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job) return res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  for (const log of job.logs) {
    res.write(`data: ${JSON.stringify({ type: "log", log })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: "status", status: job.status })}\n\n`);
  subscribe(req.params.id, res);
});

app.get("/api/jobs/:id/export.csv", (req, res) => {
  const csvPath = join(paths.output, `hr-sheet-${req.params.id}.csv`);
  if (!existsSync(csvPath)) {
    return res.status(404).json({ error: "CSV not ready yet" });
  }
  res.download(csvPath, `hr-contacts-${req.params.id.slice(0, 8)}.csv`);
});

app.get("*", (_req, res) => {
  res.sendFile(join(ROOT, "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`\n  HR Finding Dashboard → http://${HOST}:${PORT}\n`);
});
