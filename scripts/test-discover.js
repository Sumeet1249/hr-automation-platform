import { runCompanyDiscoveryJob } from "../server/linkedinScraper.js";

const query = process.argv[2] || "Razorpay";
const result = await runCompanyDiscoveryJob({
  companyQuery: query,
  companyLimit: 3,
  onLog: (l, m, d) => console.log(`[${l}] ${m}${d ? " — " + d : ""}`),
  onProgress: (p) => p.type === "company" && console.log("  →", p.company.name, p.company.linkedinUrl),
});

console.log("\nRESULT:", JSON.stringify(result, null, 2));
