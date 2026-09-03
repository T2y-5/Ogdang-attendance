const state = {
  courses: [],
  students: [],
  sessions: [],
  attendance: {},   // { studentId: { status, scannedAt, excuse } }
  activeTab: 'courses',
  currentSession: '',
  lastScanId: '',
  chartInstance: null,
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

// ---------- color picker logic ----------
document.querySelectorAll('#colorPickerRow .color-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    document.querySelectorAll('#colorPickerRow .color-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    document.getElementById('courseColor').value = dot.dataset.color;
  });
});

// ---------- data loading ----------
async function loadAll() {
  const [courses, students, sessions] = await Promise.all([
    get('/api/courses'),
    get('/api/students'),
    get('/api/sessions')
  ]);
  state.courses = courses;
  state.students = students;
  state.sessions = sessions;

  // Populate course dropdown in session form
  const courseSel = document.getElementById('sessionCourse');
  if (courseSel) {
    const curVal = courseSel.value;
    courseSel.innerHTML = '<option value="">General Event (No course)</option>' +
      courses.map(c => `<option value="${c.id}">${esc(c.code)} — ${esc(c.name)}</option>`).join('');
    courseSel.value = curVal;
  }

  // Populate session dropdown in scanner
  const sheet = document.getElementById('attendanceSessionSelect');
  sheet.innerHTML = sessions.map(s => {
    const win = sessionWindow(s);
    const times = win ? `${fmtTime(win.start)} – ${fmtTime(win.end)}` : '';
    const prefix = s.courseCode ? `[${s.courseCode}] ` : '';
    return `<option value="${s.id}">${prefix}${fmtDate(s.date)} · ${times} — ${esc(s.title)}</option>`;
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
  rows.forEach(r => {
    state.attendance[r.studentId] = { status: r.status, scannedAt: r.scannedAt, excuse: r.excuse || '' };
  });
  renderSheet();
  updateScannerStatus();
}

// ---------- rendering ----------
function renderAll() {
  renderCourses();
  renderStudentCourseSelect();
  renderStudents();
  renderSessions();
  renderReports();
}

// ---------- COURSES CRUD & RENDER ----------
function renderCourses() {
  document.getElementById('courseCount').textContent = state.courses.length;
  const wrap = document.getElementById('courseList');
  if (!state.courses.length) {
    wrap.innerHTML = emptyBox('No courses yet.', 'Create your first course to organize students and events.');
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>Code</th><th>Course Name</th><th>Enrolled</th><th>Sessions</th><th></th></tr></thead>
    <tbody>${state.courses.map(c => `
      <tr>
        <td>
          <span class="course-badge" style="background:${c.color || '#8b5cf6'}">${esc(c.code)}</span>
        </td>
        <td>
          <strong>${esc(c.name)}</strong>
          ${c.description ? `<div class="meta">${esc(c.description)}</div>` : ''}
        </td>
        <td>${c.studentCount || 0} students</td>
        <td>${c.sessionCount || 0} sessions</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="editCourse('${c.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="askDeleteCourse('${c.id}')">Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table>`;
}

document.getElementById('courseForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('courseId').value;
  const code = document.getElementById('courseCode').value.trim();
  const name = document.getElementById('courseName').value.trim();
  const description = document.getElementById('courseDescription').value.trim();
  const color = document.getElementById('courseColor').value;
  if (!code || !name) return;
  try {
    if (id) {
      await put(`/api/courses/${id}`, { code, name, description, color });
      toast('Course updated');
    } else {
      await post('/api/courses', { code, name, description, color });
      toast('Course added');
    }
    resetCourseForm();
    await loadAll();
  } catch (err) { toast(err.message); }
});

function editCourse(id) {
  const c = state.courses.find(x => x.id === id);
  if (!c) return;
  document.getElementById('courseId').value = c.id;
  document.getElementById('courseCode').value = c.code;
  document.getElementById('courseName').value = c.name;
  document.getElementById('courseDescription').value = c.description || '';
  document.getElementById('courseColor').value = c.color || '#8b5cf6';

  document.querySelectorAll('#colorPickerRow .color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color === c.color);
  });

  document.getElementById('courseFormTitle').textContent = 'Edit Course';
  document.getElementById('courseSubmitBtn').textContent = 'Save changes';
  document.getElementById('cancelCourseBtn').style.display = '';
  document.getElementById('courseCode').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetCourseForm() {
  document.getElementById('courseForm').reset();
  document.getElementById('courseId').value = '';
  document.getElementById('courseColor').value = '#8b5cf6';
  document.querySelectorAll('#colorPickerRow .color-dot').forEach((dot, idx) => {
    dot.classList.toggle('active', idx === 0);
  });
  document.getElementById('courseFormTitle').textContent = 'Add Course';
  document.getElementById('courseSubmitBtn').textContent = 'Add Course';
  document.getElementById('cancelCourseBtn').style.display = 'none';
}

function askDeleteCourse(id) {
  const c = state.courses.find(x => x.id === id);
  openModal('Delete course?', `"${c ? c.code + ' - ' + c.name : 'This course'}" will be removed.`, async () => {
    await del(`/api/courses/${id}`);
    toast('Course deleted');
    await loadAll();
  });
}

// ---------- REAL-TIME DIGITAL CLOCK (12H / 24H) ----------
state.clock24h = false;

function updateTopClock() {
  const clockTimeEl = document.getElementById('clockTime');
  const clockModeEl = document.getElementById('clockMode');
  if (!clockTimeEl) return;

  const now = new Date();
  let hrs = now.getHours();
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');

  if (state.clock24h) {
    clockTimeEl.textContent = `${String(hrs).padStart(2, '0')}:${mins}:${secs}`;
    if (clockModeEl) clockModeEl.textContent = '24H';
  } else {
    const ampm = hrs >= 12 ? 'PM' : 'AM';
    hrs = hrs % 12 || 12;
    clockTimeEl.textContent = `${String(hrs).padStart(2, '0')}:${mins}:${secs} ${ampm}`;
    if (clockModeEl) clockModeEl.textContent = '12H';
  }
}

function toggleClockFormat() {
  state.clock24h = !state.clock24h;
  updateTopClock();
  updateScannerStatus();
  toast(`Clock switched to ${state.clock24h ? '24-hour' : '12-hour AM/PM'} format`);
}
setInterval(updateTopClock, 1000);
document.addEventListener('DOMContentLoaded', updateTopClock);

// ---------- STUDENTS CRUD & RENDER ----------
function renderStudentCourseSelect(selectedCourseId = '') {
  const select = document.getElementById('studentCourseSelect');
  if (!select) return;
  if (!state.courses.length) {
    select.innerHTML = '<option value="">-- No Courses Created Yet --</option>';
    return;
  }
  const options = state.courses.map(c => {
    const sel = c.id === selectedCourseId ? 'selected' : '';
    return `<option value="${c.id}" ${sel}>${esc(c.code)} - ${esc(c.name)}</option>`;
  }).join('');
  select.innerHTML = `<option value="">-- No Course Enrolled --</option>${options}`;
}

function renderStudents() {
  const q = (document.getElementById('studentSearch')?.value || '').toLowerCase().trim();
  const filtered = state.students.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.studentId.toLowerCase().includes(q) ||
    (s.email || '').toLowerCase().includes(q) ||
    (s.yearLevel || '').toLowerCase().includes(q) ||
    (s.role || '').toLowerCase().includes(q)
  );

  document.getElementById('studentCount').textContent = filtered.length;
  const wrap = document.getElementById('studentList');
  if (!filtered.length) {
    wrap.innerHTML = emptyBox(q ? 'No matching students.' : 'No students yet.', q ? 'Try adjusting your search query.' : 'Add your first student to get started.');
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>Name, Role & Year</th><th>Student ID</th><th>Enrolled Course (Recent & History)</th><th></th></tr></thead>
    <tbody>${filtered.map(s => {
      const coursesList = s.courses || [];
      const courseBadges = coursesList.map((c, idx) => {
        const isRecent = idx === 0;
        const tag = (isRecent && coursesList.length > 1) ? '<span class="recent-tag">Active</span> ' : '';
        const shiftedClass = !isRecent ? ' shifted' : '';
        const titleText = isRecent ? 'Current Enrolled Course' : 'Shifted / Previous Course';
        return `<span class="course-badge${shiftedClass}" style="background:${c.color}" title="${titleText}">${tag}${esc(c.code)}</span>`;
      }).join(' ') || '<span class="meta" style="color:#9ca3af; font-style:italic;">None</span>';

      const roleClass = (s.role || 'Student').toLowerCase();
      const roleTag = (s.role && s.role !== 'Student')
        ? `<span class="role-chip ${roleClass}">${esc(s.role)}</span>`
        : '';

      return `
      <tr>
        <td>
          <div class="cell-main">
            <span class="avatar" style="background:${avatarColor(s.name)}">${initials(s.name)}</span>
            <div>
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <strong>${esc(s.name)}</strong>
                <span class="year-pill">${esc(s.yearLevel || '1st Year')}</span>
                ${roleTag}
              </div>
              ${s.email ? `<div class="meta" style="margin-top:2px;">${esc(s.email)}</div>` : ''}
            </div>
          </div>
        </td>
        <td><span class="mono" style="font-weight:600; color:#374151;">${esc(s.studentId) || '—'}</span></td>
        <td>${courseBadges}</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="editStudent('${s.id}')">Edit / Enroll</button>
          <button class="btn btn-danger btn-sm" onclick="askDeleteStudent('${s.id}')">Delete</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function toggleEnrollModal(studentId) {
  editStudent(studentId);
}

document.getElementById('studentForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('studentId').value;
  const studentId = document.getElementById('studentScanId').value.trim();
  const name = document.getElementById('studentName').value.trim();
  const email = document.getElementById('studentEmail').value.trim();
  const yearLevel = document.getElementById('studentYear').value;
  const role = document.getElementById('studentRole').value;
  
  const courseId = document.getElementById('studentCourseSelect')?.value;
  const courses = courseId ? [courseId] : [];

  if (!name || !studentId) return;
  try {
    if (id) {
      await put(`/api/students/${id}`, { studentId, name, email, yearLevel, role, courses });
      toast('Student updated & course assigned');
    } else {
      await post('/api/students', { studentId, name, email, yearLevel, role, courses });
      toast('Student added & course assigned');
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
  if (document.getElementById('studentYear')) document.getElementById('studentYear').value = s.yearLevel || '1st Year';
  if (document.getElementById('studentRole')) document.getElementById('studentRole').value = s.role || 'Student';
  
  const recentCourse = (s.courses || [])[0];
  renderStudentCourseSelect(recentCourse ? recentCourse.id : '');

  document.getElementById('studentFormTitle').textContent = 'Edit student & course';
  document.getElementById('studentSubmitBtn').textContent = 'Save changes';
  document.getElementById('cancelStudentBtn').style.display = '';
  document.getElementById('studentScanId').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetStudentForm() {
  document.getElementById('studentForm').reset();
  document.getElementById('studentId').value = '';
  if (document.getElementById('studentYear')) document.getElementById('studentYear').value = '1st Year';
  if (document.getElementById('studentRole')) document.getElementById('studentRole').value = 'Student';
  renderStudentCourseSelect('');
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

// ---------- SESSIONS CRUD & RENDER ----------
function renderSessions() {
  const q = (document.getElementById('sessionSearch')?.value || '').toLowerCase().trim();
  const filtered = state.sessions.filter(s =>
    s.title.toLowerCase().includes(q) || (s.courseCode || '').toLowerCase().includes(q) || (s.room || '').toLowerCase().includes(q)
  );

  document.getElementById('sessionCount').textContent = filtered.length;
  const wrap = document.getElementById('sessionList');
  if (!filtered.length) {
    wrap.innerHTML = emptyBox(q ? 'No matching events.' : 'No events yet.', q ? 'Try adjusting your search query.' : 'Add one to start taking attendance.');
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>Date</th><th>Event</th><th>Course / Room</th><th>Attendance</th><th></th></tr></thead>
    <tbody>${filtered.map(s => {
      const win = sessionWindow(s);
      const total = state.students.length;
      const present = s.present || 0;
      const late = s.late || 0;
      const pct = total ? Math.round((present / total) * 100) : 0;
      const courseBadge = s.courseCode ? `<span class="course-badge" style="background:${s.courseColor || '#8b5cf6'}">${esc(s.courseCode)}</span>` : '<span class="meta">—</span>';
      
      const exemptRolesList = s.exemptRoles || [];
      const exemptBadge = exemptRolesList.length > 0
        ? `<div style="margin-top:4px;"><span class="role-chip" style="background:#f3e8ff; color:#7e22ce; font-size:0.68rem; padding:1px 6px;">Exempts: ${esc(exemptRolesList.join(', '))}</span></div>`
        : '';

      return `
      <tr>
        <td>
          <span class="session-date">${esc(fmtDate(s.date))}</span>
          ${win ? `<div class="session-notes">${fmtTime(win.start)} – ${fmtTime(win.end)}</div>` : ''}
        </td>
        <td>
          <strong>${esc(s.title)}</strong>
          ${exemptBadge}
          ${s.notes ? `<div class="session-notes">${esc(s.notes)}</div>` : ''}
        </td>
        <td>
          <div>${courseBadge}</div>
          ${s.room ? `<div class="meta" style="margin-top:2px;">📍 ${esc(s.room)}</div>` : ''}
        </td>
        <td>
          ${total ? `${present}/${total} (${pct}%)` : '—'}
          ${late ? `<div class="meta" style="color:#d97706;">${late} late</div>` : ''}
        </td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="editSession('${s.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="askDeleteSession('${s.id}')">Delete</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

document.getElementById('sessionForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('sessionId').value;
  const courseId = document.getElementById('sessionCourse').value;
  const title = document.getElementById('sessionTitle').value.trim();
  const date = document.getElementById('sessionDate').value;
  const startTime = document.getElementById('sessionStart').value;
  const endTime = document.getElementById('sessionEnd').value;
  const room = document.getElementById('sessionRoom').value.trim();
  const notes = document.getElementById('sessionNotes').value.trim();

  const exemptCheckboxes = document.querySelectorAll('input[name="exemptRoles"]:checked');
  const exemptRoles = Array.from(exemptCheckboxes).map(cb => cb.value);

  if (!title || !date || !startTime || !endTime) return;
  try {
    if (id) {
      await put(`/api/sessions/${id}`, { courseId, title, date, startTime, endTime, room, notes, exemptRoles });
      toast('Event updated');
    } else {
      await post('/api/sessions', { courseId, title, date, startTime, endTime, room, notes, exemptRoles });
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
  document.getElementById('sessionCourse').value = s.courseId || '';
  document.getElementById('sessionTitle').value = s.title;
  document.getElementById('sessionDate').value = s.date;
  document.getElementById('sessionStart').value = s.startTime || '';
  document.getElementById('sessionEnd').value = s.endTime || '';
  document.getElementById('sessionRoom').value = s.room || '';
  document.getElementById('sessionNotes').value = s.notes || '';
  
  const exemptRoles = s.exemptRoles || [];
  document.querySelectorAll('input[name="exemptRoles"]').forEach(cb => {
    cb.checked = exemptRoles.includes(cb.value);
  });

  document.getElementById('sessionFormTitle').textContent = 'Edit event';
  document.getElementById('sessionSubmitBtn').textContent = 'Save changes';
  document.getElementById('cancelSessionBtn').style.display = '';
  document.getElementById('sessionTitle').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetSessionForm() {
  document.getElementById('sessionForm').reset();
  document.getElementById('sessionId').value = '';
  document.getElementById('sessionCourse').value = '';
  document.querySelectorAll('input[name="exemptRoles"]').forEach(cb => cb.checked = false);
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

// ---------- SCANNER & ROSTER ----------
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
    const lateText = r.status === 'late' ? ' (LATE)' : '';
    setFeedback(`${r.student.name} checked in at ${fmtTime(r.time)}${lateText}`, r.status === 'late' ? 'err' : 'ok');
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
  const scannerClock = document.getElementById('scannerLiveClock');
  if (scannerClock) {
    scannerClock.textContent = state.clock24h
      ? now.toLocaleTimeString([], { hour12: false })
      : now.toLocaleTimeString([], { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

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

function renderSheet() {
  const wrap = document.getElementById('attendanceSheet');
  if (!state.currentSession || !state.students.length) {
    wrap.innerHTML = emptyBox('Nothing to mark yet.', state.students.length ? 'Pick an event from the dropdown.' : 'Add students first.');
    setMiniCounts(0, 0, 0, 0, 0);
    return;
  }

  const currSession = state.sessions.find(x => x.id === state.currentSession);
  const autoExemptRoles = (currSession && currSession.exemptRoles) || [];

  let present = 0, late = 0, exempted = 0, absent = 0, unmarked = 0;
  const rows = state.students.map(s => {
    const rec = state.attendance[s.id] || {};
    let v = rec.status || 'unmarked';
    let excuse = rec.excuse || '';
    
    // Check auto-exemption rule if student has not been manually marked or scanned
    const isAutoExempted = v === 'unmarked' && s.role && autoExemptRoles.includes(s.role);
    if (isAutoExempted) {
      v = 'exempted';
      if (!excuse) excuse = `Auto-exempted (${s.role})`;
    }

    if (v === 'present') present++;
    else if (v === 'late') late++;
    else if (v === 'exempted') exempted++;
    else if (v === 'absent') absent++;
    else unmarked++;
    
    const meta = (v === 'present' || v === 'late') && rec.scannedAt
      ? `<span class="scan-meta">checked in ${fmtTime(rec.scannedAt)}</span>`
      : (isAutoExempted ? `<span class="scan-meta" style="color:#7e22ce; font-weight:600;">✨ Auto-Exempted (${esc(s.role)})</span>` : '');

    const roleClass = (s.role || 'Student').toLowerCase();
    const roleTag = s.role && s.role !== 'Student'
      ? `<span class="role-chip ${roleClass}" style="font-size:0.68rem; padding:1px 5px;">${esc(s.role)}</span>`
      : '';
    
    return `
      <tr>
        <td>
          <div class="cell-main">
            <span class="avatar" style="background:${avatarColor(s.name)}">${initials(s.name)}</span>
            <div>
              <strong>${esc(s.name)}</strong>
              <span class="year-pill" style="font-size:0.7rem; padding:1px 5px;">${esc(s.yearLevel || '1st Year')}</span>
              ${roleTag}
              <div class="scan-meta">ID ${esc(s.studentId)}</div>
            </div>
          </div>
        </td>
        <td style="min-width:320px">
          <div class="seg">
            <button data-v="present" class="${v === 'present' ? 'on' : ''}" onclick="mark('${s.id}', 'present')">Present</button>
            <button data-v="late" class="${v === 'late' ? 'on' : ''}" onclick="mark('${s.id}', 'late')">Late</button>
            <button data-v="exempted" class="btn-exempt ${v === 'exempted' ? 'on active' : ''}" onclick="mark('${s.id}', 'exempted')">Exempted</button>
            <button data-v="absent" class="${v === 'absent' ? 'on' : ''}" onclick="mark('${s.id}', 'absent')">Absent</button>
            <button data-v="unmarked" class="${v === 'unmarked' ? 'on' : ''}" onclick="mark('${s.id}', 'unmarked')">Unmark</button>
          </div>
          ${meta}
        </td>
        <td>
          <input type="text" class="excuse-input" placeholder="${s.role === 'Athlete' ? 'e.g. Sports competition (Exempt)' : 'Add excuse...'}" value="${esc(excuse)}"
            onblur="updateExcuse('${s.id}', this.value)">
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `<table><thead><tr><th>Student</th><th>Status</th><th>Excuse / Exemption Note</th></tr></thead><tbody>${rows}</tbody></table>`;
  setMiniCounts(state.students.length, present, late, exempted, absent);
}

function setMiniCounts(total, present, late, exempted, absent) {
  document.getElementById('miniPresent').textContent = `${present} present`;
  document.getElementById('miniLate').textContent = `${late} late`;
  if (document.getElementById('miniExempted')) document.getElementById('miniExempted').textContent = `${exempted} exempted`;
  document.getElementById('miniAbsent').textContent = `${absent} absent`;
  document.getElementById('miniUnmarked').textContent = `${Math.max(total - present - late - exempted - absent, 0)} unmarked`;
}

async function mark(studentId, value) {
  if (!state.currentSession) { toast('Pick an event first'); return; }
  const current = state.attendance[studentId] || {};
  state.attendance[studentId] = {
    ...current,
    status: value,
    scannedAt: (value === 'present' || value === 'late') ? current.scannedAt : null
  };
  renderSheet();
  try {
    const entries = Object.entries(state.attendance).map(([k, v]) => ({ studentId: k, status: v.status, excuse: v.excuse }));
    await put(`/api/sessions/${state.currentSession}/attendance`, entries);
    await loadAll();
  } catch (err) {
    toast(err.message);
    await loadAttendanceSheet();
  }
}

async function updateExcuse(studentId, excuseVal) {
  if (!state.currentSession) return;
  const current = state.attendance[studentId] || { status: 'unmarked' };
  if (current.excuse === excuseVal) return;
  state.attendance[studentId] = { ...current, excuse: excuseVal };
  try {
    const entries = Object.entries(state.attendance).map(([k, v]) => ({ studentId: k, status: v.status, excuse: v.excuse }));
    await put(`/api/sessions/${state.currentSession}/attendance`, entries);
    toast('Excuse saved');
  } catch (err) { toast(err.message); }
}

async function bulkMark(value) {
  if (!state.currentSession) { toast('Pick an event first'); return; }
  state.students.forEach(s => {
    const cur = state.attendance[s.id] || {};
    state.attendance[s.id] = { status: value, scannedAt: null, excuse: cur.excuse || '' };
  });
  renderSheet();
  try {
    const entries = Object.entries(state.attendance).map(([k, v]) => ({ studentId: k, status: v.status, excuse: v.excuse }));
    await put(`/api/sessions/${state.currentSession}/attendance`, entries);
    await loadAll();
    toast(value === 'present' ? 'All students marked present' : 'All marks reset');
  } catch (err) { toast(err.message); }
}

function downloadCSV() {
  if (!state.currentSession) { toast('Pick an event first'); return; }
  window.location.href = `/api/sessions/${state.currentSession}/csv`;
}

// ---------- REPORTS & ANALYTICS ----------
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
    const present = (s.present || 0);
    const late = (s.late || 0);
    const pct = Math.round((present / total) * 100);
    const cls = pct >= 75 ? '' : pct >= 40 ? 'mid' : 'low';
    const win = sessionWindow(s);
    const times = win ? ` · ${fmtTime(win.start)}–${fmtTime(win.end)}` : '';
    const courseInfo = s.courseCode ? `[${s.courseCode}] ` : '';
    return `
      <div class="rep-row">
        <div>
          <div class="rep-title">${esc(courseInfo)}${esc(s.title)}</div>
          <div class="rep-date">${esc(fmtDate(s.date))}${times} · ${present}/${total} present (${late} late)</div>
        </div>
        <span class="rep-pct">${pct}%</span>
        <div class="progress"><div class="${cls}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  get('/api/report').then(report => {
    // Render Stat Cards Metrics
    let totalPresent = 0, totalLate = 0, totalExempted = 0;
    (report.sessions || []).forEach(s => {
      totalPresent += (s.present || 0);
      totalLate += (s.late || 0);
    });
    const totalCheckins = totalPresent + totalLate;
    const punctuality = totalCheckins ? Math.round((totalPresent / totalCheckins) * 100) : 100;

    // Count exemptions across students
    (report.students || []).forEach(st => {
      totalExempted += (st.exempted || 0);
    });

    if (document.getElementById('repStatCheckins')) document.getElementById('repStatCheckins').textContent = totalCheckins;
    if (document.getElementById('repStatPunctuality')) document.getElementById('repStatPunctuality').textContent = `${punctuality}%`;
    if (document.getElementById('repStatExemptions')) document.getElementById('repStatExemptions').textContent = totalExempted;

    // Render Charts
    renderAnalyticsChart(report.sessions);
    renderCoursePieChart(report.sessions);
    renderYearChart();

    const rows = report.students.map(st => {
      const total = st.sessions;
      const pct = total ? Math.round(((st.present + st.late) / total) * 100) : 0;
      const pill = pct >= 75 ? 'pill-good' : pct >= 40 ? 'pill-warn' : 'pill-bad';
      const label = pct >= 75 ? 'good' : pct >= 40 ? 'warning' : 'low';
      return `
        <tr>
          <td>
            <div class="cell-main">
              <span class="avatar" style="background:${avatarColor(st.name)}">${initials(st.name)}</span>
              <div>
                <strong>${esc(st.name)}</strong>
                <span class="scan-meta">ID ${esc(st.studentId)}</span>
              </div>
            </div>
          </td>
          <td>${st.present}</td>
          <td><span style="color:#d97706">${st.late}</span></td>
          <td>${st.absent}</td>
          <td>${st.unmarked}</td>
          <td><span class="pill ${pill}">${pct}% · ${label}</span></td>
        </tr>`;
    }).join('');
    table.innerHTML = `<table>
      <thead><tr><th>Student</th><th>Present</th><th>Late</th><th>Absent</th><th>Unmarked</th><th>Rate</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  });
}

function renderAnalyticsChart(sessionsData) {
  const ctx = document.getElementById('attendanceChart')?.getContext('2d');
  if (!ctx) return;

  if (state.chartInstance) {
    state.chartInstance.destroy();
  }

  const labels = sessionsData.map(s => (s.courseCode ? `[${s.courseCode}] ` : '') + s.title);
  const presentData = sessionsData.map(s => s.present);
  const lateData = sessionsData.map(s => s.late);
  const absentData = sessionsData.map(s => s.absent);

  state.chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Present', data: presentData, backgroundColor: '#10b981' },
        { label: 'Late', data: lateData, backgroundColor: '#f59e0b' },
        { label: 'Absent', data: absentData, backgroundColor: '#ef4444' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }
      },
      plugins: {
        legend: { position: 'top' }
      }
    }
  });
}

function renderCoursePieChart(sessionsData) {
  const ctx = document.getElementById('coursePieChart')?.getContext('2d');
  if (!ctx) return;

  if (state.coursePieInstance) {
    state.coursePieInstance.destroy();
  }

  // Aggregate check-ins STRICTLY for registered Courses (ignore General Events without a course)
  const courseCounts = {};
  const courseColors = {};

  // Pre-fill registered courses
  state.courses.forEach(c => {
    courseCounts[c.code] = 0;
    courseColors[c.code] = c.color || '#8b5cf6';
  });

  // Accumulate attendance from sessions associated with a course
  sessionsData.forEach(s => {
    if (!s.courseCode) return; // Skip general events (not a course)
    const label = s.courseCode;
    const color = s.courseColor || '#8b5cf6';
    const attended = (s.present || 0) + (s.late || 0);

    courseCounts[label] = (courseCounts[label] || 0) + attended;
    courseColors[label] = color;
  });

  // Calculate top attending course name for metric tile
  let topCourseName = '—';
  let topCount = -1;
  Object.entries(courseCounts).forEach(([name, count]) => {
    if (count > topCount && count > 0) { topCount = count; topCourseName = name; }
  });
  if (document.getElementById('repStatTopCourse')) {
    document.getElementById('repStatTopCourse').textContent = topCourseName !== '—' ? topCourseName : 'None';
  }

  const labels = Object.keys(courseCounts);
  const data = Object.values(courseCounts);

  // If no check-ins recorded yet for courses, show enrolled student counts per course
  const hasData = data.some(v => v > 0);
  if (!hasData) {
    state.courses.forEach(c => {
      const label = c.code;
      const count = state.students.filter(st => (st.courses || []).some(crs => crs.id === c.id)).length;
      courseCounts[label] = count;
      courseColors[label] = c.color || '#8b5cf6';
    });
  }

  const chartLabels = Object.keys(courseCounts);
  const chartData = Object.values(courseCounts);
  const bgColors = chartLabels.map(l => courseColors[l] || '#8b5cf6');

  state.coursePieInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: chartLabels.length ? chartLabels : ['No Courses Created'],
      datasets: [{
        data: chartData.length ? chartData : [1],
        backgroundColor: chartLabels.length ? bgColors : ['#e5e7eb'],
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.raw || 0;
              return ` ${context.label}: ${val} check-in(s)`;
            }
          }
        }
      }
    }
  });
}

function renderYearChart() {
  const ctx = document.getElementById('yearChart')?.getContext('2d');
  if (!ctx) return;
  if (state.yearChartInstance) state.yearChartInstance.destroy();

  const yearCounts = { '1st Year': 0, '2nd Year': 0, '3rd Year': 0, '4th Year': 0, 'Graduate': 0 };
  state.students.forEach(st => {
    const y = st.yearLevel || '1st Year';
    yearCounts[y] = (yearCounts[y] || 0) + 1;
  });

  state.yearChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(yearCounts),
      datasets: [{
        label: 'Enrolled Students',
        data: Object.values(yearCounts),
        backgroundColor: ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6'],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

// ---------- TABS ----------
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

// ---------- BACKUP / RESTORE / RESET ----------
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
  openModal('Delete all data?', 'All courses, students, events and records will be permanently deleted.', async () => {
    await post('/api/reset', {});
    toast('All data deleted');
    await loadAll();
  });
}

// ---------- MODAL / TOAST ----------
function openModal(title, message, onConfirm) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').innerHTML = message;
  document.getElementById('modal').classList.add('show');
  document.getElementById('modalConfirm').onclick = () => { closeModal(); if (onConfirm) onConfirm(); };
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

// ---------- HERO STATS ----------
function updateHero() {
  document.getElementById('statCourses').textContent = state.courses.length;
  document.getElementById('statStudents').textContent = state.students.length;
  document.getElementById('statSessions').textContent = state.sessions.length;
  const now = new Date();
  document.getElementById('heroKicker').textContent =
    now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  get('/api/report').then(r => {
    const totalMarks = r.students.reduce((a, s) => a + s.present + s.late + s.absent, 0);
    const present = r.students.reduce((a, s) => a + s.present + s.late, 0);
    const pct = totalMarks ? Math.round((present / totalMarks) * 100) : 0;
    document.getElementById('statRate').textContent = pct + '%';
  }).catch(() => {});
}

// ---------- HELPERS ----------
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
