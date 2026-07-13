const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let activeJobId = null;
let eventSource = null;
let selectedIds = new Set();
let currentJob = null;
let sortKey = null;
let sortAsc = true;

// Escape HTML to prevent XSS
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

// Create a safe link
function link(url, label) {
  if (!url) return '—';
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || 'Open')}</a>`;
}

// Format badge
function badge(status) {
  const label = status === 'awaiting_selection' ? 'Ready to select' : status;
  return `<span class="badge ${status}">${label}</span>`;
}

// Format time
function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Get color for match score
function getScoreColor(score) {
  if (score >= 300) return 'var(--accent)';
  if (score >= 200) return '#10B981';
  if (score >= 100) return '#F59E0B';
  return 'var(--text-muted)';
}

// Get value to sort by from a contact and company
function getRowValue(p, co, key) {
  switch (key) {
    case 'company': return p.company_name;
    case 'industry': return co?.industry;
    case 'company_size': return co?.company_size;
    case 'headquarters': return co?.headquarters;
    case 'company_linkedin': return co?.linkedin_url;
    case 'employee_count_range': return co?.employee_count_range;
    case 'founded_year': return co?.founded_year;
    case 'specialties': return co?.specialties;
    case 'person_name': return p.person_name;
    case 'job_title': return p.job_title;
    case 'linkedin': return p.profile_url;
    case 'location': return p.location;
    case 'match_score': return Number(p.match_score) || 0;
    case 'match_reason': return p.match_reason;
    default: return '';
  }
}

// Check server health
async function checkHealth() {
  try {
    const r = await fetch('/api/health');
    if (r.ok) {
      $('#serverStatus').textContent = 'Server Online';
      $('#serverStatus').classList.add('online');
    }
  } catch {
    $('#serverStatus').textContent = 'Server Offline';
    $('#serverStatus').classList.remove('online');
  }
}

// Bind slider events
function bindSlider(id, labelId) {
  const el = $(`#${id}`);
  const lbl = $(`#${labelId}`);
  if (!el || !lbl) return;

  el.addEventListener('input', () => {
    lbl.textContent = el.value;
    const presets = $$(`[data-target="${id}"] button`);
    presets.forEach(b => b.classList.remove('active'));
  });
}

// Initialize everything
function init() {
  // Check dark mode
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    if ($('#darkModeBtn')) $('#darkModeBtn').textContent = '☀️ Light Mode';
  }

  // Bind sliders
  bindSlider('companyLimit', 'companyLimitLabel');
  bindSlider('hrPerCompany', 'hrPerCompanyLabel');

  // Bind preset buttons
  $$('.preset-btns').forEach((group) => {
    const target = group.dataset.target;
    group.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        $(`#${target}`).value = btn.dataset.val;
        $(`#${target}Label`).textContent = btn.dataset.val;
        group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  });

  // Bind tab switching
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const n = tab.dataset.tab;
      $('#tabSheet').classList.toggle('hidden', n !== 'sheet');
      $('#tabCompanies').classList.toggle('hidden', n !== 'companies');
      $('#tabLogs').classList.toggle('hidden', n !== 'logs');
    });
  });

  // Bind dark mode
  $('#darkModeBtn')?.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDark);
    $('#darkModeBtn').textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  });

  // Bind sheet filter
  $('#sheetFilter')?.addEventListener('input', () => {
    renderSheet();
  });

  // Bind sort by column header
  $$('#sheetTable thead th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortKey === key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = true;
      }
      renderSheet();
    });
  });
}

// Render job details
function renderJob(job) {
  currentJob = job;
  $('#welcomeView').classList.add('hidden');
  $('#jobView').classList.remove('hidden');

  $('#jobTitle').textContent = `"${job.company_query}"`;
  $('#jobMeta').innerHTML = `${badge(job.status)} · Step ${job.step || 1} · ${formatTime(job.started_at || job.created_at)}`;

  $('#statCompanies').textContent = job.companies_found ?? job.companies?.length ?? 0;
  $('#statHr').textContent = job.hr_contacts_found ?? job.hr_contacts?.length ?? 0;
  $('#statHrTarget').textContent = job.hr_per_company ?? '—';

  updateStepPills(job);

  const banner = $('#failureBanner');
  if (job.failure_reason && job.status !== 'awaiting_selection') {
    banner.textContent = job.failure_reason;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  const hasHr = (job.hr_contacts?.length || 0) > 0;
  $('#exportCsvBtn').classList.toggle('hidden', !hasHr);
  $('#exportXlsxBtn').classList.toggle('hidden', !hasHr);

  $('#logPanel').innerHTML = '';
  (job.logs || []).forEach(appendLog);

  renderCompanies(job);
  renderSheet();

  $('#submitBtn').disabled = job.status === 'running';
  $('#findHrBtn').disabled = job.status === 'running' || job.status !== 'awaiting_selection';

  $('#exportCsvBtn').onclick = () => window.open(`/api/jobs/${job.id}/export.csv`, '_blank');
  $('#exportXlsxBtn').onclick = () => window.open(`/api/jobs/${job.id}/export.xlsx`, '_blank');
}

// Update step pills
function updateStepPills(job) {
  const s1 = $('#stepPill1');
  const s2 = $('#stepPill2');
  s1.className = 'step-pill';
  s2.className = 'step-pill';

  if (job.status === 'running' && (job.step || 1) === 1) {
    s1.classList.add('active');
  } else if (job.status === 'awaiting_selection' || (job.companies?.length && !job.hr_contacts?.length && job.step === 1)) {
    s1.classList.add('done');
    s2.classList.add('active');
  } else if (job.hr_contacts?.length || job.step === 2) {
    s1.classList.add('done');
    s2.classList.add('done');
  } else {
    s1.classList.add('active');
  }
}

// Render the sheet
function renderSheet() {
  if (!currentJob) return;
  const body = $('#sheetBody');
  body.innerHTML = '';

  if (!currentJob.hr_contacts?.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="14">${currentJob.status === 'awaiting_selection' ? 'Select companies and run Step 2' : 'No HR contacts yet'}</td></tr>`;
    return;
  }

  const filterText = ($('#sheetFilter')?.value || '').toLowerCase();
  const coMap = Object.fromEntries((currentJob.companies || []).map((c) => [c.id, c]));
  let rows = [...currentJob.hr_contacts];

  // Filter
  if (filterText) {
    rows = rows.filter(p => {
      const co = coMap[p.company_id] || currentJob.companies?.find((x) => x.name === p.company_name);
      const allText = [
        p.company_name, co?.industry, co?.company_size, co?.headquarters,
        co?.employee_count_range, co?.founded_year, co?.specialties,
        p.person_name, p.job_title, p.location, p.match_reason
      ].join(' ').toLowerCase();
      return allText.includes(filterText);
    });
  }

  // Sort
  if (sortKey) {
    rows.sort((a, b) => {
      const coA = coMap[a.company_id] || currentJob.companies?.find((x) => x.name === a.company_name);
      const coB = coMap[b.company_id] || currentJob.companies?.find((x) => x.name === b.company_name);
      let valA = getRowValue(a, coA, sortKey);
      let valB = getRowValue(b, coB, sortKey);

      if (sortKey === 'match_score') {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      } else {
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  for (const p of rows) {
    const c = coMap[p.company_id] || currentJob.companies?.find((x) => x.name === p.company_name);
    body.innerHTML += `<tr>
      <td class="col-company">${esc(p.company_name)}</td>
      <td>${esc(c?.industry)}</td>
      <td>${esc(c?.company_size)}</td>
      <td>${esc(c?.headquarters)}</td>
      <td>${link(c?.linkedin_url, 'Company')}</td>
      <td>${esc(c?.employee_count_range)}</td>
      <td>${esc(c?.founded_year)}</td>
      <td>${esc(c?.specialties)}</td>
      <td><strong>${esc(p.person_name)}</strong></td>
      <td class="col-title">${esc(p.job_title)}</td>
      <td>${link(p.profile_url, 'Profile')}</td>
      <td>${esc(p.location)}</td>
      <td><strong style="color:${getScoreColor(p.match_score)}">${p.match_score || 0}</strong></td>
      <td>${esc(p.match_reason)}</td>
    </tr>`;
  }
}

// Render company cards
function renderCompanies(job) {
  const el = $('#companyCards');
  const canSelect = job.status === 'awaiting_selection';

  $('#selectToolbar').classList.toggle('hidden', !canSelect);
  $('#step2Panel').classList.toggle('hidden', !canSelect);

  if (!job.companies?.length) {
    el.innerHTML = `<div class="welcome"><div class="welcome-icon">🏢</div>${job.status === 'running' ? 'Finding companies...' : 'No companies yet'}</div>`;
    return;
  }

  if (canSelect && selectedIds.size === 0) {
    for (const c of job.companies) selectedIds.add(c.id);
  }

  el.innerHTML = job.companies
    .map((c) => `
      <div class="company-card ${canSelect ? 'selectable' : ''} ${selectedIds.has(c.id) ? 'selected' : ''}" data-id="${c.id}">
        <div class="card-top">
          ${canSelect ? `<input type="checkbox" data-cid="${c.id}" ${selectedIds.has(c.id) ? 'checked' : ''} />` : ''}
          <div style="flex:1;">
            <h3>${esc(c.name)}</h3>
            <div class="meta">
              ${c.industry ? `<div><strong>Industry:</strong> ${esc(c.industry)}</div>` : ''}
              ${c.company_size ? `<div><strong>Size:</strong> ${esc(c.company_size)}</div>` : ''}
              ${c.employee_count_range ? `<div><strong>Employees:</strong> ${esc(c.employee_count_range)}</div>` : ''}
              ${c.headquarters ? `<div><strong>HQ:</strong> ${esc(c.headquarters)}</div>` : ''}
              ${c.founded_year ? `<div><strong>Founded:</strong> ${esc(c.founded_year)}</div>` : ''}
              ${c.specialties ? `<div><strong>Specialties:</strong> ${esc(c.specialties)}</div>` : ''}
              ${c.follower_count ? `<div><strong>Followers:</strong> ${esc(c.follower_count)}</div>` : ''}
              ${c.description ? `<div style="margin-top:8px;">${esc(String(c.description).slice(0, 250))}${c.description.length > 250 ? '...' : ''}</div>` : ''}
            </div>
            <div style="margin-top:12px; display:flex; gap:12px; flex-wrap:wrap;">
              ${c.linkedin_url ? link(c.linkedin_url, 'Visit LinkedIn →') : ''}
              ${c.website ? link(c.website, 'Website') : ''}
            </div>
          </div>
        </div>
      </div>`).join('');

  // Bind checkboxes
  $$('.company-card.selectable input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleCompanySelect(Number(cb.dataset.cid), cb.checked);
    });
  });

  // Bind card click
  $$('.company-card.selectable').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'A' || e.target.tagName === 'INPUT') return;
      const id = Number(card.dataset.id);
      const cb = card.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      toggleCompanySelect(id, cb.checked);
    });
  });

  $('#statSelected').textContent = selectedIds.size;
}

// Toggle company selection
function toggleCompanySelect(id, checked) {
  if (checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
  const card = $(`.company-card[data-id="${id}"]`);
  card?.classList.toggle('selected', checked);
  $('#statSelected').textContent = selectedIds.size;
}

// Append log line
function appendLog(log) {
  const panel = $('#logPanel');
  const line = document.createElement('div');
  line.className = `log-line ${log.level}`;
  const t = new Date(log.created_at).toLocaleTimeString();
  line.innerHTML = `<span class="time">${t}</span><span class="lvl">[${log.level.toUpperCase()}]</span> ${esc(log.message)}${log.detail ? `<span class="detail">${esc(log.detail)}</span>` : ''}`;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
}

// Load history
async function loadHistory() {
  const jobs = await (await fetch('/api/jobs')).json();
  const list = $('#historyList');
  if (!jobs.length) {
    list.innerHTML = `<div class="welcome" style="padding:30px;"><div class="welcome-icon">📋</div>No searches yet</div>`;
    return;
  }
  list.innerHTML = jobs.map((j) => `
    <div class="history-item ${j.id === activeJobId ? 'active' : ''}" data-id="${j.id}">
      <div class="q">${esc(j.company_query)}</div>
      <div class="meta">${badge(j.status)} · ${j.hr_contacts_found || 0} HR · ${j.companies_found || 0} cos · ${formatTime(j.created_at)}</div>
    </div>`).join('');
  $$('.history-item').forEach(el => el.addEventListener('click', () => selectJob(el.dataset.id)));
}

// Select a job from history
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
  if (job.status === 'running' || job.status === 'pending') connectStream(id);
}

// Connect to SSE stream
function connectStream(id) {
  eventSource = new EventSource(`/api/jobs/${id}/stream`);
  eventSource.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === 'log' && d.log) appendLog(d.log);
    if (d.type === 'company' || d.type === 'hr_contacts' || d.type === 'done' || d.type === 'status') {
      fetch(`/api/jobs/${id}`)
        .then(r => r.json())
        .then(job => {
          renderJob(job);
          if (d.type === 'done') {
            eventSource?.close();
            $('#submitBtn').disabled = false;
            $('#findHrBtn').disabled = job.status !== 'awaiting_selection';
            loadHistory();
          }
        });
    }
  };
  eventSource.onerror = (err) => {
    console.error('SSE error', err);
    eventSource.close();
  };
}

// Parse JSON response
async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(res.ok ? 'Invalid server response' : `Server error (${res.status})`);
  }
}

// Start the app
init();
checkHealth();
loadHistory();

// Search form
$('#searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  selectedIds = new Set();
  const btn = $('#submitBtn');
  btn.disabled = true;
  btn.textContent = '🔍 Searching...';
  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyQuery: $('#companyQuery').value.trim(),
        companyLimit: Number($('#companyLimit').value),
        hrPerCompany: Number($('#hrPerCompany')?.value || 10),
      }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      alert(data.reason || data.error || `Request failed (${res.status})`);
      btn.disabled = false;
      btn.textContent = '🔎 Start Discovery';
      return;
    }
    activeJobId = data.id;
    renderJob(data);
    connectStream(data.id);
    await loadHistory();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = '🔎 Start Discovery';
  } finally {
    btn.disabled = false;
    btn.textContent = '🔎 Start Discovery';
  }
});

// Find HR button
$('#findHrBtn').addEventListener('click', async () => {
  if (!activeJobId || !selectedIds.size) {
    alert('Please select at least one company');
    return;
  }
  const btn = $('#findHrBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Finding HR Contacts...';
  try {
    const res = await fetch(`/api/jobs/${activeJobId}/find-hr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyIds: [...selectedIds],
        hrPerCompany: Number($('#hrPerCompany').value),
        linkedinCookie: $('#linkedinCookie').value.trim() || undefined,
      }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      alert(data.error || `Request failed (${res.status})`);
      btn.disabled = false;
      btn.textContent = '👥 Find HR for Selected Companies';
      return;
    }
    renderJob(data);
    connectStream(activeJobId);
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = '👥 Find HR for Selected Companies';
  } finally {
    btn.disabled = false;
    btn.textContent = '👥 Find HR for Selected Companies';
  }
});

// Select all button
$('#selectAllBtn')?.addEventListener('click', () => {
  if (!currentJob) return;
  $$('.company-card.selectable input[type="checkbox"]').forEach(cb => {
    cb.checked = true;
    selectedIds.add(Number(cb.dataset.cid));
    cb.closest('.company-card')?.classList.add('selected');
  });
  $('#statSelected').textContent = selectedIds.size;
});

// Clear button
$('#clearSelBtn')?.addEventListener('click', () => {
  selectedIds.clear();
  $$('.company-card.selectable input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
    cb.closest('.company-card')?.classList.remove('selected');
  });
  $('#statSelected').textContent = 0;
});
