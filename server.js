const path = require('path');
const express = require('express');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Session time window check
function sessionWindow(session) {
  const start = new Date(`${session.date}T${session.startTime || '00:00'}:00`);
  let end = new Date(`${session.date}T${session.endTime || '23:59'}:00`);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

// ---------- Courses ----------
app.get('/api/courses', wrap(async (req, res) => {
  const courses = await store.listCourses();
  res.json(courses);
}));

app.post('/api/courses', wrap(async (req, res) => {
  const { code, name, description, color } = req.body || {};
  if (!code || !String(code).trim()) return res.status(400).json({ error: 'Course code is required' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Course name is required' });

  try {
    const course = await store.createCourse({
      code: String(code).trim().toUpperCase(),
      name: String(name).trim(),
      description: String(description || '').trim(),
      color: String(color || '#8b5cf6').trim(),
    });
    res.status(201).json(course);
  } catch (err) {
    if (err.message && err.message.includes('E11000')) {
      return res.status(400).json({ error: 'Course code already exists' });
    }
    throw err;
  }
}));

app.put('/api/courses/:id', wrap(async (req, res) => {
  const { code, name, description, color } = req.body || {};
  if (!code || !String(code).trim()) return res.status(400).json({ error: 'Course code is required' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Course name is required' });

  const updated = await store.updateCourse(req.params.id, {
    code: String(code).trim().toUpperCase(),
    name: String(name).trim(),
    description: String(description || '').trim(),
    color: String(color || '#8b5cf6').trim(),
  });
  if (!updated) return res.status(404).json({ error: 'Course not found' });
  res.json(updated);
}));

app.delete('/api/courses/:id', wrap(async (req, res) => {
  await store.deleteCourse(req.params.id);
  res.status(204).end();
}));

// ---------- Students ----------
app.get('/api/students', wrap(async (req, res) => {
  const students = await store.listStudents();
  res.json(students);
}));

app.post('/api/students', wrap(async (req, res) => {
  const { studentId, name, email, yearLevel, role, courses } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!studentId || !String(studentId).trim()) return res.status(400).json({ error: 'Student ID is required' });

  const courseId = (Array.isArray(courses) && courses.length > 0) ? courses[0] : '';
  const student = await store.createStudent({
    studentId: String(studentId).trim(),
    name: String(name).trim(),
    email: String(email || '').trim(),
    yearLevel: String(yearLevel || '1st Year').trim(),
    role: String(role || 'Student').trim(),
    courseId
  });
  res.status(201).json(student);
}));

app.put('/api/students/:id', wrap(async (req, res) => {
  const { studentId, name, email, yearLevel, role, courses } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!studentId || !String(studentId).trim()) return res.status(400).json({ error: 'Student ID is required' });

  const courseId = (Array.isArray(courses) && courses.length > 0) ? courses[0] : '';
  const updated = await store.updateStudent(req.params.id, {
    studentId: String(studentId).trim(),
    name: String(name).trim(),
    email: String(email || '').trim(),
    yearLevel: String(yearLevel || '1st Year').trim(),
    role: String(role || 'Student').trim(),
    courseId
  });
  if (!updated) return res.status(404).json({ error: 'Student not found' });
  res.json(updated);
}));

app.delete('/api/students/:id', wrap(async (req, res) => {
  await store.deleteStudent(req.params.id);
  res.status(204).end();
}));

// ---------- Sessions ----------
app.get('/api/sessions', wrap(async (req, res) => {
  const sessions = await store.listSessions();
  res.json(sessions);
}));

app.post('/api/sessions', wrap(async (req, res) => {
  let { courseId, title, date, startTime, endTime, room, notes, exemptRoles, lateFine, absentFine } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  if (!date) return res.status(400).json({ error: 'Date is required' });

  startTime = (startTime && String(startTime).trim()) ? String(startTime).trim() : '08:00';
  endTime = (endTime && String(endTime).trim()) ? String(endTime).trim() : '17:00';

  const session = await store.createSession({
    courseId: courseId || '',
    title: String(title).trim(),
    date,
    startTime,
    endTime,
    room: String(room || '').trim(),
    notes: String(notes || '').trim(),
    exemptRoles: Array.isArray(exemptRoles) ? exemptRoles : [],
    lateFine: Number(lateFine) || 0,
    absentFine: Number(absentFine) || 0,
  });
  res.status(201).json(session);
}));

app.put('/api/sessions/:id', wrap(async (req, res) => {
  let { courseId, title, date, startTime, endTime, room, notes, exemptRoles, lateFine, absentFine } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  if (!date) return res.status(400).json({ error: 'Date is required' });

  startTime = (startTime && String(startTime).trim()) ? String(startTime).trim() : '08:00';
  endTime = (endTime && String(endTime).trim()) ? String(endTime).trim() : '17:00';

  const updated = await store.updateSession(req.params.id, {
    courseId: courseId || '',
    title: String(title).trim(),
    date,
    startTime,
    endTime,
    room: String(room || '').trim(),
    notes: String(notes || '').trim(),
    exemptRoles: Array.isArray(exemptRoles) ? exemptRoles : [],
    lateFine: Number(lateFine) || 0,
    absentFine: Number(absentFine) || 0,
  });
  if (!updated) return res.status(404).json({ error: 'Event not found' });
  res.json(updated);
}));

app.delete('/api/sessions/:id', wrap(async (req, res) => {
  await store.deleteSession(req.params.id);
  res.status(204).end();
}));

// Export Session Attendance CSV
app.get('/api/sessions/:id/csv', wrap(async (req, res) => {
  const { session, records } = await store.getAttendanceSheet(req.params.id);
  if (!session) return res.status(404).json({ error: 'Event not found' });

  const lines = ['"Student Name","Student ID","Status","Excuse","Time-In","Time-Out"'];
  for (const r of records) {
    const excuse = (r.excuse || '').replace(/"/g, '""');
    const scannedAt = r.scannedAt ? new Date(r.scannedAt).toLocaleString() : '';
    const checkOutAt = r.checkOutAt ? new Date(r.checkOutAt).toLocaleString() : '';
    lines.push(`"${r.name.replace(/"/g, '""')}","${(r.scanId || '').replace(/"/g, '""')}","${r.status}","${excuse}","${scannedAt}","${checkOutAt}"`);
  }

  const filename = `${session.title.replace(/[^a-z0-9_-]/gi, '_')}_${session.date}_attendance.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
}));

// ---------- Attendance ----------
app.get('/api/sessions/:id/attendance', wrap(async (req, res) => {
  const data = await store.getAttendanceSheet(req.params.id);
  if (!data.session) return res.status(404).json({ error: 'Event not found' });
  res.json(data);
}));

app.put('/api/sessions/:id/attendance', wrap(async (req, res) => {
  const entries = req.body || [];
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Expected an array of {studentId, status, excuse}' });

  await store.bulkUpdateAttendance(req.params.id, entries);
  const updated = await store.getAttendanceSheet(req.params.id);
  res.json(updated);
}));

// ID card scan endpoint (Check-In & Check-Out)
app.post('/api/sessions/:id/scan', wrap(async (req, res) => {
  const session = await store.Session.findOne({ id: req.params.id }).lean();
  if (!session) return res.status(404).json({ error: 'Event not found' });

  const { scanId, mode = 'check-in' } = req.body || {};
  if (!scanId || !String(scanId).trim()) return res.status(400).json({ error: 'No student ID detected' });

  const student = await store.Student.findOne({ studentId: String(scanId).trim() }).lean();
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

  if (mode === 'check-out') {
    const result = await store.setCheckOutStatus(session.id, student.id);
    return res.json({
      ok: true,
      mode: 'check-out',
      status: result.status,
      student: { name: student.name, studentId: student.studentId },
      time: now.toISOString(),
      window: windowInfo,
    });
  } else {
    const diffMinutes = (now - start) / (1000 * 60);
    const status = diffMinutes > 15 ? 'late' : 'present';
    const result = await store.setAttendanceStatus(session.id, student.id, status, '', now.getTime());
    return res.json({
      ok: true,
      mode: 'check-in',
      status,
      student: { name: student.name, studentId: student.studentId },
      time: now.toISOString(),
      window: windowInfo,
    });
  }
}));

// ---------- Reports ----------
app.get('/api/report', wrap(async (req, res) => {
  const reportData = await store.report();
  res.json(reportData);
}));

// ---------- Auth & Reset ----------
app.post('/api/auth/verify', wrap((req, res) => {
  const { passcode } = req.body || {};
  if (passcode === 'admin123') {
    return res.json({ role: 'admin', label: 'Admin' });
  } else if (passcode === 'teacher123') {
    return res.json({ role: 'instructor', label: 'Instructor' });
  }
  return res.status(401).json({ error: 'Invalid security passcode' });
}));

app.post('/api/reset', wrap(async (req, res) => {
  await store.Course.deleteMany({});
  await store.Student.deleteMany({});
  await store.Enrollment.deleteMany({});
  await store.Session.deleteMany({});
  await store.Attendance.deleteMany({});
  res.json({ ok: true });
}));

// ---------- Server ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`🚀 Ogdang Attendance running on http://localhost:${PORT}`));
