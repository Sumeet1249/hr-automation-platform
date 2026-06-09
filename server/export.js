import { writeFileSync } from "fs";
import { join } from "path";
import { paths } from "./db.js";

export function exportSheetCsv(jobId, companies, contacts) {
  const headers = [
    "Company",
    "Industry",
    "Company Size",
    "Headquarters",
    "Company LinkedIn",
    "Website",
    "Person Name",
    "Job Title",
    "Profile URL",
    "Location",
    "Match Reason",
  ];

  const rows = [headers];
  const companyMap = Object.fromEntries(companies.map((c) => [c.id, c]));

  if (!contacts.length) {
    for (const c of companies) {
      rows.push([
        c.name,
        c.industry || "",
        c.company_size || "",
        c.headquarters || "",
        c.linkedin_url || "",
        c.website || "",
        "",
        "",
        "",
        "",
        "",
      ]);
    }
  } else {
    for (const p of contacts) {
      const co = companyMap[p.company_id] || companies.find((c) => c.name === p.company_name);
      rows.push([
        p.company_name,
        co?.industry || "",
        co?.company_size || "",
        co?.headquarters || "",
        co?.linkedin_url || "",
        co?.website || "",
        p.person_name,
        p.job_title || "",
        p.profile_url,
        p.location || "",
        p.match_reason || "",
      ]);
    }
  }

  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const path = join(paths.output, `hr-sheet-${jobId}.csv`);
  writeFileSync(path, csv, "utf-8");
  return path;
}
