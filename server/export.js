import { writeFileSync } from "fs";
import { join } from "path";
import { paths } from "./db.js";
import ExcelJS from "exceljs";

export function exportSheetCsv(jobId, companies, contacts) {
  const headers = [
    "Company",
    "Industry",
    "Company Size",
    "Headquarters",
    "Company LinkedIn",
    "Website",
    "Employee Count Range",
    "Founded Year",
    "Specialties",
    "Person Name",
    "Job Title",
    "Profile URL",
    "Location",
    "Match Score",
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
        c.employee_count_range || "",
        c.founded_year || "",
        c.specialties || "",
        "",
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
        co?.employee_count_range || "",
        co?.founded_year || "",
        co?.specialties || "",
        p.person_name,
        p.job_title || "",
        p.profile_url,
        p.location || "",
        p.match_score || 0,
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

export async function exportSheetXlsx(jobId, companies, contacts) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('HR Contacts');

  const headers = [
    "Company",
    "Industry",
    "Company Size",
    "Headquarters",
    "Company LinkedIn",
    "Website",
    "Employee Count Range",
    "Founded Year",
    "Specialties",
    "Person Name",
    "Job Title",
    "Profile URL",
    "Location",
    "Match Score",
    "Match Reason",
  ];
  
  worksheet.columns = headers.map(header => ({ header, key: header.toLowerCase().replace(/ /g, '_'), width: 20 }));
  
  const companyMap = Object.fromEntries(companies.map((c) => [c.id, c]));
  
  if (!contacts.length) {
    for (const c of companies) {
      worksheet.addRow({
        company: c.name,
        industry: c.industry || "",
        company_size: c.company_size || "",
        headquarters: c.headquarters || "",
        company_linkedin: c.linkedin_url || "",
        website: c.website || "",
        employee_count_range: c.employee_count_range || "",
        founded_year: c.founded_year || "",
        specialties: c.specialties || "",
        person_name: "",
        job_title: "",
        profile_url: "",
        location: "",
        match_score: "",
        match_reason: "",
      });
    }
  } else {
    for (const p of contacts) {
      const co = companyMap[p.company_id] || companies.find((c) => c.name === p.company_name);
      worksheet.addRow({
        company: p.company_name,
        industry: co?.industry || "",
        company_size: co?.company_size || "",
        headquarters: co?.headquarters || "",
        company_linkedin: co?.linkedin_url || "",
        website: co?.website || "",
        employee_count_range: co?.employee_count_range || "",
        founded_year: co?.founded_year || "",
        specialties: co?.specialties || "",
        person_name: p.person_name,
        job_title: p.job_title || "",
        profile_url: p.profile_url,
        location: p.location || "",
        match_score: p.match_score || 0,
        match_reason: p.match_reason || "",
      });
    }
  }
  
  const path = join(paths.output, `hr-sheet-${jobId}.xlsx`);
  await workbook.xlsx.writeFile(path);
  return path;
}
