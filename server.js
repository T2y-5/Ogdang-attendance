const path = require('path');
const express = require('express');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// the attendance window for a session; an end time before the start time means "next day"
function sessionWindow(session) {
  const start = new Date(`${session.date}T${session.startTime || '00:00'}:00`);
  let end = new Date(`${session.date}T${session.endTime || '23:59'}:00`);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

// ---------- Students ----------
app.get('/api/students', wrap((req, res) => res.json(store.listStudents())));

app.post('/api/students', wrap((req, res) => {
  const { studentId, name, email } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!studentId || !String(studentId).trim()) return res.status(400).json({ error: 'Student ID is required' });
  if (store.getStudentByScanId(String(studentId).trim())) {
    return res.status(400).json({ error: 'That student ID is already in use' });
  }
  const student = {
    id: uid(),
    studentId: String(studentId).trim(),
    name: String(name).trim(),
    email: String(email || '').trim(),
    createdAt: Date.now(),
  };
  store.createStudent(student);
  res.status(201).json(student);
}));

app.put('/api/students/:id', wrap((req, res) => {
  const existing = store.getStudent(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Student not found' });
  const { studentId, name, email } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!studentId || !String(studentId).trim()) return res.status(400).json({ error: 'Student ID is required' });
  const clash = store.getStudentByScanId(String(studentId).trim());
  if (clash && clash.id !== existing.id) {
    return res.status(400).json({ error: 'That student ID is already in use' });
  }
  store.updateStudent({ id: req.params.id, studentId: String(studentId).trim(), name: String(name).trim(), email: String(email || '').trim() });
  res.json(store.getStudent(req.params.id));
}));

app.delete('/api/students/:id', wrap((req, res) => {
  const result = store.deleteStudent(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Student not found' });
  res.status(204).end();
}));

// ---------- Sessions ----------
app.get('/api/sessions', wrap((req, res) => res.json(store.listSessions())));

app.post('/api/sessions', wrap((req, res) => {
  const { title, date, startTime, endTime, notes } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  if (!date) return res.status(400).json({ error: 'Date is required' });
  if (!startTime || !endTime) return res.status(400).json({ error: 'Start and end time are required' });
  const session = {
    id: uid(),
    title: String(title).trim(),
    date,
    startTime: String(startTime).trim(),
    endTime: String(endTime).trim(),
    notes: String(notes || '').trim(),
    createdAt: Date.now(),
  };
  store.createSession(session);
  res.status(201).json(session);
}));

app.put('/api/sessions/:id', wrap((req, res) => {
  const existing = store.getSession(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  const { title, date, startTime, endTime, notes } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  if (!date) return res.status(400).json({ error: 'Date is required' });
  if (!startTime || !endTime) return res.status(400).json({ error: 'Start and end time are required' });
  store.updateSession({
    id: req.params.id,
    title: String(title).trim(),
    date,
    startTime: String(startTime).trim(),
    endTime: String(endTime).trim(),
    notes: String(notes || '').trim(),
  });
  res.json(store.getSession(req.params.id));
}));

app.delete('/api/sessions/:id', wrap((req, res) => {
  const result = store.deleteSession(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Event not found' });
  res.status(204).end();
}));

// ---------- Attendance ----------
app.get('/api/sessions/:id/attendance', wrap((req, res) => {
  if (!store.getSession(req.params.id)) return res.status(404).json({ error: 'Event not found' });
  res.json(store.getAttendance(req.params.id));
}));

app.put('/api/sessions/:id/attendance', wrap((req, res) => {
  if (!store.getSession(req.params.id)) return res.status(404).json({ error: 'Event not found' });
  const entries = req.body || [];
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Expected an array of {studentId, status}' });

  store.transaction(() => {
    for (const e of entries) {
      if (!e || !e.studentId) continue;
      const status = ['present', 'absent', 'unmarked'].includes(e.status) ? e.status : 'unmarked';
      store.upsertAttendance.run(req.params.id, e.studentId, status, null);
    }
  });

  res.json(store.getAttendance(req.params.id));
}));

// ID card scan â€” only works inside the session's time window
app.post('/api/sessions/:id/scan', wrap((req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Event not found' });

  const { scanId } = req.body || {};
  if (!scanId || !String(scanId).trim()) return res.status(400).json({ error: 'No student ID detected' });

  const student = store.getStudentByScanId(String(scanId).trim());
  if (!student) return res.status(404).json({ error: `No student found for ID "${String(scanId).trim()}"` });

  const now = new Date();
  const { start, end } = sessionWindow(session);
  const windowInfo = { start: start.toISOString(), end: end.toISOString() };

  if (now < start) {
    return res.status(400).json({
      error: 'Attendance opens at ' + start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      window: windowInfo,
    });
  }
  if (now > end) {
    return res.status(400).json({
      error: 'Attendance closed at ' + end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      window: windowInfo,
    });
  }

  store.upsertAttendance.run(session.id, student.id, 'present', now.getTime());
  res.json({
    ok: true,
    student: { name: student.name, studentId: student.studentId },
    time: now.toISOString(),
    window: windowInfo,
  });
}));

// ---------- Reports ----------
app.get('/api/report', wrap((req, res) => res.json(store.report())));

// ---------- Backup / Import / Reset ----------
app.get('/api/backup', wrap((req, res) => {
  res.json({
    students: store.listStudents(),
    sessions: store.listSessions().map(({ marked, present, ...s }) => s),
    attendance: store.db.prepare('SELECT session_id AS sessionId, student_id AS studentId, status, scanned_at AS scannedAt FROM attendance').all(),
  });
}));

app.post('/api/import', wrap((req, res) => {
  const { students = [], sessions = [], attendance = [] } = req.body || {};
  if (!Array.isArray(students) || !Array.isArray(sessions) || !Array.isArray(attendance)) {
    return res.status(400).json({ error: 'Invalid backup format' });
  }

  store.transaction(() => {
    store.db.exec('DELETE FROM attendance; DELETE FROM sessions; DELETE FROM students;');
    const insS = store.db.prepare('INSERT INTO students (id, student_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)');
    const insX = store.db.prepare('INSERT INTO sessions (id, title, date, start_time, end_time, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insA = store.db.prepare('INSERT INTO attendance (session_id, student_id, status, scanned_at) VALUES (?, ?, ?, ?)');

    for (const s of students) {
      if (!s || !s.id || !s.name) continue;
      insS.run(s.id, s.studentId || '', s.name, s.email || '', s.createdAt || Date.now());
    }
    for (const x of sessions) {
      if (!x || !x.id || !x.title || !x.date) continue;
      insX.run(x.id, x.title, x.date, x.startTime || '', x.endTime || '', x.notes || '', x.createdAt || Date.now());
    }
    for (const a of attendance) {
      if (!a || !a.sessionId || !a.studentId) continue;
      const status = ['present', 'absent', 'unmarked'].includes(a.status) ? a.status : 'unmarked';
      insA.run(a.sessionId, a.studentId, status, a.scannedAt || null);
    }
  });

  res.json({ ok: true });
}));

app.post('/api/reset', wrap((req, res) => {
  store.db.exec('DELETE FROM attendance; DELETE FROM sessions; DELETE FROM students;');
  res.json({ ok: true });
}));

// ---------- Server ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Attendance system running at http://localhost:${PORT}`);
});
