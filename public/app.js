const state = {
  students: [],
  sessions: [],
  attendance: {},   // { studentId: { status, scannedAt } }
  activeTab: 'students',
  currentSession: '',
  lastScanId: '',
};

// ---------- tiny API client ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const get = p => api(p);
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b) });
const del = p => api(p, { method: 'DELETE' });

// ---------- session time window ----------
function sessionWindow(s) {
  if (!s || !s.startTime || !s.endTime) return null;
  const start = new Date(`${s.date}T${s.startTime}:00`);
  let end = new Date(`${s.date}T${s.endTime}:00`);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

// ---------- data loading ----------
async function loadAll() {
  const [students, sessions] = await Promise.all([get('/api/students'), get('/api/sessions')]);
  state.students = students;
  state.sessions = sessions;
  state.attendance = {};

  const sheet = document.getElementById('attendanceSessionSelect');
  sheet.innerHTML = sessions.map(s => {
    const win = sessionWindow(s);
    const times = win ? `${fmtTime(win.start)} – ${fmtTime(win.end)}` : '';
    return `<option value="${s.id}">${fmtDate(s.date)} · ${times} — ${esc(s.title)}</option>`;
  }).join('') || '<option value="">No events yet — add one first</option>';

  if (state.currentSession && sessions.some(s => s.id === state.currentSession)) {
    sheet.value = state.currentSession;
  } else {
    state.currentSession = sheet.value;
  }

  renderAll();
  updateScannerStatus();
  if (state.currentSession) await loadAttendanceSheet();
  updateHero();
}

async function loadAttendanceSheet() {
  const sid = document.getElementById('attendanceSessionSelect').value;
  state.currentSession = sid;
  if (!sid) {
    state.attendance = {};
    renderSheet();
    updateScannerStatus();
    return;
  }
  const rows = await get(`/api/sessions/${sid}/attendance`);
  state.attendance = {};
  rows.forEach(r => { state.attendance[r.studentId] = { status: r.status, scannedAt: r.scannedAt }; });
  renderSheet();
  updateScannerStatus();
}

// ---------- rendering ----------
function renderAll() {
  renderStudents();
  renderSessions();
  renderReports();
}

function renderStudents() {
  document.getElementById('studentCount').textContent = state.students.length;
  const wrap = document.getElementById('studentList');
  if (!state.students.length) {
    wrap.innerHTML = emptyBox('No students yet.', 'Add your first student to get started.');
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>Name</th><th>Student ID</th><th>Email</th><th></th></tr></thead>
    <tbody>${state.students.map(s => `
      <tr>
        <td>
          <div class="cell-main">
            <span class="avatar" style="background:${avatarColor(s.name)}">${initials(s.name)}</span>
            <strong>${esc(s.name)}</strong>
          </div>
        </td>
        <td><span class="mono">${esc(s.studentId) || '—'}</span></td>
        <td class="meta">${esc(s.email) || '—'}</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="editStudent('${s.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="askDeleteStudent('${s.id}')">Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table>`;
}

function renderSessions() {
  document.getElementById('sessionCount').textContent = state.sessions.length;
  const wrap = document.getElementById('sessionList');
  if (!state.sessions.length) {
    wrap.innerHTML = emptyBox('No events yet.', 'Add one to start taking attendance.');
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>Date</th><th>Event</th><th>Attendance</th><th></th></tr></thead>
    <tbody>${state.sessions.map(s => {
      const win = sessionWindow(s);
      const total = state.students.length;
      const present = s.present || 0;
      const pct = total ? Math.round((present / total) * 100) : 0;
      return `
      <tr>
        <td>
          <span class="session-date">${esc(fmtDate(s.date))}</span>
          ${win ? `<div class="session-notes">${fmtTime(win.start)} – ${fmtTime(win.end)}</div>` : ''}
        </td>
        <td>
          <strong>${esc(s.title)}</strong>
          ${s.notes ? `<div class="session-notes">${esc(s.notes)}</div>` : ''}
        </td>
        <td>${total ? `${present}/${total} · ${pct}%` : '—'}</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="editSession('${s.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="askDeleteSession('${s.id}')">Delete</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function renderSheet() {
  const wrap = document.getElementById('attendanceSheet');
  if (!state.currentSession || !state.students.length) {
    wrap.innerHTML = emptyBox('Nothing to mark yet.', state.students.length ? 'Pick an event from the dropdown.' : 'Add students first.');
    setMiniCounts(0, 0, 0);
    return;
  }

  let present = 0, absent = 0, unmarked = 0;
  const rows = state.students.map(s => {
    const rec = state.attendance[s.id] || {};
    const v = rec.status || 'unmarked';
    if (v === 'present') present++;
    else if (v === 'absent') absent++;
    else unmarked++;
    const meta = v === 'present' && rec.scannedAt
      ? `<span class="scan-meta">checked in ${fmtTime(rec.scannedAt)}</span>` : '';
    return `
      <tr>
        <td>
          <div class="cell-main">
            <span class="avatar" style="background:${avatarColor(s.name)}">${initials(s.name)}</span>
            <div>
              <strong>${esc(s.name)}</strong>
              <span class="scan-meta">ID ${esc(s.studentId)}</span>
            </div>
          </div>
        </td>
        <td style="min-width:280px">
          <div class="seg">
            <button data-v="present" class="${v === 'present' ? 'on' : ''}" onclick="mark('${s.id}', 'present')">Present</button>
            <button data-v="absent" class="${v === 'absent' ? 'on' : ''}" onclick="mark('${s.id}', 'absent')">Absent</button>
            <button data-v="unmarked" class="${v === 'unmarked' ? 'on' : ''}" onclick="mark('${s.id}', 'unmarked')">Unmark</button>
          </div>
          ${meta}
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `<table><thead><tr><th>Student</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  setMiniCounts(state.students.length, present, absent);
}

function setMiniCounts(total, present, absent) {
  document.getElementById('miniPresent').textContent = `${present} present`;
  document.getElementById('miniAbsent').textContent = `${absent} absent`;
  document.getElementById('miniUnmarked').textContent = `${Math.max(total - present - absent, 0)} unmarked`;
}

function renderReports() {
  const summary = document.getElementById('reportSummary');
  const table = document.getElementById('reportTable');

  if (!state.sessions.length || !state.students.length) {
    summary.innerHTML = emptyBox('No data yet.', 'Add students and events, then mark some attendance.');
    table.innerHTML = '';
    return;
  }

  summary.innerHTML = state.sessions.map(s => {
    const total = state.students.length;
    const present = s.present || 0;
    const pct = Math.round((present / total) * 100);
    const cls = pct >= 75 ? '' : pct >= 40 ? 'mid' : 'low';
    const win = sessionWindow(s);
    const times = win ? ` · ${fmtTime(win.start)}–${fmtTime(win.end)}` : '';
    return `
      <div class="rep-row">
        <div><div class="rep-title">${esc(s.title)}</div><div class="rep-date">${esc(fmtDate(s.date))}${times} · ${present}/${total} present</div></div>
        <span class="rep-pct">${pct}%</span>
        <div class="progress"><div class="${cls}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  get('/api/report').then(report => {
    const rows = report.students.map(st => {
      const total = st.sessions;
      const pct = total ? Math.round((st.present / total) * 100) : 0;
      const pill = pct >= 75 ? 'pill-good' : pct >= 40 ? 'pill-warn' : 'pill-bad';
      const label = pct >= 75 ? 'good' : pct >= 40 ? 'warning' : 'low';
      return `
        <tr>
          <td>
            <div class="cell-main">
              <span class="avatar" style="background:${avatarColor(st.name)}">${initials(st.name)}</span>
              <strong>${esc(st.name)}</strong>
            </div>
          </td>
          <td>${st.present}</td>
          <td>${st.absent}</td>
          <td>${st.unmarked}</td>
          <td><span class="pill ${pill}">${pct}% · ${label}</span></td>
        </tr>`;
    }).join('');
    table.innerHTML = `<table>
      <thead><tr><th>Student</th><th>Present</th><th>Absent</th><th>Unmarked</th><th>Rate</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  });
}

// ---------- student CRUD ----------
document.getElementById('studentForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('studentId').value;
  const studentId = document.getElementById('studentScanId').value.trim();
  const name = document.getElementById('studentName').value.trim();
  const email = document.getElementById('studentEmail').value.trim();
  if (!name || !studentId) return;
  try {
    if (id) {
      await put(`/api/students/${id}`, { studentId, name, email });
      toast('Student updated');
    } else {
      await post('/api/students', { studentId, name, email });
      toast('Student added');
    }
    resetStudentForm();
    await loadAll();
  } catch (err) { toast(err.message); }
});

function editStudent(id) {
  const s = state.students.find(x => x.id === id);
  if (!s) return;
  document.getElementById('studentId').value = s.id;
  document.getElementById('studentScanId').value = s.studentId;
  document.getElementById('studentName').value = s.name;
  document.getElementById('studentEmail').value = s.email;
  document.getElementById('studentFormTitle').textContent = 'Edit student';
  document.getElementById('studentSubmitBtn').textContent = 'Save changes';
  document.getElementById('cancelStudentBtn').style.display = '';
  document.getElementById('studentScanId').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetStudentForm() {
  document.getElementById('studentForm').reset();
  document.getElementById('studentId').value = '';
  document.getElementById('studentFormTitle').textContent = 'Add student';
  document.getElementById('studentSubmitBtn').textContent = 'Add student';
  document.getElementById('cancelStudentBtn').style.display = 'none';
}

function askDeleteStudent(id) {
  const s = state.students.find(x => x.id === id);
  openModal('Delete student?', `"${s ? s.name : 'This student'}" and all their attendance records will be deleted.`, async () => {
    await del(`/api/students/${id}`);
    toast('Student removed');
    await loadAll();
  });
}

// ---------- session CRUD ----------
document.getElementById('sessionForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('sessionId').value;
  const title = document.getElementById('sessionTitle').value.trim();
  const date = document.getElementById('sessionDate').value;
  const startTime = document.getElementById('sessionStart').value;
  const endTime = document.getElementById('sessionEnd').value;
  const notes = document.getElementById('sessionNotes').value.trim();
  if (!title || !date || !startTime || !endTime) return;
  try {
    if (id) {
      await put(`/api/sessions/${id}`, { title, date, startTime, endTime, notes });
      toast('Event updated');
    } else {
      await post('/api/sessions', { title, date, startTime, endTime, notes });
      toast('Event added');
    }
    resetSessionForm();
    await loadAll();
  } catch (err) { toast(err.message); }
});

function editSession(id) {
  const s = state.sessions.find(x => x.id === id);
  if (!s) return;
  document.getElementById('sessionId').value = s.id;
  document.getElementById('sessionTitle').value = s.title;
  document.getElementById('sessionDate').value = s.date;
  document.getElementById('sessionStart').value = s.startTime || '';
  document.getElementById('sessionEnd').value = s.endTime || '';
  document.getElementById('sessionNotes').value = s.notes || '';
  document.getElementById('sessionFormTitle').textContent = 'Edit event';
  document.getElementById('sessionSubmitBtn').textContent = 'Save changes';
  document.getElementById('cancelSessionBtn').style.display = '';
  document.getElementById('sessionTitle').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetSessionForm() {
  document.getElementById('sessionForm').reset();
  document.getElementById('sessionId').value = '';
  document.getElementById('sessionFormTitle').textContent = 'Add event';
  document.getElementById('sessionSubmitBtn').textContent = 'Add event';
  document.getElementById('cancelSessionBtn').style.display = 'none';
}

function askDeleteSession(id) {
  const s = state.sessions.find(x => x.id === id);
  openModal('Delete event?', `"${s ? s.title : 'This event'}" and its attendance records will be removed.`, async () => {
    await del(`/api/sessions/${id}`);
    toast('Event deleted');
    await loadAll();
  });
}

// ---------- scanner ----------
document.getElementById('scanForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('scanInput');
  const scanId = input.value.trim();
  if (!scanId || !state.currentSession) return;
  if (scanId === state.lastScanId) {
    setFeedback('Please wait a moment — duplicate scan detected', 'err');
    input.value = '';
    input.focus();
    return;
  }
  state.lastScanId = scanId;
  setFeedback(`Checking ID ${scanId}…`, '');
  try {
    const r = await post(`/api/sessions/${state.currentSession}/scan`, { scanId });
    setFeedback(`${r.student.name} checked in at ${fmtTime(r.time)}`, 'ok');
    await loadAll();
  } catch (err) {
    state.lastScanId = '';
    setFeedback(err.message, 'err');
  }
  input.value = '';
  input.focus();
});

function setFeedback(msg, kind) {
  const box = document.getElementById('scanFeedback');
  box.className = 'scan-feedback' + (kind ? ' ' + kind : '');
  box.innerHTML = `<span class="scan-feedback-text">${esc(msg)}</span>`;
  void box.offsetWidth;
  box.classList.add('flash');
}

function updateScannerStatus() {
  const now = new Date();
  document.getElementById('liveClock').textContent =
    now.toLocaleTimeString([], { hour12: false });

  const s = state.sessions.find(x => x.id === state.currentSession);
  const badge = document.getElementById('windowBadge');
  const winTime = document.getElementById('windowTime');
  const input = document.getElementById('scanInput');
  const submit = document.querySelector('#scanForm .btn');

  if (!s) {
    badge.textContent = 'Select an event';
    badge.className = 'pill pill-warn';
    winTime.textContent = '';
    input.disabled = true; submit.disabled = true;
    return;
  }

  const win = sessionWindow(s);
  if (!win) {
    badge.textContent = 'No time set';
    badge.className = 'pill pill-warn';
    winTime.textContent = '';
    input.disabled = true; submit.disabled = true;
    return;
  }

  winTime.textContent = `${fmtTime(win.start)} – ${fmtTime(win.end)}`;
  if (now < win.start) {
    badge.textContent = `Opens ${fmtTime(win.start)}`;
    badge.className = 'pill pill-warn';
    input.disabled = true; submit.disabled = true;
  } else if (now > win.end) {
    badge.textContent = 'Closed';
    badge.className = 'pill pill-bad';
    input.disabled = true; submit.disabled = true;
  } else {
    badge.textContent = 'Open — scanning';
    badge.className = 'pill pill-good';
    input.disabled = false; submit.disabled = false;
  }
}
setInterval(updateScannerStatus, 1000);

// ---------- manual corrections ----------
async function mark(studentId, value) {
  if (!state.currentSession) { toast('Pick an event first'); return; }
  state.attendance[studentId] = { status: value, scannedAt: value === 'present' ? (state.attendance[studentId] || {}).scannedAt : null };
  renderSheet();
  try {
    const entries = Object.entries(state.attendance).map(([k, v]) => ({ studentId: k, status: v.status }));
    await put(`/api/sessions/${state.currentSession}/attendance`, entries);
    await loadAll();
  } catch (err) {
    toast(err.message);
    await loadAttendanceSheet();
  }
}

async function bulkMark(value) {
  if (!state.currentSession) { toast('Pick an event first'); return; }
  state.students.forEach(s => { state.attendance[s.id] = { status: value, scannedAt: null }; });
  renderSheet();
  try {
    const entries = Object.entries(state.attendance).map(([k, v]) => ({ studentId: k, status: v.status }));
    await put(`/api/sessions/${state.currentSession}/attendance`, entries);
    await loadAll();
    toast(value === 'present' ? 'All students marked present' : 'All marks reset');
  } catch (err) { toast(err.message); }
}

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'tab-' + name));
  if (name === 'reports') renderReports();
  if (name === 'attendance') {
    updateScannerStatus();
    const input = document.getElementById('scanInput');
    if (!input.disabled) input.focus();
  }
}

// ---------- backup / restore / reset ----------
async function exportData() {
  const data = await get('/api/backup');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'attendance-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup downloaded');
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.students) || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.attendance)) {
      throw new Error('bad shape');
    }
    openModal('Restore backup?', 'Current data will be replaced by the backup. No undo for this one.', async () => {
      await post('/api/import', parsed);
      toast('Backup restored');
      await loadAll();
    });
  } catch (err) {
    toast('Invalid backup file');
  }
  e.target.value = '';
}

function confirmReset() {
  openModal('Delete all data?', 'All students, events and records will be permanently deleted.', async () => {
    await post('/api/reset', {});
    toast('All data deleted');
    await loadAll();
  });
}

// ---------- modal / toast ----------
function openModal(title, message, onConfirm) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  document.getElementById('modal').classList.add('show');
  document.getElementById('modalConfirm').onclick = () => { closeModal(); onConfirm(); };
}
function closeModal() { document.getElementById('modal').classList.remove('show'); }

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- hero stats ----------
function updateHero() {
  document.getElementById('statStudents').textContent = state.students.length;
  document.getElementById('statSessions').textContent = state.sessions.length;
  const now = new Date();
  document.getElementById('heroKicker').textContent =
    now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  get('/api/report').then(r => {
    const totalMarks = r.students.reduce((a, s) => a + s.present + s.absent, 0);
    const present = r.students.reduce((a, s) => a + s.present, 0);
    const pct = totalMarks ? Math.round((present / totalMarks) * 100) : 0;
    document.getElementById('statRate').textContent = pct + '%';
  }).catch(() => {});
}

// ---------- helpers ----------
function emptyBox(title, sub) {
  return `<div class="empty"><b>${esc(title)}</b><br>${esc(sub)}</div>`;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

function avatarColor(name) {
  const palette = ['#c6f04e', '#8b5cf6', '#ff5d5d', '#2dd4bf', '#fbbf24', '#60a5fa', '#f472b6', '#a3e635'];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return isNaN(d) ? dateStr : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(t) {
  if (t == null || t === '') return '';
  const d = t instanceof Date ? t : new Date(typeof t === 'number' ? t : t);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

loadAll().catch(err => toast('Could not reach the server: ' + err.message));
