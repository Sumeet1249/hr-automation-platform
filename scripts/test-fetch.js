import {
  fetchCompanyBySlug,
  searchDuckDuckGoHtml,
  extractCompanyUrlsFromHtml,
  extractProfileUrlsFromHtml,
  braveSearchHtml,
  extractProfileUrlsFromRawHtml,
} from "../server/searchProviders.js";

const query = process.argv[2] || "Infosys";
console.log("=== Fetch slug: infosys ===");
console.log(await fetchCompanyBySlug("infosys", query));

console.log("\n=== DDG company search ===");
const html = await searchDuckDuckGoHtml(`site:linkedin.com/company ${query}`, (l, m, d) =>
  console.log(`[${l}] ${m}`, d || "")
);
console.log("HTML length:", html.length);
console.log("Company URLs:", extractCompanyUrlsFromHtml(html));

console.log("\n=== DDG HR search ===");
const hrHtml = await searchDuckDuckGoHtml(
  `site:linkedin.com/in "${query}" "human resources"`,
  (l, m, d) => console.log(`[${l}] ${m}`, d || "")
);
console.log("Profile URLs:", extractProfileUrlsFromHtml(hrHtml).slice(0, 8));

console.log("\n=== Brave HR search ===");
const brave = await braveSearchHtml(
  `site:linkedin.com/in ${query} human resources OR recruiter`,
  (l, m, d) => console.log(`[${l}] ${m}`, d || "")
);
console.log("Brave HTML length:", brave.length);
console.log("Brave profiles:", extractProfileUrlsFromRawHtml(brave).slice(0, 8));
