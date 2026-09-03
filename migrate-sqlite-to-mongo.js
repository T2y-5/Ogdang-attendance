const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { DatabaseSync } = require('node:sqlite');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ogdang_attendance';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'attendance.db');

async function migrate() {
  try {
    console.log('Connecting to MongoDB at:', MONGODB_URI);
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    console.log('✅ Connected to MongoDB successfully!');
  } catch (err) {
    console.log('⚠️ MongoDB server at port 27017 not available. Using MongoMemoryServer...');
    const mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    console.log('✅ Connected to Embedded MongoDB at:', uri);
  }

  // Schemas
  const Course = mongoose.model('Course', new mongoose.Schema({
    id: String,
    code: String,
    name: String,
    description: String,
    color: String,
    createdAt: { type: Number, default: Date.now }
  }));

  const Student = mongoose.model('Student', new mongoose.Schema({
    id: String,
    studentId: String,
    name: String,
    email: String,
    yearLevel: String,
    role: String,
    createdAt: { type: Number, default: Date.now }
  }));

  const Enrollment = mongoose.model('Enrollment', new mongoose.Schema({
    courseId: String,
    studentId: String,
    enrolledAt: { type: Number, default: Date.now }
  }));

  const Session = mongoose.model('Session', new mongoose.Schema({
    id: String,
    courseId: String,
    title: String,
    date: String,
    startTime: String,
    endTime: String,
    room: String,
    notes: String,
    exemptRoles: [String],
    lateFine: Number,
    absentFine: Number,
    createdAt: { type: Number, default: Date.now }
  }));

  const Attendance = mongoose.model('Attendance', new mongoose.Schema({
    sessionId: String,
    studentId: String,
    status: String,
    scannedAt: mongoose.Schema.Types.Mixed,
    excuse: String
  }));

  if (!fs.existsSync(DB_PATH)) {
    console.log('No existing SQLite database found at:', DB_PATH);
    process.exit(0);
  }

  console.log('Reading SQLite data from:', DB_PATH);
  const sqliteDb = new DatabaseSync(DB_PATH);

  // 1. Migrate Courses
  const courses = sqliteDb.prepare('SELECT * FROM courses').all();
  for (const c of courses) {
    await Course.updateOne(
      { id: c.id },
      { id: c.id, code: c.code, name: c.name, description: c.description || '', color: c.color || '#8b5cf6', createdAt: Number(c.created_at) || Date.now() },
      { upsert: true }
    );
  }
  console.log(`Migrated ${courses.length} courses to MongoDB.`);

  // 2. Migrate Students
  const students = sqliteDb.prepare('SELECT * FROM students').all();
  for (const s of students) {
    await Student.updateOne(
      { id: s.id },
      { id: s.id, studentId: s.student_id || '', name: s.name, email: s.email || '', yearLevel: s.year_level || '1st Year', role: s.role || 'Student', createdAt: Number(s.created_at) || Date.now() },
      { upsert: true }
    );
  }
  console.log(`Migrated ${students.length} students to MongoDB.`);

  // 3. Migrate Enrollments
  const enrollments = sqliteDb.prepare('SELECT * FROM enrollments').all();
  for (const e of enrollments) {
    await Enrollment.updateOne(
      { courseId: e.course_id, studentId: e.student_id },
      { courseId: e.course_id, studentId: e.student_id, enrolledAt: Number(e.enrolled_at) || Date.now() },
      { upsert: true }
    );
  }
  console.log(`Migrated ${enrollments.length} course enrollments to MongoDB.`);

  // 4. Migrate Sessions
  const sessions = sqliteDb.prepare('SELECT * FROM sessions').all();
  for (const s of sessions) {
    let exemptRoles = [];
    try { exemptRoles = JSON.parse(s.exempt_roles || '[]'); } catch (err) { exemptRoles = []; }
    await Session.updateOne(
      { id: s.id },
      {
        id: s.id,
        courseId: s.course_id || '',
        title: s.title,
        date: s.date,
        startTime: s.start_time || '',
        endTime: s.end_time || '',
        room: s.room || '',
        notes: s.notes || '',
        exemptRoles,
        lateFine: Number(s.late_fine) || 0,
        absentFine: Number(s.absent_fine) || 0,
        createdAt: Number(s.created_at) || Date.now()
      },
      { upsert: true }
    );
  }
  console.log(`Migrated ${sessions.length} events/sessions to MongoDB.`);

  // 5. Migrate Attendance
  try {
    const attendances = sqliteDb.prepare('SELECT * FROM attendance').all();
    for (const a of attendances) {
      await Attendance.updateOne(
        { sessionId: a.session_id, studentId: a.student_id },
        { sessionId: a.session_id, studentId: a.student_id, status: a.status, scannedAt: a.scanned_at || null, excuse: a.excuse || '' },
        { upsert: true }
      );
    }
    console.log(`Migrated ${attendances.length} attendance records to MongoDB.`);
  } catch (err) {
    console.log('No attendance table found or empty.');
  }

  console.log('🎉 Migration completed successfully!');
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
