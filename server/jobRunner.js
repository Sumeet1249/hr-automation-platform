import { v4 as uuidv4 } from "uuid";
import {
  createJob,
  updateJob,
  addLog,
  addCompany,
  addHrContact,
  getJobWithDetails,
  setCompaniesSelected,
  getSelectedCompanies,
} from "./db.js";
import { runCompanyDiscoveryJob, runHrSearchJob } from "./linkedinScraper.js";
import { exportSheetCsv } from "./export.js";

const listeners = new Map();
let running = false;
const queue = [];

export function subscribe(jobId, res) {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId).add(res);
  res.on("close", () => listeners.get(jobId)?.delete(res));
}

function broadcast(jobId, payload) {
  const set = listeners.get(jobId);
  if (!set) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(data);
    } catch {
      /* gone */
    }
  }
}

function log(jobId, level, message, detail = null) {
  const row = addLog(jobId, level, message, detail);
  broadcast(jobId, { type: "log", log: row });
}

/** Step 1: discover companies */
export function enqueueDiscoverJob({ companyQuery, companyLimit, hrPerCompany }) {
  const id = uuidv4();
  createJob({ id, companyQuery, companyLimit, hrPerCompany, step: 1 });
  log(id, "info", "Step 1 queued", `Find companies: "${companyQuery}" · up to ${companyLimit}`);
  queue.push({ type: "discover", id, companyQuery, companyLimit });
  processQueue();
  return getJobWithDetails(id);
}

/** Step 2: HR search for selected companies */
export function enqueueHrJob({ jobId, companyIds, hrPerCompany, linkedinCookie }) {
  const job = getJobWithDetails(jobId);
  if (!job) throw new Error("Job not found");
  if (job.status !== "awaiting_selection") {
    throw new Error("Complete Step 1 and select companies first");
  }

  setCompaniesSelected(jobId, companyIds);
  updateJob(jobId, {
    status: "running",
    hr_per_company: hrPerCompany,
    step: 2,
    started_at: new Date().toISOString(),
  });
  log(
    jobId,
    "info",
    "Step 2 queued",
    `${companyIds.length} selected company(s) · ${hrPerCompany} HR each`
  );
  broadcast(jobId, { type: "status", status: "running" });
  queue.push({ type: "hr", id: jobId, hrPerCompany, linkedinCookie });
  processQueue();
  return getJobWithDetails(jobId);
}

async function processQueue() {
  if (running || !queue.length) return;
  running = true;
  while (queue.length) {
    const task = queue.shift();
    if (task.type === "discover") await executeDiscoverJob(task);
    else if (task.type === "hr") await executeHrJob(task);
  }
  running = false;
}

async function executeDiscoverJob({ id, companyQuery, companyLimit }) {
  updateJob(id, { status: "running", started_at: new Date().toISOString() });
  broadcast(id, { type: "status", status: "running" });
  log(id, "info", "Step 1 running", "Discovering LinkedIn companies");

  try {
    const result = await runCompanyDiscoveryJob({
      companyQuery,
      companyLimit,
      onLog: (level, message, detail) => log(id, level, message, detail),
      onProgress: (p) => {
        if (p.type === "company" && p.company) {
          const companyId = addCompany({ jobId: id, ...mapCompany(p.company) });
          updateJob(id, { companies_found: getJobWithDetails(id).companies.length });
          broadcast(id, { type: "company", company: { ...p.company, id: companyId } });
        }
      },
    });

    updateJob(id, {
      status: "awaiting_selection",
      companies_found: result.companies_found,
      finished_at: new Date().toISOString(),
      failure_reason: null,
    });
    log(id, "success", "Step 1 complete", "Select companies below, then find HR contacts");
    broadcast(id, { type: "done", status: "awaiting_selection", step: 1 });
  } catch (err) {
    log(id, "error", "Step 1 failed", err.message);
    const partial = getJobWithDetails(id);
    const hasData = (partial?.companies?.length || 0) > 0;
    updateJob(id, {
      status: hasData ? "awaiting_selection" : "failed",
      failure_reason: err.message,
      finished_at: new Date().toISOString(),
    });
    broadcast(id, { type: "done", status: hasData ? "awaiting_selection" : "failed", error: err.message });
  }
}

async function executeHrJob({ id, hrPerCompany, linkedinCookie }) {
  log(id, "info", "Step 2 running", "Searching HR contacts for selected companies");

  try {
    const selected = getSelectedCompanies(id);
    if (!selected.length) throw new Error("No companies selected");

    const result = await runHrSearchJob({
      selectedCompanies: selected,
      hrPerCompany,
      linkedinCookie,
      onLog: (level, message, detail) => log(id, level, message, detail),
      onProgress: (p) => {
        if (p.type === "hr_batch" && p.people) {
          const companies = getJobWithDetails(id)?.companies || [];
          const co = companies.find((c) => c.name === p.companyName);
          for (const person of p.people) {
            addHrContact({
              jobId: id,
              companyId: co?.id,
              companyName: p.companyName,
              personName: person.personName,
              jobTitle: person.jobTitle,
              profileUrl: person.profileUrl,
              location: person.location,
              snippet: person.snippet,
              matchReason: person.matchReason,
            });
          }
          const job = getJobWithDetails(id);
          updateJob(id, { hr_contacts_found: job.hr_contacts.length });
          broadcast(id, { type: "hr_contacts", contacts: p.people, total: job.hr_contacts.length });
        }
      },
    });

    const finalJob = getJobWithDetails(id);
    const csvPath = exportSheetCsv(id, finalJob.companies.filter((c) => c.selected), finalJob.hr_contacts);
    log(id, "success", "CSV exported", csvPath);

    updateJob(id, {
      status: result.status,
      hr_contacts_found: finalJob.hr_contacts.length,
      failure_reason: result.failure_reason,
      finished_at: new Date().toISOString(),
    });
    broadcast(id, { type: "done", status: result.status, step: 2, csvPath });
  } catch (err) {
    log(id, "error", "Step 2 failed", err.message);
    const partial = getJobWithDetails(id);
    const hasHr = (partial?.hr_contacts?.length || 0) > 0;
    updateJob(id, {
      status: hasHr ? "partial" : "failed",
      failure_reason: err.message,
      finished_at: new Date().toISOString(),
    });
    broadcast(id, { type: "done", status: hasHr ? "partial" : "failed", error: err.message });
  }
}

function mapCompany(c) {
  return {
    name: c.name,
    linkedinUrl: c.linkedinUrl,
    industry: c.industry,
    companySize: c.companySize,
    headquarters: c.headquarters,
    website: c.website,
    description: c.description,
    followerCount: c.followerCount,
  };
}
