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

  CREATE TABLE IF NOT EXISTS courses (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    color       TEXT DEFAULT '#8b5cf6',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    course_id  TEXT NOT NULL,
    student_id TEXT NOT NULL,
    PRIMARY KEY (course_id, student_id),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    course_id  TEXT DEFAULT '',
    title      TEXT NOT NULL,
    date       TEXT NOT NULL,
    start_time TEXT DEFAULT '',
    end_time   TEXT DEFAULT '',
    room       TEXT DEFAULT '',
    notes      TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
  );
`);

// Table migration for attendance table (to allow 'late' and 'exempted' in status check and excuse column)
function ensureAttendanceTable() {
  const info = db.prepare(`PRAGMA table_info(attendance)`).all();
  const hasExcuse = info.some(c => c.name === 'excuse');
  if (!info.length) {
    db.exec(`
      CREATE TABLE attendance (
        session_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        status     TEXT NOT NULL CHECK (status IN ('present', 'late', 'exempted', 'absent', 'unmarked')),
        scanned_at INTEGER,
        excuse     TEXT DEFAULT '',
        PRIMARY KEY (session_id, student_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      );
    `);
  } else {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS attendance_v3 (
          session_id TEXT NOT NULL,
          student_id TEXT NOT NULL,
          status     TEXT NOT NULL CHECK (status IN ('present', 'late', 'exempted', 'absent', 'unmarked')),
          scanned_at INTEGER,
          excuse     TEXT DEFAULT '',
          PRIMARY KEY (session_id, student_id),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
        );
        INSERT OR IGNORE INTO attendance_v3 (session_id, student_id, status, scanned_at, excuse)
        SELECT session_id, student_id, status, scanned_at, COALESCE(excuse, '') FROM attendance;
        DROP TABLE attendance;
        ALTER TABLE attendance_v3 RENAME TO attendance;
      `);
    } catch (err) {
      // Migration already completed or unneeded
    }
  }
}
ensureAttendanceTable();

// --- migrations for databases created before these columns existed ---
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('students', 'student_id', "student_id TEXT DEFAULT ''");
ensureColumn('students', 'year_level', "year_level TEXT DEFAULT '1st Year'");
ensureColumn('students', 'role', "role TEXT DEFAULT 'Student'");
ensureColumn('enrollments', 'enrolled_at', "enrolled_at TEXT DEFAULT CURRENT_TIMESTAMP");
ensureColumn('sessions', 'course_id', "course_id TEXT DEFAULT ''");
ensureColumn('sessions', 'start_time', "start_time TEXT DEFAULT ''");
ensureColumn('sessions', 'end_time', "end_time TEXT DEFAULT ''");
ensureColumn('sessions', 'room', "room TEXT DEFAULT ''");
ensureColumn('sessions', 'notes', "notes TEXT DEFAULT ''");
ensureColumn('sessions', 'exempt_roles', "exempt_roles TEXT DEFAULT '[]'");

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

// ---------- Students ----------
const listStudents = () => {
  const students = db.prepare('SELECT id, student_id AS studentId, name, email, year_level AS yearLevel, role, created_at AS createdAt FROM students ORDER BY name COLLATE NOCASE').all();
  const enrollments = db.prepare(`
    SELECT e.student_id AS studentId, c.id AS courseId, c.code AS courseCode, c.name AS courseName, c.color AS courseColor, e.enrolled_at AS enrolledAt
    FROM enrollments e
    JOIN courses c ON c.id = e.course_id
    ORDER BY e.enrolled_at DESC, e.rowid DESC
  `).all();
  
  const map = {};
  for (const e of enrollments) {
    if (!map[e.studentId]) map[e.studentId] = [];
    map[e.studentId].push({ id: e.courseId, code: e.courseCode, name: e.courseName, color: e.courseColor, enrolledAt: e.enrolledAt });
  }
  return students.map(s => ({ ...s, courses: map[s.id] || [] }));
};

const getStudent = id => {
  const student = db.prepare('SELECT id, student_id AS studentId, name, email, year_level AS yearLevel, role, created_at AS createdAt FROM students WHERE id = ?').get(id);
  if (!student) return null;
  const courses = db.prepare(`
    SELECT c.id, c.code, c.name, c.color, e.enrolled_at AS enrolledAt
    FROM enrollments e
    JOIN courses c ON c.id = e.course_id
    WHERE e.student_id = ?
    ORDER BY e.enrolled_at DESC, e.rowid DESC
  `).all(id);
  return { ...student, courses };
};

const getStudentByScanId = scanId =>
  db.prepare('SELECT id, student_id AS studentId, name, email, year_level AS yearLevel, role FROM students WHERE student_id = ? COLLATE NOCASE').get(scanId);

const createStudent = ({ id, studentId, name, email, yearLevel, role, createdAt }) =>
  db.prepare('INSERT INTO students (id, student_id, name, email, year_level, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, studentId || '', name, email || '', yearLevel || '1st Year', role || 'Student', createdAt);

const updateStudent = ({ id, studentId, name, email, yearLevel, role }) =>
  db.prepare('UPDATE students SET student_id = ?, name = ?, email = ?, year_level = ?, role = ? WHERE id = ?')
    .run(studentId || '', name, email || '', yearLevel || '1st Year', role || 'Student', id);

const deleteStudent = id =>
  db.prepare('DELETE FROM students WHERE id = ?').run(id);

// ---------- Courses ----------
const listCourses = () =>
  db.prepare(`
    SELECT c.id, c.code, c.name, c.description, c.color, c.created_at AS createdAt,
           COUNT(DISTINCT e.student_id) AS studentCount,
           COUNT(DISTINCT s.id) AS sessionCount
    FROM courses c
    LEFT JOIN enrollments e ON e.course_id = c.id
    LEFT JOIN sessions s ON s.course_id = c.id
    GROUP BY c.id
    ORDER BY c.code COLLATE NOCASE
  `).all();

const getCourse = id =>
  db.prepare('SELECT id, code, name, description, color, created_at AS createdAt FROM courses WHERE id = ?').get(id);

const createCourse = ({ id, code, name, description, color, createdAt }) =>
  db.prepare('INSERT INTO courses (id, code, name, description, color, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, code, name, description || '', color || '#8b5cf6', createdAt);

const updateCourse = ({ id, code, name, description, color }) =>
  db.prepare('UPDATE courses SET code = ?, name = ?, description = ?, color = ? WHERE id = ?')
    .run(code, name, description || '', color || '#8b5cf6', id);

const deleteCourse = id =>
  db.prepare('DELETE FROM courses WHERE id = ?').run(id);

const enrollStudent = (courseId, studentId) =>
  db.prepare('INSERT OR REPLACE INTO enrollments (course_id, student_id, enrolled_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(courseId, studentId);

const unenrollStudent = (courseId, studentId) =>
  db.prepare('DELETE FROM enrollments WHERE course_id = ? AND student_id = ?').run(courseId, studentId);

function parseExemptRoles(jsonStr) {
  try {
    return JSON.parse(jsonStr || '[]');
  } catch (e) {
    return [];
  }
}

const listSessions = () => {
  const rows = db.prepare(`
    SELECT s.id, s.course_id AS courseId, s.title, s.date, s.start_time AS startTime, s.end_time AS endTime, s.room, s.notes, s.exempt_roles AS exemptRoles, s.created_at AS createdAt,
           c.code AS courseCode, c.name AS courseName, c.color AS courseColor,
           COUNT(a.student_id) AS marked,
           SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) AS present,
           SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late
    FROM sessions s
    LEFT JOIN courses c ON c.id = s.course_id
    LEFT JOIN attendance a ON a.session_id = s.id
    GROUP BY s.id
    ORDER BY s.date DESC, s.created_at DESC
  `).all();
  return rows.map(r => ({ ...r, exemptRoles: parseExemptRoles(r.exemptRoles) }));
};

const getSession = id => {
  const r = db.prepare(`
    SELECT s.id, s.course_id AS courseId, s.title, s.date, s.start_time AS startTime, s.end_time AS endTime, s.room, s.notes, s.exempt_roles AS exemptRoles, s.created_at AS createdAt,
           c.code AS courseCode, c.name AS courseName, c.color AS courseColor
    FROM sessions s
    LEFT JOIN courses c ON c.id = s.course_id
    WHERE s.id = ?
  `).get(id);
  if (!r) return null;
  return { ...r, exemptRoles: parseExemptRoles(r.exemptRoles) };
};

const createSession = ({ id, courseId, title, date, startTime, endTime, room, notes, exemptRoles, createdAt }) => {
  const rolesJson = JSON.stringify(exemptRoles || []);
  return db.prepare('INSERT INTO sessions (id, course_id, title, date, start_time, end_time, room, notes, exempt_roles, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, courseId || '', title, date, startTime || '', endTime || '', room || '', notes || '', rolesJson, createdAt);
};

const updateSession = ({ id, courseId, title, date, startTime, endTime, room, notes, exemptRoles }) => {
  const rolesJson = JSON.stringify(exemptRoles || []);
  return db.prepare('UPDATE sessions SET course_id = ?, title = ?, date = ?, start_time = ?, end_time = ?, room = ?, notes = ?, exempt_roles = ? WHERE id = ?')
    .run(courseId || '', title, date, startTime || '', endTime || '', room || '', notes || '', rolesJson, id);
};

const deleteSession = id =>
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);

// ---------- Attendance ----------
const getAttendance = sessionId =>
  db.prepare(`
    SELECT a.student_id AS studentId, a.status, a.scanned_at AS scannedAt, a.excuse,
           s.name AS studentName, s.student_id AS scanId
    FROM attendance a
    JOIN students s ON s.id = a.student_id
    WHERE a.session_id = ?
    ORDER BY a.scanned_at IS NULL, a.scanned_at ASC
  `).all(sessionId);

const upsertAttendance = db.prepare(`
  INSERT INTO attendance (session_id, student_id, status, scanned_at, excuse) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (session_id, student_id) DO UPDATE SET
    status = excluded.status,
    scanned_at = COALESCE(excluded.scanned_at, attendance.scanned_at),
    excuse = excluded.excuse
`);

const report = () => {
  const students = db.prepare(`
    SELECT s.id, s.name, s.email, s.student_id AS studentId,
           COUNT(DISTINCT x.session_id) AS sessions,
           COALESCE(SUM(CASE WHEN x.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
           COALESCE(SUM(CASE WHEN x.status = 'late' THEN 1 ELSE 0 END), 0) AS late,
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
    SELECT ss.id, ss.title, ss.date, ss.course_id AS courseId, c.code AS courseCode, c.color AS courseColor,
           (SELECT COUNT(*) FROM students) AS totalStudents,
           COALESCE(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
           COALESCE(SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END), 0) AS late,
           COALESCE(SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
           COALESCE(SUM(CASE WHEN a.status = 'unmarked' THEN 1 ELSE 0 END), 0) AS unmarked
    FROM sessions ss
    LEFT JOIN courses c ON c.id = ss.course_id
    LEFT JOIN attendance a ON a.session_id = ss.id
    GROUP BY ss.id
    ORDER BY ss.date DESC, ss.created_at DESC
  `).all();

  const courses = db.prepare(`
    SELECT c.id, c.code, c.name, c.color,
           COUNT(DISTINCT e.student_id) AS enrolledStudents,
           COUNT(DISTINCT s.id) AS totalSessions
    FROM courses c
    LEFT JOIN enrollments e ON e.course_id = c.id
    LEFT JOIN sessions s ON s.course_id = c.id
    GROUP BY c.id
    ORDER BY c.code COLLATE NOCASE
  `).all();

  return { students, sessions, courses };
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
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  enrollStudent,
  unenrollStudent,
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  getAttendance,
  upsertAttendance,
  report,
};

