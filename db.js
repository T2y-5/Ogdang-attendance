const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'attendance.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS students (
    id         TEXT PRIMARY KEY,
    student_id TEXT DEFAULT '',
    name       TEXT NOT NULL,
    email      TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    date       TEXT NOT NULL,
    start_time TEXT DEFAULT '',
    end_time   TEXT DEFAULT '',
    notes      TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance (
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('present', 'absent', 'unmarked')),
    scanned_at INTEGER,
    PRIMARY KEY (session_id, student_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );
`);

// --- migrations for databases created before these columns existed ---
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('students', 'student_id', "student_id TEXT DEFAULT ''");
ensureColumn('sessions', 'start_time', "start_time TEXT DEFAULT ''");
ensureColumn('sessions', 'end_time', "end_time TEXT DEFAULT ''");
ensureColumn('attendance', 'scanned_at', 'scanned_at INTEGER');

// unique scan IDs, but allow multiple students with no ID assigned
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_students_scan ON students(student_id) WHERE student_id <> ''");

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const listStudents = () =>
  db.prepare('SELECT id, student_id AS studentId, name, email, created_at AS createdAt FROM students ORDER BY name COLLATE NOCASE').all();

const getStudent = id =>
  db.prepare('SELECT id, student_id AS studentId, name, email, created_at AS createdAt FROM students WHERE id = ?').get(id);

const getStudentByScanId = scanId =>
  db.prepare('SELECT id, student_id AS studentId, name, email FROM students WHERE student_id = ? COLLATE NOCASE').get(scanId);

const createStudent = ({ id, studentId, name, email, createdAt }) =>
  db.prepare('INSERT INTO students (id, student_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, studentId || '', name, email || '', createdAt);

const updateStudent = ({ id, studentId, name, email }) =>
  db.prepare('UPDATE students SET student_id = ?, name = ?, email = ? WHERE id = ?')
    .run(studentId || '', name, email || '', id);

const deleteStudent = id =>
  db.prepare('DELETE FROM students WHERE id = ?').run(id);

const listSessions = () =>
  db.prepare(`
    SELECT s.id, s.title, s.date, s.start_time AS startTime, s.end_time AS endTime, s.notes, s.created_at AS createdAt,
           COUNT(a.student_id) AS marked,
           SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present
    FROM sessions s
    LEFT JOIN attendance a ON a.session_id = s.id
    GROUP BY s.id
    ORDER BY s.date DESC, s.created_at DESC
  `).all();

const getSession = id =>
  db.prepare('SELECT id, title, date, start_time AS startTime, end_time AS endTime, notes, created_at AS createdAt FROM sessions WHERE id = ?').get(id);

const createSession = ({ id, title, date, startTime, endTime, notes, createdAt }) =>
  db.prepare('INSERT INTO sessions (id, title, date, start_time, end_time, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, title, date, startTime || '', endTime || '', notes || '', createdAt);

const updateSession = ({ id, title, date, startTime, endTime, notes }) =>
  db.prepare('UPDATE sessions SET title = ?, date = ?, start_time = ?, end_time = ?, notes = ? WHERE id = ?')
    .run(title, date, startTime || '', endTime || '', notes || '', id);

const deleteSession = id =>
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);

const getAttendance = sessionId =>
  db.prepare(`
    SELECT a.student_id AS studentId, a.status, a.scanned_at AS scannedAt,
           s.name AS studentName, s.student_id AS scanId
    FROM attendance a
    JOIN students s ON s.id = a.student_id
    WHERE a.session_id = ?
    ORDER BY a.scanned_at IS NULL, a.scanned_at ASC
  `).all(sessionId);

const upsertAttendance = db.prepare(`
  INSERT INTO attendance (session_id, student_id, status, scanned_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (session_id, student_id) DO UPDATE SET status = excluded.status, scanned_at = excluded.scanned_at
`);

const report = () => {
  const students = db.prepare(`
    SELECT s.id, s.name, s.email,
           COUNT(DISTINCT x.session_id) AS sessions,
           COALESCE(SUM(CASE WHEN x.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
           COALESCE(SUM(CASE WHEN x.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
           COALESCE(SUM(CASE WHEN x.status = 'unmarked' THEN 1 ELSE 0 END), 0) AS unmarked
    FROM students s
    LEFT JOIN (
      SELECT a.* FROM attendance a
      JOIN sessions ss ON ss.id = a.session_id
    ) x ON x.student_id = s.id
    GROUP BY s.id
    ORDER BY s.name COLLATE NOCASE
  `).all();

  const sessions = db.prepare(`
    SELECT ss.id, ss.title, ss.date,
           (SELECT COUNT(*) FROM students) AS totalStudents,
           COALESCE(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
           COALESCE(SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
           COALESCE(SUM(CASE WHEN a.status = 'unmarked' THEN 1 ELSE 0 END), 0) AS unmarked
    FROM sessions ss
    LEFT JOIN attendance a ON a.session_id = ss.id
    GROUP BY ss.id
    ORDER BY ss.date DESC, ss.created_at DESC
  `).all();

  return { students, sessions };
};

module.exports = {
  db,
  transaction,
  listStudents,
  getStudent,
  getStudentByScanId,
  createStudent,
  updateStudent,
  deleteStudent,
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  getAttendance,
  upsertAttendance,
  report,
};
