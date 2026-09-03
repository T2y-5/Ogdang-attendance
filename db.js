const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ogdang_attendance';

async function initMongo() {
  try {
    console.log('Attempting MongoDB connection at:', MONGODB_URI);
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    console.log('✅ Connected to MongoDB server successfully');
  } catch (err) {
    console.log('⚠️ Local MongoDB server not reachable. Starting embedded MongoMemoryServer...');
    const mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    console.log('🚀 Embedded MongoDB server started at:', uri);
    await mongoose.connect(uri);
    console.log('✅ Connected to Embedded MongoDB successfully!');
  }
}

initMongo();

// Schemas
const CourseSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  color: { type: String, default: '#8b5cf6' },
  createdAt: { type: Number, default: Date.now }
});

const StudentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  studentId: { type: String, default: '' },
  name: { type: String, required: true },
  email: { type: String, default: '' },
  yearLevel: { type: String, default: '1st Year' },
  role: { type: String, default: 'Student' },
  createdAt: { type: Number, default: Date.now }
});

const EnrollmentSchema = new mongoose.Schema({
  courseId: { type: String, required: true },
  studentId: { type: String, required: true },
  enrolledAt: { type: Number, default: Date.now }
});

const SessionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  courseId: { type: String, default: '' },
  title: { type: String, required: true },
  date: { type: String, required: true },
  startTime: { type: String, default: '' },
  endTime: { type: String, default: '' },
  room: { type: String, default: '' },
  notes: { type: String, default: '' },
  exemptRoles: { type: [String], default: [] },
  lateFine: { type: Number, default: 0 },
  absentFine: { type: Number, default: 0 },
  createdAt: { type: Number, default: Date.now }
});

const AttendanceSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  studentId: { type: String, required: true },
  status: { type: String, enum: ['present', 'late', 'exempted', 'absent', 'unmarked'], default: 'unmarked' },
  scannedAt: { type: Number, default: null },
  excuse: { type: String, default: '' }
});

const Course = mongoose.model('Course', CourseSchema);
const Student = mongoose.model('Student', StudentSchema);
const Enrollment = mongoose.model('Enrollment', EnrollmentSchema);
const Session = mongoose.model('Session', SessionSchema);
const Attendance = mongoose.model('Attendance', AttendanceSchema);

// Helper for generating IDs
const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// Store Methods
module.exports = {
  mongoose,
  Course,
  Student,
  Enrollment,
  Session,
  Attendance,

  // COURSES
  async listCourses() {
    return await Course.find().sort({ createdAt: -1 }).lean();
  },

  async createCourse({ code, name, description = '', color = '#8b5cf6' }) {
    const id = uid('crs');
    const course = new Course({ id, code, name, description, color, createdAt: Date.now() });
    await course.save();
    return course.toObject();
  },

  async updateCourse(id, { code, name, description, color }) {
    return await Course.findOneAndUpdate({ id }, { code, name, description, color }, { new: true }).lean();
  },

  async deleteCourse(id) {
    await Course.deleteOne({ id });
    await Enrollment.deleteMany({ courseId: id });
    await Session.updateMany({ courseId: id }, { courseId: '' });
  },

  // STUDENTS
  async listStudents() {
    const students = await Student.find().sort({ createdAt: -1 }).lean();
    const enrollments = await Enrollment.find().sort({ enrolledAt: -1 }).lean();
    const courses = await Course.find().lean();
    const courseMap = new Map(courses.map(c => [c.id, c]));

    const attendances = await Attendance.find().lean();
    const sessions = await Session.find().lean();
    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    return students.map(s => {
      const studentEnrollments = enrollments.filter(e => e.studentId === s.id);
      const studentCourses = studentEnrollments.map(e => courseMap.get(e.courseId)).filter(Boolean);

      let totalFines = 0;
      const studentAtt = attendances.filter(a => a.studentId === s.id);
      studentAtt.forEach(a => {
        const sess = sessionMap.get(a.sessionId);
        if (!sess) return;
        if (a.status === 'late') totalFines += (sess.lateFine || 0);
        else if (a.status === 'absent') totalFines += (sess.absentFine || 0);
      });

      return {
        ...s,
        courses: studentCourses,
        totalFines
      };
    });
  },

  async createStudent({ studentId = '', name, email = '', yearLevel = '1st Year', role = 'Student', courseId = '' }) {
    const id = uid('stu');
    const student = new Student({ id, studentId, name, email, yearLevel, role, createdAt: Date.now() });
    await student.save();

    if (courseId) {
      await Enrollment.updateOne(
        { courseId, studentId: id },
        { courseId, studentId: id, enrolledAt: Date.now() },
        { upsert: true }
      );
    }
    return student.toObject();
  },

  async updateStudent(id, { studentId, name, email, yearLevel, role, courseId }) {
    const student = await Student.findOneAndUpdate({ id }, { studentId, name, email, yearLevel, role }, { new: true }).lean();
    if (courseId) {
      await Enrollment.deleteOne({ studentId: id });
      await Enrollment.create({ courseId, studentId: id, enrolledAt: Date.now() });
    }
    return student;
  },

  async deleteStudent(id) {
    await Student.deleteOne({ id });
    await Enrollment.deleteMany({ studentId: id });
    await Attendance.deleteMany({ studentId: id });
  },

  // SESSIONS
  async listSessions() {
    const sessions = await Session.find().sort({ createdAt: -1 }).lean();
    const courses = await Course.find().lean();
    const courseMap = new Map(courses.map(c => [c.id, c]));

    const attendances = await Attendance.find().lean();

    return sessions.map(s => {
      const crs = courseMap.get(s.courseId);
      const sessAtt = attendances.filter(a => a.sessionId === s.id);
      const present = sessAtt.filter(a => a.status === 'present').length;
      const late = sessAtt.filter(a => a.status === 'late').length;
      const exempted = sessAtt.filter(a => a.status === 'exempted').length;
      const absent = sessAtt.filter(a => a.status === 'absent').length;

      return {
        ...s,
        courseCode: crs ? crs.code : '',
        courseName: crs ? crs.name : '',
        courseColor: crs ? crs.color : '#8b5cf6',
        present,
        late,
        exempted,
        absent
      };
    });
  },

  async createSession({ courseId = '', title, date, startTime = '', endTime = '', room = '', notes = '', exemptRoles = [], lateFine = 0, absentFine = 0 }) {
    const id = uid('ses');
    const session = new Session({
      id, courseId, title, date, startTime, endTime, room, notes, exemptRoles, lateFine, absentFine, createdAt: Date.now()
    });
    await session.save();

    if (exemptRoles && exemptRoles.length > 0) {
      const exemptedStudents = await Student.find({ role: { $in: exemptRoles } }).lean();
      for (const st of exemptedStudents) {
        await Attendance.updateOne(
          { sessionId: id, studentId: st.id },
          { sessionId: id, studentId: st.id, status: 'exempted', scannedAt: Date.now(), excuse: `Auto-exempted (${st.role})` },
          { upsert: true }
        );
      }
    }

    return session.toObject();
  },

  async updateSession(id, { courseId, title, date, startTime, endTime, room, notes, exemptRoles, lateFine, absentFine }) {
    const session = await Session.findOneAndUpdate(
      { id },
      { courseId, title, date, startTime, endTime, room, notes, exemptRoles, lateFine, absentFine },
      { new: true }
    ).lean();

    if (exemptRoles && exemptRoles.length > 0) {
      const exemptedStudents = await Student.find({ role: { $in: exemptRoles } }).lean();
      for (const st of exemptedStudents) {
        await Attendance.updateOne(
          { sessionId: id, studentId: st.id },
          { sessionId: id, studentId: st.id, status: 'exempted', scannedAt: Date.now(), excuse: `Auto-exempted (${st.role})` },
          { upsert: true }
        );
      }
    }

    return session;
  },

  async deleteSession(id) {
    await Session.deleteOne({ id });
    await Attendance.deleteMany({ sessionId: id });
  },

  // ATTENDANCE
  async getAttendanceSheet(sessionId) {
    const session = await Session.findOne({ id: sessionId }).lean();
    if (!session) return { session: null, records: [] };

    let enrolledStudents = [];
    if (session.courseId) {
      const enrollments = await Enrollment.find({ courseId: session.courseId }).lean();
      const studentIds = enrollments.map(e => e.studentId);
      enrolledStudents = await Student.find({ id: { $in: studentIds } }).lean();
    } else {
      enrolledStudents = await Student.find().lean();
    }

    const attendances = await Attendance.find({ sessionId }).lean();
    const attMap = new Map(attendances.map(a => [a.studentId, a]));

    const records = enrolledStudents.map(st => {
      const att = attMap.get(st.id);
      return {
        studentId: st.id,
        scanId: st.studentId || '',
        name: st.name,
        email: st.email || '',
        yearLevel: st.yearLevel || '1st Year',
        role: st.role || 'Student',
        status: att ? att.status : 'unmarked',
        scannedAt: att ? att.scannedAt : null,
        excuse: att ? att.excuse || '' : ''
      };
    });

    return { session, records };
  },

  async setAttendanceStatus(sessionId, studentId, status, excuse = '') {
    await Attendance.updateOne(
      { sessionId, studentId },
      { sessionId, studentId, status, scannedAt: Date.now(), excuse },
      { upsert: true }
    );

    const student = await Student.findOne({ id: studentId }).lean();
    return {
      sessionId,
      studentId,
      status,
      scannedAt: Date.now(),
      excuse,
      studentName: student ? student.name : ''
    };
  },

  async bulkUpdateAttendance(sessionId, records) {
    for (const r of records) {
      await Attendance.updateOne(
        { sessionId, studentId: r.studentId },
        { sessionId, studentId: r.studentId, status: r.status, scannedAt: r.scannedAt || Date.now(), excuse: r.excuse || '' },
        { upsert: true }
      );
    }
  },

  // REPORTS
  async report() {
    const sessions = await this.listSessions();
    const students = await Student.find().lean();
    const attendances = await Attendance.find().lean();

    const studentReports = students.map(st => {
      const atts = attendances.filter(a => a.studentId === st.id);
      const present = atts.filter(a => a.status === 'present').length;
      const late = atts.filter(a => a.status === 'late').length;
      const exempted = atts.filter(a => a.status === 'exempted').length;
      const absent = atts.filter(a => a.status === 'absent').length;
      const unmarked = Math.max(0, sessions.length - (present + late + exempted + absent));

      let totalFines = 0;
      const sessionMap = new Map(sessions.map(s => [s.id, s]));
      atts.forEach(a => {
        const sess = sessionMap.get(a.sessionId);
        if (!sess) return;
        if (a.status === 'late') totalFines += (sess.lateFine || 0);
        else if (a.status === 'absent') totalFines += (sess.absentFine || 0);
      });

      return {
        id: st.id,
        studentId: st.studentId,
        name: st.name,
        yearLevel: st.yearLevel || '1st Year',
        role: st.role || 'Student',
        sessions: sessions.length,
        present,
        late,
        exempted,
        absent,
        unmarked,
        totalFines
      };
    });

    return { sessions, students: studentReports };
  }
};
