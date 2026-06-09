const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let activeJobId = null;
let eventSource = null;
let selectedIds = new Set();

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function link(url, label) {
  if (!url) return "—";
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label || "Open")}</a>`;
}

function badge(status) {
  const label = status === "awaiting_selection" ? "ready to select" : status;
  return `<span class="badge ${status}">${label}</span>`;
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    if (r.ok) {
      $("#serverStatus").textContent = "Server online";
      $("#serverStatus").classList.add("online");
    }
  } catch {
    $("#serverStatus").textContent = "Server offline";
  }
}

function bindSlider(id, labelId) {
  const el = $(`#${id}`);
  const lbl = $(`#${labelId}`);
  if (!el || !lbl) return;
  el.addEventListener("input", () => {
    lbl.textContent = el.value;
    const presets = document.querySelector(`[data-target="${id}"]`);
    presets?.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  });
}

bindSlider("companyLimit", "companyLimitLabel");
bindSlider("hrPerCompany", "hrPerCompanyLabel");

$$(".preset-btns").forEach((group) => {
  const target = group.dataset.target;
  group.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $(`#${target}`).value = btn.dataset.val;
      $(`#${target}Label`).textContent = btn.dataset.val;
      group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
});

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const n = tab.dataset.tab;
    $("#tabSheet").classList.toggle("hidden", n !== "sheet");
    $("#tabCompanies").classList.toggle("hidden", n !== "companies");
    $("#tabLogs").classList.toggle("hidden", n !== "logs");
  });
});

function updateStepPills(job) {
  const s1 = $("#stepPill1");
  const s2 = $("#stepPill2");
  s1.className = "step-pill";
  s2.className = "step-pill";

  if (job.status === "running" && (job.step || 1) === 1) {
    s1.classList.add("active");
  } else if (job.status === "awaiting_selection" || (job.companies?.length && !job.hr_contacts?.length && job.step === 1)) {
    s1.classList.add("done");
    s2.classList.add("active");
  } else if (job.hr_contacts?.length || job.step === 2) {
    s1.classList.add("done");
    s2.classList.add("done");
  } else {
    s1.classList.add("active");
  }
}

function renderSheet(job) {
  const body = $("#sheetBody");
  body.innerHTML = "";

  if (!job.hr_contacts?.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="10">${job.status === "awaiting_selection" ? "Select companies and run Step 2" : "No HR contacts yet"}</td></tr>`;
    return;
  }

  const coMap = Object.fromEntries((job.companies || []).map((c) => [c.id, c]));
  for (const p of job.hr_contacts) {
    const c = coMap[p.company_id] || job.companies?.find((x) => x.name === p.company_name);
    body.innerHTML += `<tr>
      <td class="col-company">${esc(p.company_name)}</td>
      <td>${esc(c?.industry)}</td>
      <td>${esc(c?.company_size)}</td>
      <td>${esc(c?.headquarters)}</td>
      <td>${link(c?.linkedin_url, "Company")}</td>
      <td><strong>${esc(p.person_name)}</strong></td>
      <td class="col-title">${esc(p.job_title)}</td>
      <td>${link(p.profile_url, "Profile")}</td>
      <td>${esc(p.location)}</td>
      <td>${esc(p.match_reason)}</td>
    </tr>`;
  }
}

function toggleCompanySelect(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  const card = document.querySelector(`.company-card[data-id="${id}"]`);
  card?.classList.toggle("selected", checked);
  $("#statSelected").textContent = selectedIds.size;
}

function renderCompanies(job) {
  const el = $("#companyCards");
  const canSelect = job.status === "awaiting_selection";

  $("#selectToolbar").classList.toggle("hidden", !canSelect);
  $("#step2Panel").classList.toggle("hidden", !canSelect);

  if (!job.companies?.length) {
    el.innerHTML = `<div class="welcome"><div class="welcome-icon">🏢</div>${job.status === "running" ? "Finding companies…" : "No companies yet"}</div>`;
    return;
  }

  if (canSelect && selectedIds.size === 0) {
    for (const c of job.companies) selectedIds.add(c.id);
  }

  el.innerHTML = job.companies
    .map(
      (c) => `
    <div class="company-card ${canSelect ? "selectable" : ""} ${selectedIds.has(c.id) ? "selected" : ""}" data-id="${c.id}">
      <div class="card-top">
        ${canSelect ? `<input type="checkbox" data-cid="${c.id}" ${selectedIds.has(c.id) ? "checked" : ""} />` : ""}
        <div style="flex:1">
          <h3>${esc(c.name)}</h3>
          <div class="meta">
            ${c.industry ? `<div><strong>Industry:</strong> ${esc(c.industry)}</div>` : ""}
            ${c.company_size ? `<div><strong>Size:</strong> ${esc(c.company_size)}</div>` : ""}
            ${c.headquarters ? `<div><strong>HQ:</strong> ${esc(c.headquarters)}</div>` : ""}
            ${c.follower_count ? `<div><strong>Followers:</strong> ${esc(c.follower_count)}</div>` : ""}
            ${c.description ? `<div style="margin-top:8px">${esc(String(c.description).slice(0, 200))}${c.description.length > 200 ? "…" : ""}</div>` : ""}
          </div>
          <div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap">
            ${c.linkedin_url ? link(c.linkedin_url, "Visit LinkedIn →") : ""}
            ${c.website ? link(c.website, "Website") : ""}
          </div>
        </div>
      </div>
    </div>`
    )
    .join("");

  $$(".company-card.selectable input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      toggleCompanySelect(Number(cb.dataset.cid), cb.checked);
    });
  });

  $$(".company-card.selectable").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.tagName === "A" || e.target.tagName === "INPUT") return;
      const id = Number(card.dataset.id);
      const cb = card.querySelector("input[type=checkbox]");
      cb.checked = !cb.checked;
      toggleCompanySelect(id, cb.checked);
    });
  });

  $("#statSelected").textContent = selectedIds.size;
}

function appendLog(log) {
  const panel = $("#logPanel");
  const line = document.createElement("div");
  line.className = `log-line ${log.level}`;
  const t = new Date(log.created_at).toLocaleTimeString();
  line.innerHTML = `<span class="time">${t}</span><span class="lvl">[${log.level.toUpperCase()}]</span> ${esc(log.message)}${log.detail ? `<span class="detail">${esc(log.detail)}</span>` : ""}`;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
}

function renderJob(job) {
  $("#welcomeView").classList.add("hidden");
  $("#jobView").classList.remove("hidden");

  $("#jobTitle").textContent = `"${job.company_query}"`;
  $("#jobMeta").innerHTML = `${badge(job.status)} · Step ${job.step || 1} · ${formatTime(job.started_at || job.created_at)}`;

  $("#statCompanies").textContent = job.companies_found ?? job.companies?.length ?? 0;
  $("#statHr").textContent = job.hr_contacts_found ?? job.hr_contacts?.length ?? 0;
  $("#statHrTarget").textContent = job.hr_per_company ?? "—";

  updateStepPills(job);

  const banner = $("#failureBanner");
  if (job.failure_reason && job.status !== "awaiting_selection") {
    banner.textContent = job.failure_reason;
    banner.classList.remove("hidden");
  } else banner.classList.add("hidden");

  const hasHr = (job.hr_contacts?.length || 0) > 0;
  $("#exportBtn").classList.toggle("hidden", !hasHr);

  $("#logPanel").innerHTML = "";
  (job.logs || []).forEach(appendLog);

  renderCompanies(job);
  renderSheet(job);

  $("#submitBtn").disabled = job.status === "running";
  $("#findHrBtn").disabled = job.status === "running" || job.status !== "awaiting_selection";

  $("#exportBtn").onclick = () => window.open(`/api/jobs/${job.id}/export.csv`, "_blank");
}

async function loadHistory() {
  const jobs = await (await fetch("/api/jobs")).json();
  const list = $("#historyList");
  if (!jobs.length) {
    list.innerHTML = `<div class="welcome" style="padding:20px"><div class="welcome-icon">📋</div>No searches yet</div>`;
    return;
  }
  list.innerHTML = jobs
    .map(
      (j) => `
    <div class="history-item ${j.id === activeJobId ? "active" : ""}" data-id="${j.id}">
      <div class="q">${esc(j.company_query)}</div>
      <div class="meta">${badge(j.status)} · ${j.hr_contacts_found || 0} HR · ${j.companies_found || 0} cos. · ${formatTime(j.created_at)}</div>
    </div>`
    )
    .join("");
  $$(".history-item").forEach((el) => el.addEventListener("click", () => selectJob(el.dataset.id)));
}

async function selectJob(id) {
  activeJobId = id;
  selectedIds = new Set();
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  const job = await (await fetch(`/api/jobs/${id}`)).json();
  if (job.companies?.length) {
    for (const c of job.companies.filter((x) => x.selected)) selectedIds.add(c.id);
  }
  renderJob(job);
  await loadHistory();
  if (job.status === "running" || job.status === "pending") connectStream(id);
}

function connectStream(id) {
  eventSource = new EventSource(`/api/jobs/${id}/stream`);
  eventSource.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === "log" && d.log) appendLog(d.log);
    if (d.type === "progress") {
      if (d.companies_found != null) $("#statCompanies").textContent = d.companies_found;
      if (d.total != null) $("#statHr").textContent = d.total;
    }
    if (d.type === "company" || d.type === "hr_contacts" || d.type === "done" || d.type === "status") {
      fetch(`/api/jobs/${id}`)
        .then((r) => r.json())
        .then((j) => {
          renderJob(j);
          if (d.type === "done") {
            eventSource?.close();
            $("#submitBtn").disabled = false;
            $("#findHrBtn").disabled = j.status !== "awaiting_selection";
            loadHistory();
          }
        });
    }
  };
}

async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "Invalid server response" : `Server error (${res.status}): restart npm start in HR Finding Automation`);
  }
}

$("#searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  selectedIds = new Set();
  const btn = $("#submitBtn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyQuery: $("#companyQuery").value.trim(),
        companyLimit: Number($("#companyLimit").value),
        hrPerCompany: Number($("#hrPerCompany")?.value || 10),
      }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      alert(data.reason || data.error || `Request failed (${res.status})`);
      btn.disabled = false;
      return;
    }
    activeJobId = data.id;
    renderJob(data);
    connectStream(data.id);
    await loadHistory();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

$("#findHrBtn").addEventListener("click", async () => {
  if (!activeJobId || !selectedIds.size) {
    alert("Select at least one company");
    return;
  }
  $("#findHrBtn").disabled = true;
  try {
    const res = await fetch(`/api/jobs/${activeJobId}/find-hr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyIds: [...selectedIds],
        hrPerCompany: Number($("#hrPerCompany").value),
        linkedinCookie: $("#linkedinCookie").value.trim() || undefined,
      }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      alert(data.error || `Request failed (${res.status})`);
      $("#findHrBtn").disabled = false;
      return;
    }
    renderJob(data);
    connectStream(activeJobId);
  } catch (err) {
    alert(err.message);
    $("#findHrBtn").disabled = false;
  }
});

$("#selectAllBtn")?.addEventListener("click", () => {
  $$(".company-card.selectable input[type=checkbox]").forEach((cb) => {
    cb.checked = true;
    selectedIds.add(Number(cb.dataset.cid));
    cb.closest(".company-card")?.classList.add("selected");
  });
  $("#statSelected").textContent = selectedIds.size;
});

$("#clearSelBtn")?.addEventListener("click", () => {
  selectedIds.clear();
  $$(".company-card.selectable input[type=checkbox]").forEach((cb) => {
    cb.checked = false;
    cb.closest(".company-card")?.classList.remove("selected");
  });
  $("#statSelected").textContent = 0;
});

checkHealth();
loadHistory();
