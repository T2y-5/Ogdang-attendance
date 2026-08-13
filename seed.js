// Seeds the database with demo data. Safe by default:
//   node seed.js          -> only seeds if the database is empty
//   node seed.js --force  -> wipes everything first, then seeds
const store = require('./db');

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const force = process.argv.includes('--force');

if (store.listStudents().length > 0 && !force) {
  console.log('Database already has data. Run "node seed.js --force" to wipe and reseed.');
  process.exit(0);
}

if (force) {
  store.db.exec('DELETE FROM attendance; DELETE FROM sessions; DELETE FROM students;');
  console.log('Existing data cleared.');
}

const students = [
  { studentId: '2026-101', name: 'Zabian Quemada', email: 'zabian.q@school.edu' },
  { studentId: '2026-102', name: 'Kryzler Pimentel', email: 'kryzler.p@school.edu' },
  { studentId: '2026-103', name: 'Jan Albert Bandiola', email: 'jan.bandiola@school.edu' },
  { studentId: '2026-104', name: 'Christian Lawrence Ogdang', email: 'cl.ogdang@school.edu' },
  { studentId: '2026-105', name: 'Kiervey Honorario', email: 'kiervey.h@school.edu' },
].map(s => ({ ...s, id: uid(), createdAt: Date.now() }));

students.forEach(store.createStudent);

const sessions = [
  { title: 'Department Meeting', date: '2026-08-11', startTime: '09:00', endTime: '10:30', notes: 'Conference Room B' },
  { title: 'Team Building Day', date: '2026-08-12', startTime: '13:00', endTime: '17:00', notes: 'Outdoor grounds' },
  { title: 'Christmas Party', date: '2026-12-18', startTime: '18:00', endTime: '21:00', notes: 'Main Hall, potluck' },
].map(s => ({ ...s, id: uid(), createdAt: Date.now() }));

sessions.forEach(store.createSession);

const byTitle = {};
sessions.forEach(s => { byTitle[s.title] = s; });

function ts(date, time, offsetMin) {
  const d = new Date(`${date}T${time}:00`);
  d.setMinutes(d.getMinutes() + offsetMin);
  return d.getTime();
}

// [sessionTitle, studentIndex, status]
const marks = [
  ['Department Meeting', 0, 'present'],
  ['Department Meeting', 1, 'present'],
  ['Department Meeting', 2, 'present'],
  ['Department Meeting', 3, 'absent'],
  ['Department Meeting', 4, 'present'],
  ['Team Building Day', 0, 'present'],
  ['Team Building Day', 1, 'present'],
  ['Team Building Day', 2, 'absent'],
  ['Team Building Day', 3, 'present'],
  ['Team Building Day', 4, 'absent'],
];

marks.forEach(([title, idx, status]) => {
  const s = byTitle[title];
  const st = students[idx];
  const scanTs = status === 'present' ? ts(s.date, s.startTime, 5 + idx * 3) : null;
  store.upsertAttendance.run(s.id, st.id, status, scanTs);
});

console.log(`Seeded ${students.length} students, ${sessions.length} sessions, ${marks.length} attendance records.`);
