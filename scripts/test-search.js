import puppeteer from "puppeteer";
import { runHrFinderJob } from "../server/linkedinScraper.js";

const logs = [];
const result = await runHrFinderJob({
  jobId: "test",
  companyQuery: process.argv[2] || "Infosys",
  companyLimit: 1,
  hrPerCompany: 5,
  onLog: (level, msg, detail) => {
    console.log(`[${level}] ${msg}${detail ? " — " + detail : ""}`);
    logs.push({ level, msg, detail });
  },
  onProgress: (p) => console.log("progress:", JSON.stringify(p).slice(0, 200)),
});

console.log("\nRESULT:", JSON.stringify(result, null, 2));
