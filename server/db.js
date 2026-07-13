import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const OUTPUT_DIR = join(ROOT, "output");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "hr-finder.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    company_query TEXT NOT NULL,
    company_limit INTEGER NOT NULL,
    hr_per_company INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    companies_found INTEGER DEFAULT 0,
    hr_contacts_found INTEGER DEFAULT 0,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    name TEXT NOT NULL,
    linkedin_url TEXT,
    industry TEXT,
    company_size TEXT,
    headquarters TEXT,
    website TEXT,
    description TEXT,
    follower_count TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hr_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    company_id INTEGER,
    company_name TEXT NOT NULL,
    person_name TEXT NOT NULL,
    job_title TEXT,
    profile_url TEXT NOT NULL,
    location TEXT,
    snippet TEXT,
    match_reason TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_job ON activity_logs(job_id);
  CREATE INDEX IF NOT EXISTS idx_companies_job ON companies(job_id);
  CREATE INDEX IF NOT EXISTS idx_hr_job ON hr_contacts(job_id);
`);

try {
  db.exec(`ALTER TABLE jobs ADD COLUMN step INTEGER DEFAULT 1`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE companies ADD COLUMN selected INTEGER DEFAULT 0`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE hr_contacts ADD COLUMN match_score INTEGER DEFAULT 0`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE companies ADD COLUMN employee_count_range TEXT`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE companies ADD COLUMN founded_year TEXT`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE companies ADD COLUMN specialties TEXT`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE companies ADD COLUMN linkedin_slug TEXT`);
} catch {
  /* exists */
}

export function createJob({ id, companyQuery, companyLimit, hrPerCompany, step = 1 }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO jobs (id, company_query, company_limit, hr_per_company, status, step, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).run(id, companyQuery, companyLimit, hrPerCompany, step, now);
  return getJob(id);
}

export function updateJob(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
    ...keys.map((k) => fields[k]),
    id
  );
}

export function getJob(id) {
  return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
}

export function listJobs(limit = 100) {
  return db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`).all(limit);
}

export function addLog(jobId, level, message, detail = null) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO activity_logs (job_id, level, message, detail, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(jobId, level, message, detail, now);
  return db.prepare(`SELECT * FROM activity_logs WHERE job_id = ? ORDER BY id DESC LIMIT 1`).get(jobId);
}

export function getLogs(jobId) {
  return db.prepare(`SELECT * FROM activity_logs WHERE job_id = ? ORDER BY id ASC`).all(jobId);
}

export function addCompany(record) {
  const now = new Date().toISOString();
  const r = db.prepare(
    `INSERT INTO companies (job_id, name, linkedin_url, industry, company_size, headquarters, website, description, follower_count, employee_count_range, founded_year, specialties, linkedin_slug, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.jobId,
    record.name,
    record.linkedinUrl ?? null,
    record.industry ?? null,
    record.companySize ?? null,
    record.headquarters ?? null,
    record.website ?? null,
    record.description ?? null,
    record.followerCount ?? null,
    record.employeeCountRange ?? null,
    record.foundedYear ?? null,
    record.specialties ?? null,
    record.linkedinSlug ?? null,
    now
  );
  return Number(r.lastInsertRowid);
}

export function addHrContact(record) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO hr_contacts (job_id, company_id, company_name, person_name, job_title, profile_url, location, snippet, match_reason, match_score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.jobId,
    record.companyId ?? null,
    record.companyName,
    record.personName,
    record.jobTitle ?? null,
    record.profileUrl,
    record.location ?? null,
    record.snippet ?? null,
    record.matchReason ?? null,
    record.matchScore ?? 0,
    now
  );
}

export function getCompanies(jobId) {
  return db.prepare(`SELECT * FROM companies WHERE job_id = ? ORDER BY id ASC`).all(jobId);
}

export function getHrContacts(jobId) {
  return db.prepare(`SELECT * FROM hr_contacts WHERE job_id = ? ORDER BY match_score DESC, company_name, person_name`).all(jobId);
}

export function setCompaniesSelected(jobId, companyIds) {
  db.prepare(`UPDATE companies SET selected = 0 WHERE job_id = ?`).run(jobId);
  const stmt = db.prepare(`UPDATE companies SET selected = 1 WHERE job_id = ? AND id = ?`);
  for (const cid of companyIds) stmt.run(jobId, cid);
}

export function getSelectedCompanies(jobId) {
  return db.prepare(`SELECT * FROM companies WHERE job_id = ? AND selected = 1 ORDER BY id ASC`).all(jobId);
}

export function getJobWithDetails(id) {
  const job = getJob(id);
  if (!job) return null;
  return {
    ...job,
    logs: getLogs(id),
    companies: getCompanies(id),
    hr_contacts: getHrContacts(id),
  };
}

export const paths = { root: ROOT, output: OUTPUT_DIR, data: DATA_DIR };
