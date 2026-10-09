/**
 * ระบบนัดหมายผู้ป่วย รพ.สต. — Backend (Google Apps Script)
 * -----------------------------------------------------------
 * วิธีติดตั้ง (ดูละเอียดใน README.md):
 * 1. สร้าง Google Sheet ใหม่ 1 ไฟล์ แล้วเปิด Extensions > Apps Script
 * 2. วางไฟล์นี้ทับ Code.gs ที่มีอยู่
 * 3. รันฟังก์ชัน setupSheets() หนึ่งครั้ง (เมนู Run > setupSheets) เพื่อสร้างชีตและ
 *    ผู้ใช้เริ่มต้น แล้วอนุมัติสิทธิ์ที่ขอ
 * 4. Deploy > New deployment > Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    คัดลอก URL ที่ได้ไปใส่ในไฟล์ app.js (ตัวแปร API_URL)
 *
 * โครงสร้างชีตทั้งหมดถูกสร้างอัตโนมัติโดย setupSheets()
 */

const SHEET_USERS = 'Users';
const SHEET_SCHEDULE = 'Schedule';
const SHEET_SCHEDULE_SLOTS = 'ScheduleSlots';
const SHEET_CLOSED = 'ClosedDates';
const SHEET_BUSY = 'Busy';
const SHEET_APPTS = 'Appointments';
const SHEET_CLINIC_TYPES = 'ClinicTypes';
const SHEET_CLINIC_DAYS = 'ClinicDays';
const SHEET_CLINIC_RULES = 'ClinicRules';
const SHEET_SPECIAL_OPEN = 'SpecialOpen';
const SHEET_SPECIAL_SLOTS = 'SpecialOpenSlots';
const SHEET_ICD10 = 'Icd10Codes';
const SHEET_ICD9 = 'Icd9Codes';
const ICD10_AUTO_CODE = 'Z501';
const ICD9_AUTO_CODE = '9339';
const SHEET_EXTRA_SLOTS = 'ExtraSlots';
const SHEET_BUSY_RULES = 'BusyRules';

// ทะเบียนคนไข้: 1 คน = 1 แถว = 1 PTN (Physical Therapy Number) ใช้เป็นรหัสหลักผูกนัดทุกครั้งของคนเดียวกันเข้าด้วยกัน
const SHEET_PATIENTS = 'Patients';
const PATIENT_HEADERS = ['ptn', 'firstName', 'lastName', 'nationalId', 'phone', 'moo', 'createdAt', 'updatedAt'];
// รูปแบบ PTN = PTN + ปี พ.ศ. 2 หลักของปีที่มาครั้งแรก + ขีด + เลขลำดับ 4 หลักของปีนั้น เช่น PTN69-0001 = คนแรกที่มาครั้งแรกในปี 2569
// (4 หลักรองรับคนไข้ใหม่ปีละ 9,999 คน ถ้าปีไหนเกิน เลขจะยาวขึ้นเป็น 5 หลักเองโดยไม่ชนกับเลขเดิม)
// เลขลำดับเริ่มนับ 1 ใหม่ทุกปี (แบบเดียวกับ HN ของโรงพยาบาล) ปีและเลขลำดับไม่เปลี่ยนอีกตลอดไปแม้คนไข้จะมาปีถัดๆ ไป
// PTN ที่ออกด้วยรูปแบบเก่า (PT00001) หรือจำนวนหลักไม่ตรง (PTN69-00001) จะถูกแปลงเป็นรูปแบบนี้ให้อัตโนมัติเมื่อรัน setupPatients()
const PTN_PREFIX = 'PTN';
const PTN_DIGITS = 4;
const PTN_FISCAL_YEAR = false; // false = นับปีตามปฏิทิน (ม.ค.-ธ.ค.), true = นับตามปีงบประมาณ (ต.ค.-ก.ย.)

const BUSY_TYPES = ['ประชุม', 'ทำเอกสาร', 'อบรม', 'ลา'];
const APPT_TYPES = ['OPD', 'ลงชุมชน'];

/**
 * "อุ่นเครื่อง" — ให้ตั้ง trigger เรียกฟังก์ชันนี้อัตโนมัติทุก 10 นาที
 * (Triggers > Add Trigger > เลือกฟังก์ชัน keepWarm > Time-driven > Minutes timer > Every 10 minutes)
 * สิ่งที่ทำ: อ่านชีตที่แคชไว้ (ตารางเวลา วันปิด คลินิก ผู้ใช้) และคำนวณปฏิทินเดือนปัจจุบันเก็บลงแคชล่วงหน้า
 * ผู้ใช้คนแรกของแต่ละช่วงจะได้ข้อมูลจากแคชที่พร้อมอยู่แล้ว ไม่ต้องรออ่านชีตหลายแผ่นสดๆ
 * (ชื่อฟังก์ชันห้ามลงท้ายด้วย _ ไม่งั้นจะไม่ขึ้นในรายการให้เลือกตอนสร้าง trigger)
 */
function keepWarm() {
  _sheetCache_ = {};
  CACHED_SHEETS_.forEach(name => sheetData_(name));
  const now = new Date();
  getCalendar_({ year: now.getFullYear(), month: now.getMonth() + 1 });
}

/** เรียกครั้งเดียวตอนติดตั้ง เพื่อสร้างชีตทั้งหมด + ผู้ใช้เริ่มต้น */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, SHEET_USERS, ['username', 'password', 'role', 'displayName']);
  ensureSheet_(ss, SHEET_SCHEDULE, ['day', 'isOpen']);
  ensureSheet_(ss, SHEET_SCHEDULE_SLOTS, ['id', 'weekday', 'startTime', 'endTime']);
  ensureSheet_(ss, SHEET_CLOSED, ['date', 'reason']);
  ensureSheet_(ss, SHEET_BUSY, ['id', 'date', 'startTime', 'endTime', 'type', 'note']);
  ensureSheet_(ss, SHEET_APPTS, ['id', 'date', 'startTime', 'endTime', 'type', 'firstName', 'lastName', 'moo', 'phone', 'nationalId', 'note', 'createdBy', 'createdAt', 'status', 'attendedAt', 'attendedBy', 'icd10', 'icd9']);
  ensureColumns_(ss.getSheetByName(SHEET_APPTS), ['attendedAt', 'attendedBy']); // ชีตเดิมที่ติดตั้งไว้ก่อนหน้า: เพิ่มคอลัมน์ให้อัตโนมัติ
  ensureSheet_(ss, SHEET_CLINIC_TYPES, ['id', 'name', 'color']);
  ensureSheet_(ss, SHEET_CLINIC_DAYS, ['date', 'clinicTypeId', 'note']);
  ensureSheet_(ss, SHEET_CLINIC_RULES, ['id', 'clinicTypeId', 'weekday', 'nth', 'note']);
  ensureSheet_(ss, SHEET_SPECIAL_OPEN, ['date', 'note']);
  ensureSheet_(ss, SHEET_SPECIAL_SLOTS, ['id', 'date', 'startTime', 'endTime']);
  ensureSheet_(ss, SHEET_ICD10, ['id', 'code', 'label', 'isAuto']);
  ensureSheet_(ss, SHEET_ICD9, ['id', 'code', 'label', 'isAuto']);
  ensureSheet_(ss, SHEET_EXTRA_SLOTS, ['id', 'date', 'startTime', 'endTime', 'note']);
  ensureSheet_(ss, SHEET_BUSY_RULES, ['id', 'patternType', 'dayOfMonth', 'weekday', 'nth', 'startTime', 'endTime', 'type', 'note']);
  ensureColumns_(ss.getSheetByName(SHEET_APPTS), ['icd10', 'icd9']); // ชีตเดิมที่ติดตั้งไว้ก่อนหน้า: เพิ่มคอลัมน์ให้อัตโนมัติ
  ensurePatientInfra_(); // ชีตทะเบียนคนไข้ (Patients) + คอลัมน์ ptn ในชีต Appointments
  ensureApptTextColumns_(); // คอลัมน์เบอร์โทร/รหัส ICD/PTN ของชีตนัดเป็นข้อความธรรมดา

  // รหัสอัตโนมัติเริ่มต้น (แก้ไข/เพิ่ม/ลบเองได้ในหน้า "ตั้งค่า" ภายหลัง — ยกเว้นแถวนี้ที่แนะนำให้เก็บไว้)
  const icd10Sheet = ss.getSheetByName(SHEET_ICD10);
  if (icd10Sheet.getLastRow() < 2) {
    icd10Sheet.appendRow([Utilities.getUuid(), ICD10_AUTO_CODE, 'ทำกายภาพบำบัด', true]);
  }
  const icd9Sheet = ss.getSheetByName(SHEET_ICD9);
  if (icd9Sheet.getLastRow() < 2) {
    icd9Sheet.appendRow([Utilities.getUuid(), ICD9_AUTO_CODE, 'ประเมินทางกายภาพบำบัด', true]);
  }

  // ตัวอย่างประเภทคลินิก (แก้ไข/เพิ่ม/ลบเองได้ในหน้า "ตั้งค่า" ภายหลัง)
  const clinicSheet = ss.getSheetByName(SHEET_CLINIC_TYPES);
  if (clinicSheet.getLastRow() < 2) {
    clinicSheet.appendRow([Utilities.getUuid(), 'คลินิกข้อเข่า', '#2B6E63']);
    clinicSheet.appendRow([Utilities.getUuid(), 'คลินิกป้องกันล้ม', '#C97A3D']);
    clinicSheet.appendRow([Utilities.getUuid(), 'คลินิกลดปวด', '#6B5CA5']);
  }

  // ผู้ใช้เริ่มต้น (เปลี่ยนรหัสผ่านทันทีหลังติดตั้งจริง)
  const usersSheet = ss.getSheetByName(SHEET_USERS);
  if (usersSheet.getLastRow() < 2) {
    usersSheet.appendRow(['physio', 'changeme123', 'physio', 'นักกายภาพบำบัด']);
    usersSheet.appendRow(['staff', 'changeme123', 'staff', 'เจ้าหน้าที่นัดหมาย']);
  }

  // ตารางเวลาเริ่มต้น: จันทร์–ศุกร์ เปิด, เสาร์–อาทิตย์ปิด (กำหนดช่วงเวลานัดเองได้ในหน้า "ตั้งค่า")
  const schedSheet = ss.getSheetByName(SHEET_SCHEDULE);
  if (schedSheet.getLastRow() < 2) {
    const days = [
      [1, true],  // จันทร์
      [2, true],  // อังคาร
      [3, true],  // พุธ
      [4, true],  // พฤหัสบดี
      [5, true],  // ศุกร์
      [6, false], // เสาร์
      [0, false]  // อาทิตย์
    ];
    days.forEach(d => schedSheet.appendRow(d));
  }

  // ช่วงเวลาเริ่มต้นตัวอย่าง (จันทร์-ศุกร์ 08:30-16:30 ช่วงเดียว) — เข้าไปแก้เป็นช่วงเวลาที่ต้องการเองได้ในหน้า "ตั้งค่า"
  const slotsSheet = ss.getSheetByName(SHEET_SCHEDULE_SLOTS);
  if (slotsSheet.getLastRow() < 2) {
    [1, 2, 3, 4, 5].forEach(weekday => {
      slotsSheet.appendRow([Utilities.getUuid(), weekday, '08:30', '16:30']);
    });
  }

  // Secret key สำหรับเซ็น token (สร้างครั้งเดียว)
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  Logger.log('ติดตั้งเรียบร้อย! Deploy เป็น Web app ได้เลย');
}

/** เพิ่มหัวคอลัมน์ที่ยังไม่มีต่อท้ายแถวหัวตาราง (ใช้กับชีตที่ติดตั้งไว้แล้ว ไม่กระทบข้อมูลเดิม) */
function ensureColumns_(sheet, headers) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let last = row.length;
  while (last > 0 && row[last - 1] === '') last--; // ตำแหน่งหัวคอลัมน์สุดท้ายที่มีข้อความจริง
  const existing = row.slice(0, last);
  headers.forEach(h => {
    if (existing.indexOf(h) === -1) {
      sheet.getRange(1, existing.length + 1).setValue(h);
      existing.push(h);
    }
  });
}

/** เลขคอลัมน์ (เริ่มที่ 1) ของหัวคอลัมน์ที่ระบุ */
function colIndex_(sheet, header) {
  const row = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const i = row.indexOf(header);
  if (i === -1) throw new Error('ไม่พบคอลัมน์ ' + header);
  return i + 1;
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* ---------------------------- Web entry point ---------------------------- */

function doGet(e) {
  _sheetCache_ = {}; // เคลียร์แคชทุกครั้งที่มีการเรียกใหม่ (กันข้อมูลค้างข้ามคำขอ)
  try {
    const action = e.parameter.action;
    const payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
    const result = route_(action, payload);
    return output_(result, e.parameter.callback);
  } catch (err) {
    return output_({ ok: false, error: err.message }, e.parameter.callback);
  }
}

function route_(action, payload) {
  // Actions ที่ไม่ต้อง login
  if (action === 'ping') return { ok: true, data: { pong: true } }; // ใช้ปลุก/เช็คว่าสคริปต์ยัง "อุ่น" อยู่ไหม เบาที่สุดเท่าที่จะทำได้ (ไม่แตะชีตเลย)
  if (action === 'login') return login_(payload);

  // Actions ที่ต้อง login (ตรวจ token)
  const auth = verifyToken_(payload.token);
  if (!auth.ok) return { ok: false, error: 'กรุณาเข้าสู่ระบบใหม่' };

  switch (action) {
    case 'getCalendar': return getCalendar_(payload);
    case 'getDayDetail': return getDayDetail_(payload);
    case 'addAppointment': return addAppointment_(payload, auth);
    case 'cancelAppointment': return cancelAppointment_(payload, auth);
    case 'markAttended': return requirePhysio_(auth, () => markAttended_(payload, auth));
    case 'updateAppointmentIcd': return requirePhysio_(auth, () => updateAppointmentIcd_(payload));
    case 'updateAppointmentInfo': return updateAppointmentInfo_(payload);
    case 'getPatients': return getPatients_();
    case 'getPatientSummary': return getPatientSummary_(payload);

    case 'getSettingsBundle': return requirePhysio_(auth, () => getSettingsBundle_());
    case 'getSchedule': return requirePhysio_(auth, () => getSchedule_());
    case 'setSchedule': return requirePhysio_(auth, () => setSchedule_(payload));
    case 'getClosedDates': return requirePhysio_(auth, () => getClosedDates_());
    case 'addClosedDate': return requirePhysio_(auth, () => addClosedDate_(payload));
    case 'removeClosedDate': return requirePhysio_(auth, () => removeClosedDate_(payload));
    case 'addBusy': return requirePhysio_(auth, () => addBusy_(payload));
    case 'updateBusy': return requirePhysio_(auth, () => updateBusy_(payload));
    case 'removeBusy': return requirePhysio_(auth, () => removeBusy_(payload));

    case 'getIcd10Codes': return getIcd10Codes_();
    case 'addIcd10Code': return requirePhysio_(auth, () => addIcd10Code_(payload));
    case 'removeIcd10Code': return requirePhysio_(auth, () => removeIcd10Code_(payload));
    case 'getIcd9Codes': return getIcd9Codes_();
    case 'addIcd9Code': return requirePhysio_(auth, () => addIcd9Code_(payload));
    case 'removeIcd9Code': return requirePhysio_(auth, () => removeIcd9Code_(payload));

    case 'getClinicTypes': return requirePhysio_(auth, () => getClinicTypes_());
    case 'addClinicType': return requirePhysio_(auth, () => addClinicType_(payload));
    case 'removeClinicType': return requirePhysio_(auth, () => removeClinicType_(payload));
    case 'updateClinicType': return requirePhysio_(auth, () => updateClinicType_(payload));
    case 'setClinicDay': return requirePhysio_(auth, () => setClinicDay_(payload));
    case 'removeClinicDay': return requirePhysio_(auth, () => removeClinicDay_(payload));
    case 'getClinicRules': return requirePhysio_(auth, () => getClinicRules_());
    case 'getDashboard': return requirePhysio_(auth, () => getDashboard_(payload));
    case 'addClinicRule': return requirePhysio_(auth, () => addClinicRule_(payload));
    case 'removeClinicRule': return requirePhysio_(auth, () => removeClinicRule_(payload));
    case 'updateClinicRule': return requirePhysio_(auth, () => updateClinicRule_(payload));
    case 'addSpecialOpen': return requirePhysio_(auth, () => addSpecialOpen_(payload));
    case 'removeSpecialOpen': return requirePhysio_(auth, () => removeSpecialOpen_(payload));
    case 'addExtraSlot': return requirePhysio_(auth, () => addExtraSlot_(payload));
    case 'removeExtraSlot': return requirePhysio_(auth, () => removeExtraSlot_(payload));
    case 'syncHolidays': return requirePhysio_(auth, () => syncHolidays_(payload));
    case 'getBusyRules': return requirePhysio_(auth, () => getBusyRules_());
    case 'addBusyRule': return requirePhysio_(auth, () => addBusyRule_(payload));
    case 'removeBusyRule': return requirePhysio_(auth, () => removeBusyRule_(payload));

    default: return { ok: false, error: 'ไม่รู้จักคำสั่ง: ' + action };
  }
}

function requirePhysio_(auth, fn) {
  if (auth.role !== 'physio') return { ok: false, error: 'สิทธิ์ไม่พอ (เฉพาะนักกายภาพ)' };
  return fn();
}

/**
 * รันฟังก์ชันนี้ "ครั้งเดียว" จากตัวแก้ไข Apps Script (เลือก installKeepWarm จาก dropdown ข้างปุ่ม "เรียกใช้" แล้วกด Run)
 * เพื่อตั้ง time-driven trigger ให้เรียก keepWarm() (ฟังก์ชันที่มีอยู่แล้วด้านบน) ทุก 10 นาทีอัตโนมัติ
 * ไม่ต้องไปตั้งเองผ่านเมนู Triggers — ฟังก์ชันนี้สร้าง trigger ให้เสร็จในคลิกเดียว และกันไม่ให้ตั้งซ้ำถ้ารันมากกว่า 1 ครั้ง
 * (หมายเหตุ: ฟังก์ชันนี้ตั้งใจตั้งชื่อ "ไม่ลงท้ายด้วย _" เพื่อนเดียวกับ keepWarm — ฟังก์ชันที่ลงท้ายด้วย _ จะไม่โชว์ในเมนู Run/Triggers ของ Apps Script)
 */
function installKeepWarm() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'keepWarm') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(10).create();
}

function output_(obj, callback) {
  // ใช้ JSONP (ส่งกลับเป็น <script> ที่เรียก callback) เพื่อเลี่ยงข้อจำกัด CORS
  // ของ Apps Script เวลาเรียกจากเว็บที่อยู่คนละโดเมน (เช่น GitHub Pages)
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------- Auth ---------------------------- */

function login_(payload) {
  const rows = sheetData_(SHEET_USERS);
  const u = rows.find(r => r.username === payload.username && r.password === payload.password);
  if (!u) return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };

  const exp = Date.now() + 1000 * 60 * 60 * 12; // token อายุ 12 ชม.
  const raw = `${u.username}|${u.role}|${exp}`;
  const sig = sign_(raw);
  return {
    ok: true,
    token: `${raw}|${sig}`,
    role: u.role,
    displayName: u.displayName
  };
}

function sign_(raw) {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  const bytes = Utilities.computeHmacSha256Signature(raw, secret);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function verifyToken_(token) {
  if (!token) return { ok: false };
  const parts = token.split('|');
  if (parts.length !== 4) return { ok: false };
  const [username, role, exp, sig] = parts;
  const raw = `${username}|${role}|${exp}`;
  if (sign_(raw) !== sig) return { ok: false };
  if (Date.now() > Number(exp)) return { ok: false };
  return { ok: true, username, role };
}

/* ---------------------------- Sheet helpers ---------------------------- */

let _sheetCache_ = {};
const CACHED_SHEETS_ = [SHEET_SCHEDULE, SHEET_SCHEDULE_SLOTS, SHEET_CLOSED, SHEET_USERS, SHEET_CLINIC_TYPES, SHEET_CLINIC_DAYS, SHEET_CLINIC_RULES, SHEET_SPECIAL_OPEN, SHEET_SPECIAL_SLOTS, SHEET_ICD10, SHEET_ICD9, SHEET_EXTRA_SLOTS, SHEET_BUSY_RULES]; // ชีตที่เปลี่ยนไม่บ่อย เก็บแคชข้ามคำขอได้เพื่อความเร็ว
const CACHE_TTL_SEC_ = 1800; // 30 นาที (ข้อมูลกลุ่มนี้เปลี่ยนไม่บ่อย และมีการล้างแคชทันทีทุกครั้งที่มีการแก้ไขอยู่แล้ว)

function sheetData_(name) {
  if (_sheetCache_[name]) return _sheetCache_[name]; // ลดการอ่านชีตซ้ำภายในคำขอเดียวกัน

  let data = null;
  const useServerCache = CACHED_SHEETS_.indexOf(name) !== -1;
  if (useServerCache) {
    try {
      const cached = CacheService.getScriptCache().get('sheet_' + name);
      if (cached) data = JSON.parse(cached);
    } catch (e) { /* แคชใช้ไม่ได้ก็อ่านจากชีตตามปกติ */ }
  }

  if (!data) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    const values = sheet.getDataRange().getValues();
    const headers = values.shift();
    const TIME_FIELDS = ['openTime', 'closeTime', 'startTime', 'endTime'];
    data = values.map((row, i) => {
      const obj = {};
      headers.forEach((h, idx) => {
        let v = row[idx];
        // Google Sheets มักแปลงข้อความเวลาเช่น "08:30" ให้กลายเป็นค่า Date ให้เองอัตโนมัติ
        // ต้องแปลงกลับเป็นข้อความ "HH:mm" ทุกครั้งที่อ่าน มิเช่นนั้นโค้ดคำนวณช่วงเวลาจะพัง
        if (TIME_FIELDS.indexOf(h) !== -1 && v instanceof Date) {
          v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
        }
        obj[h] = v;
      });
      obj._row = i + 2; // เลขแถวจริงในชีต (1 = header)
      return obj;
    });
    if (useServerCache) {
      try { CacheService.getScriptCache().put('sheet_' + name, JSON.stringify(data), CACHE_TTL_SEC_); } catch (e) { /* ข้อมูลใหญ่เกินแคชได้ก็ข้ามไป */ }
    }
  }

  _sheetCache_[name] = data;
  return data;
}

function invalidateCache_(name) {
  delete _sheetCache_[name];
  if (CACHED_SHEETS_.indexOf(name) !== -1) {
    try { CacheService.getScriptCache().remove('sheet_' + name); } catch (e) { /* ไม่เป็นไร */ }
  }
}

function appendRow_(name, obj, headers) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  sheet.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
  invalidateCache_(name);
}

/** เพิ่มแถวโดยวางค่าตาม "หัวคอลัมน์จริงในชีต" (ไม่อิงลำดับตายตัว) — ใช้กับชีตที่มีการเพิ่มคอลัมน์ภายหลัง เช่น ptn */
function appendRowByHeaders_(name, obj) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  sheet.appendRow(headers.map(h => (h !== '' && obj[h] !== undefined) ? obj[h] : ''));
  invalidateCache_(name);
}

function deleteRow_(name, rowIndex) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name).deleteRow(rowIndex);
  invalidateCache_(name);
}

function fmtDate_(d) {
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ---------------------------- วันหยุดราชการ (sync) ---------------------------- */
// ดึงจาก "ไฟล์ ICS สาธารณะ" ของปฏิทินวันหยุดไทยของ Google โดยตรงผ่าน UrlFetchApp
// (ไม่ใช้ CalendarApp.getCalendarById เพราะวิธีนั้นต้องให้บัญชีเจ้าของสเปรดชีต "สมัครรับ" ปฏิทินนั้นไว้ก่อนเท่านั้นถึงจะหาเจอ
//  ทำให้สับสน/พังง่ายถ้าใช้คนละบัญชีหรือยังไม่เคยเพิ่ม ส่วนไฟล์ ICS สาธารณะเปิดอ่านได้เลยไม่ต้องสมัครรับ)

function parseIcsHolidayEvents_(icsText) {
  const events = [];
  const blocks = icsText.split('BEGIN:VEVENT').slice(1);
  blocks.forEach(block => {
    const dateMatch = block.match(/DTSTART;VALUE=DATE:(\d{8})/);
    const summaryMatch = block.match(/SUMMARY:(.*)/);
    if (!dateMatch) return;
    const raw = dateMatch[1]; // YYYYMMDD
    const dateStr = raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
    const title = summaryMatch ? summaryMatch[1].trim().replace(/\\,/g, ',') : 'วันหยุดราชการ';
    events.push({ date: dateStr, title: title });
  });
  return events;
}

function syncHolidays_(payload) {
  const year = Number(payload && payload.year) || new Date().getFullYear();
  const icsUrl = 'https://calendar.google.com/calendar/ical/en.thai%23holiday%40group.v.calendar.google.com/public/basic.ics';
  // บาง endpoint ของ Google เองก็บล็อก request ที่ขึ้น User-Agent เป็น "Google-Apps-Script" แบบ default
  // ใส่ User-Agent แบบเบราว์เซอร์ทั่วไปไปด้วยเพื่อเลี่ยงการถูกบล็อก และลองซ้ำ 1 ครั้งเผื่อเป็นปัญหาชั่วคราว (เช่น 500)
  const fetchOpts = {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  };
  let allEvents;
  try {
    let resp = UrlFetchApp.fetch(icsUrl, fetchOpts);
    if (resp.getResponseCode() >= 500) {
      Utilities.sleep(1000);
      resp = UrlFetchApp.fetch(icsUrl, fetchOpts); // ลองซ้ำอีก 1 ครั้งเผื่อเป็นปัญหาชั่วคราวฝั่งเซิร์ฟเวอร์
    }
    if (resp.getResponseCode() !== 200) throw new Error('HTTP ' + resp.getResponseCode());
    allEvents = parseIcsHolidayEvents_(resp.getContentText());
  } catch (e) {
    return { ok: false, error: 'เชื่อมต่อปฏิทินวันหยุดราชการไม่สำเร็จ (' + e.message + ')' };
  }
  const events = allEvents.filter(ev => ev.date.indexOf(String(year)) === 0);

  const existingDates = sheetData_(SHEET_CLOSED).map(r => fmtDate_(r.date));
  const seen = {};
  const toAdd = events.filter(ev => {
    if (existingDates.indexOf(ev.date) !== -1) return false; // มีอยู่แล้วในชีต
    if (seen[ev.date]) return false; // กันกรณี ICS มีวันซ้ำ (เช่นสงกรานต์หลายรายการ)
    seen[ev.date] = true;
    return true;
  });

  // เขียนทีเดียวเป็นแถวต่อเนื่อง (ไม่ loop เขียนทีละแถว) เพื่อความเร็ว — ลด API call จาก N ครั้งเหลือครั้งเดียว
  if (toAdd.length) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLOSED);
    const startRow = sheet.getLastRow() + 1;
    const values = toAdd.map(ev => [ev.date, ev.title]);
    sheet.getRange(startRow, 1, values.length, 2).setValues(values);
    invalidateCache_(SHEET_CLOSED);
    bumpCalendarVersion_();
  }
  const added = toAdd.length;
  return { ok: true, added: added, totalFound: events.length, year: year };
}

/* ---------------------------- Schedule ---------------------------- */

/**
 * รวมข้อมูลตั้งต้นทั้งหมดของหน้า "ตั้งค่า" ไว้ในคำขอเดียว (แทนที่จะแยกยิง 7 คำขอ)
 * เพราะข้อมูลแต่ละชุดถูกอ่านจากแคช/ชีตแบบเบาอยู่แล้ว ส่วนที่หนักจริงๆ คือค่าใช้จ่ายในการ "ยิงคำขอ" แต่ละครั้งไปกลับ
 * (การเชื่อมต่อ Apps Script Web App แต่ละครั้งมีค่าใช้จ่ายคงที่พอสมควร) รวมเป็นคำขอเดียวจึงเร็วขึ้นมากตอนเปิดหน้านี้ครั้งแรก
 */
function getSettingsBundle_() {
  return {
    ok: true,
    data: {
      schedule: getSchedule_().data,
      closedDates: getClosedDates_().data,
      clinicTypes: getClinicTypes_().data,
      clinicRules: getClinicRules_().data,
      icd10: getIcd10Codes_().data,
      icd9: getIcd9Codes_().data,
      busyRules: getBusyRules_().data
    }
  };
}

function getSchedule_() {
  return {
    ok: true,
    data: {
      days: sheetData_(SHEET_SCHEDULE),
      slots: sheetData_(SHEET_SCHEDULE_SLOTS)
    }
  };
}

/**
 * บันทึกตารางเวลาทั้งหมดใหม่ทีเดียว (ทั้งวันเปิด-ปิด และรายการช่วงเวลาแบบกำหนดเอง)
 * payload.days = [{day, isOpen}, ...]
 * payload.slots = [{weekday, start, end}, ...] — รายการช่วงเวลาทั้งหมดของทุกวัน (แทนที่ของเก่าทั้งชุด)
 */
function setSchedule_(payload) {
  // กันข้อมูลเพี้ยน: ช่วงเวลาที่เวลาสิ้นสุด "ไม่มากกว่า" เวลาเริ่ม (เช่น เผลอเลื่อนนาฬิกาเกินเที่ยงคืนไปเป็น 00:00) ห้ามบันทึก
  // เพราะจะทำให้ระบบเทียบเวลาทับซ้อนผิดพลาดไปทั้งหมด (ช่องที่ควรปิดจะกลายเป็นว่างแทน) — เคยเกิดปัญหานี้มาแล้วจริง
  const badSlot = (payload.slots || []).find(s => !s.start || !s.end || s.start >= s.end);
  if (badSlot) {
    return { ok: false, error: `ช่วงเวลา "${badSlot.start || '?'}-${badSlot.end || '?'}" ไม่ถูกต้อง (เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม) กรุณาตรวจสอบและแก้ไขก่อนบันทึก` };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCHEDULE);
  const rows = sheetData_(SHEET_SCHEDULE); // อ่านครั้งเดียว ไม่อ่านซ้ำในลูป (จุดที่ทำให้ช้า)
  (payload.days || []).forEach(d => {
    const match = rows.find(r => Number(r.day) === Number(d.day));
    if (!match) return;
    sheet.getRange(match._row, 1, 1, 2).setValues([[d.day, d.isOpen]]);
  });
  invalidateCache_(SHEET_SCHEDULE);

  // แทนที่รายการช่วงเวลาทั้งหมดใหม่ทั้งชีต (ลบของเก่าทิ้งแล้วเขียนใหม่ทั้งหมด ง่ายและชัวร์กว่าการไล่ upsert ทีละแถว)
  const slotsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCHEDULE_SLOTS);
  const lastRow = slotsSheet.getLastRow();
  if (lastRow > 1) slotsSheet.getRange(2, 1, lastRow - 1, slotsSheet.getLastColumn()).clearContent();
  const slotRows = (payload.slots || []).map(s => [Utilities.getUuid(), s.weekday, s.start, s.end]);
  if (slotRows.length) slotsSheet.getRange(2, 1, slotRows.length, 4).setValues(slotRows);
  invalidateCache_(SHEET_SCHEDULE_SLOTS);

  bumpCalendarVersion_();
  return { ok: true };
}

/* ---------------------------- Closed dates ---------------------------- */

function getClosedDates_() {
  return { ok: true, data: sheetData_(SHEET_CLOSED).map(r => ({ ...r, date: fmtDate_(r.date) })) };
}

function addClosedDate_(payload) {
  appendRow_(SHEET_CLOSED, { date: payload.date, reason: payload.reason || '' }, ['date', 'reason']);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeClosedDate_(payload) {
  const rows = sheetData_(SHEET_CLOSED);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) deleteRow_(SHEET_CLOSED, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/* ---------------------------- Busy (นักกายภาพไม่ว่าง) ---------------------------- */

function addBusy_(payload) {
  if (!payload.startTime || !payload.endTime || payload.startTime >= payload.endTime) {
    return { ok: false, error: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด กรุณาตรวจสอบเวลาที่กรอก' };
  }
  appendRow_(SHEET_BUSY, {
    id: Utilities.getUuid(),
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    type: payload.type,
    note: payload.note || ''
  }, ['id', 'date', 'startTime', 'endTime', 'type', 'note']);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeBusy_(payload) {
  const rows = sheetData_(SHEET_BUSY);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_BUSY, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/** แก้ไขช่วงไม่ว่างที่เพิ่มไว้แล้ว (payload: {id, date, startTime, endTime, type, note}) — รายการที่มาจาก "กฎอัตโนมัติ" แก้ตรงนี้ไม่ได้ ต้องไปแก้ที่หน้าตั้งค่า */
function updateBusy_(payload) {
  if (!payload.id) return { ok: false, error: 'ไม่พบรายการที่จะแก้ไข' };
  if (!payload.startTime || !payload.endTime || payload.startTime >= payload.endTime) {
    return { ok: false, error: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด กรุณาตรวจสอบเวลาที่กรอก' };
  }
  const rows = sheetData_(SHEET_BUSY);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบรายการที่จะแก้ไข (อาจถูกลบไปแล้ว)' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BUSY);
  sheet.getRange(match._row, colIndex_(sheet, 'date')).setValue(payload.date);
  sheet.getRange(match._row, colIndex_(sheet, 'startTime')).setValue(payload.startTime);
  sheet.getRange(match._row, colIndex_(sheet, 'endTime')).setValue(payload.endTime);
  sheet.getRange(match._row, colIndex_(sheet, 'type')).setValue(payload.type);
  sheet.getRange(match._row, colIndex_(sheet, 'note')).setValue(payload.note || '');
  invalidateCache_(SHEET_BUSY);
  bumpCalendarVersion_();
  return { ok: true };
}

/* ---------------------------- ประเภทคลินิกประจำวัน ---------------------------- */

function getClinicTypes_() {
  return { ok: true, data: sheetData_(SHEET_CLINIC_TYPES) };
}

function addClinicType_(payload) {
  if (!payload.name) return { ok: false, error: 'กรุณากรอกชื่อคลินิก' };
  appendRow_(SHEET_CLINIC_TYPES, {
    id: Utilities.getUuid(),
    name: payload.name,
    color: payload.color || '#2B6E63'
  }, ['id', 'name', 'color']);
  bumpCalendarVersion_();
  return { ok: true };
}

/** แก้ไขชื่อ/สีของประเภทคลินิก (id เดิม จึงไม่กระทบวันที่/กฎที่ผูกไว้) */
function updateClinicType_(payload) {
  if (!payload.id) return { ok: false, error: 'ไม่พบคลินิกที่จะแก้ไข' };
  if (!payload.name) return { ok: false, error: 'กรุณากรอกชื่อคลินิก' };
  const match = sheetData_(SHEET_CLINIC_TYPES).find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบคลินิกที่จะแก้ไข (อาจถูกลบไปแล้ว)' };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLINIC_TYPES);
  sheet.getRange(match._row, colIndex_(sheet, 'name')).setValue(payload.name);
  sheet.getRange(match._row, colIndex_(sheet, 'color')).setValue(payload.color || '#2B6E63');
  invalidateCache_(SHEET_CLINIC_TYPES);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeClinicType_(payload) {
  const rows = sheetData_(SHEET_CLINIC_TYPES);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_CLINIC_TYPES, match._row);
  // ลบการกำหนดวันที่/กฎอัตโนมัติที่ผูกกับคลินิกนี้ทิ้งไปด้วย จะได้ไม่มีข้อมูลค้าง
  const dayRows = sheetData_(SHEET_CLINIC_DAYS).filter(r => r.clinicTypeId === payload.id);
  dayRows.sort((a, b) => b._row - a._row).forEach(r => deleteRow_(SHEET_CLINIC_DAYS, r._row));
  const ruleRows = sheetData_(SHEET_CLINIC_RULES).filter(r => r.clinicTypeId === payload.id);
  ruleRows.sort((a, b) => b._row - a._row).forEach(r => deleteRow_(SHEET_CLINIC_RULES, r._row));
  bumpCalendarVersion_();
  return { ok: true };
}

/** กำหนด/แก้ไขคลินิกประจำวันนั้น (upsert ตามวันที่) clinicTypeId เป็น '__NONE__' ได้ เพื่อบังคับ "ไม่มีคลินิก" เฉพาะวันนี้ แม้จะมีกฎอัตโนมัติตรงกันก็ตาม */
function setClinicDay_(payload) {
  if (!payload.date || !payload.clinicTypeId) return { ok: false, error: 'ข้อมูลไม่ครบ' };
  const rows = sheetData_(SHEET_CLINIC_DAYS);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLINIC_DAYS);
    sheet.getRange(match._row, 1, 1, 3).setValues([[payload.date, payload.clinicTypeId, payload.note || '']]);
    invalidateCache_(SHEET_CLINIC_DAYS);
  } else {
    appendRow_(SHEET_CLINIC_DAYS, { date: payload.date, clinicTypeId: payload.clinicTypeId, note: payload.note || '' }, ['date', 'clinicTypeId', 'note']);
  }
  bumpCalendarVersion_();
  return { ok: true };
}

function removeClinicDay_(payload) {
  const rows = sheetData_(SHEET_CLINIC_DAYS);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) deleteRow_(SHEET_CLINIC_DAYS, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/* ---------------------------- กฎคลินิกอัตโนมัติ (ตามวันในสัปดาห์/เดือน) ---------------------------- */
// เช่น "คลินิกป้องกันล้ม ทุกวันอังคารที่ 4 ของเดือน" — ตั้งครั้งเดียว ระบบคำนวณให้ทุกเดือนเอง
// nth: 'every' = ทุกสัปดาห์, '1'-'4' = สัปดาห์ที่ 1-4 ของเดือน, 'last' = สัปดาห์สุดท้ายของเดือน

function getClinicRules_() {
  return { ok: true, data: sheetData_(SHEET_CLINIC_RULES) };
}

function addClinicRule_(payload) {
  if (!payload.clinicTypeId || payload.weekday === undefined || !payload.nth) {
    return { ok: false, error: 'ข้อมูลไม่ครบ' };
  }
  appendRow_(SHEET_CLINIC_RULES, {
    id: Utilities.getUuid(),
    clinicTypeId: payload.clinicTypeId,
    weekday: payload.weekday,
    nth: payload.nth,
    note: payload.note || ''
  }, ['id', 'clinicTypeId', 'weekday', 'nth', 'note']);
  bumpCalendarVersion_();
  return { ok: true };
}

/** แก้ไขกฎคลินิกอัตโนมัติ (เปลี่ยนคลินิก/วัน/สัปดาห์ที่/note) */
function updateClinicRule_(payload) {
  if (!payload.id) return { ok: false, error: 'ไม่พบกฎที่จะแก้ไข' };
  if (!payload.clinicTypeId || payload.weekday === undefined || !payload.nth) return { ok: false, error: 'ข้อมูลไม่ครบ' };
  const match = sheetData_(SHEET_CLINIC_RULES).find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบกฎที่จะแก้ไข (อาจถูกลบไปแล้ว)' };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLINIC_RULES);
  sheet.getRange(match._row, colIndex_(sheet, 'clinicTypeId')).setValue(payload.clinicTypeId);
  sheet.getRange(match._row, colIndex_(sheet, 'weekday')).setValue(payload.weekday);
  sheet.getRange(match._row, colIndex_(sheet, 'nth')).setValue(payload.nth);
  sheet.getRange(match._row, colIndex_(sheet, 'note')).setValue(payload.note || '');
  invalidateCache_(SHEET_CLINIC_RULES);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeClinicRule_(payload) {
  const rows = sheetData_(SHEET_CLINIC_RULES);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_CLINIC_RULES, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/** หาว่าวันที่นี้เป็น "ครั้งที่เท่าไหร่" ของวันในสัปดาห์นั้น ภายในเดือน และเป็นครั้งสุดท้ายหรือไม่ */
function weekdayOccurrenceInfo_(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dayOfMonth = d.getDate();
  const occurrence = Math.floor((dayOfMonth - 1) / 7) + 1; // ครั้งที่ 1-5 ของวันในสัปดาห์นี้ภายในเดือน
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const isLast = (dayOfMonth + 7) > daysInMonth;
  return { weekday: d.getDay(), occurrence, isLast };
}

/**
 * หาคลินิกที่ควรแสดงสำหรับวันที่นี้ เรียงลำดับความสำคัญ:
 * 1) กำหนดไว้เฉพาะวันนั้นตรงๆ (ClinicDays) — override กฎอัตโนมัติเสมอ
 * 2) กฎอัตโนมัติ (ClinicRules) ที่ตรงกับวันในสัปดาห์ + ครั้งที่ในเดือน
 */
function resolveClinicForDate_(dateStr) {
  const clinicDay = sheetData_(SHEET_CLINIC_DAYS).find(r => fmtDate_(r.date) === dateStr);
  if (clinicDay) {
    if (clinicDay.clinicTypeId === '__NONE__') return null; // บังคับ "ไม่มีคลินิก" เฉพาะวันนี้ แม้มีกฎอัตโนมัติตรงกัน
    const type = sheetData_(SHEET_CLINIC_TYPES).find(c => c.id === clinicDay.clinicTypeId);
    return type ? { id: type.id, name: type.name, color: type.color, note: clinicDay.note, fromRule: false } : null;
  }

  const info = weekdayOccurrenceInfo_(dateStr);
  const rules = sheetData_(SHEET_CLINIC_RULES).filter(r => Number(r.weekday) === info.weekday);
  const match = rules.find(r =>
    r.nth === 'every' ||
    String(r.nth) === String(info.occurrence) ||
    (r.nth === 'last' && info.isLast)
  );
  if (match) {
    const type = sheetData_(SHEET_CLINIC_TYPES).find(c => c.id === match.clinicTypeId);
    return type ? { id: type.id, name: type.name, color: type.color, note: match.note || '', fromRule: true } : null;
  }
  return null;
}

/* ---------------------------- เปิดรับพิเศษ (override วันที่ปกติปิด) ---------------------------- */

/** payload.slots = [{start, end}, ...] — รายการช่วงเวลาที่กำหนดเองสำหรับวันนี้วันเดียว */
function addSpecialOpen_(payload) {
  if (!payload.date || !payload.slots || !payload.slots.length) return { ok: false, error: 'กรุณาระบุช่วงเวลาอย่างน้อย 1 ช่วง' };
  const badSlot = payload.slots.find(s => !s.start || !s.end || s.start >= s.end);
  if (badSlot) return { ok: false, error: `ช่วงเวลา "${badSlot.start || '?'}-${badSlot.end || '?'}" ไม่ถูกต้อง (เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม)` };

  // upsert แถวหลัก (date, note)
  const rows = sheetData_(SHEET_SPECIAL_OPEN);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SPECIAL_OPEN);
    sheet.getRange(match._row, 1, 1, 2).setValues([[payload.date, payload.note || '']]);
    invalidateCache_(SHEET_SPECIAL_OPEN);
  } else {
    appendRow_(SHEET_SPECIAL_OPEN, { date: payload.date, note: payload.note || '' }, ['date', 'note']);
  }

  // แทนที่ช่วงเวลาของวันนี้ใหม่ทั้งหมด (ลบของเดิมทิ้งก่อนแล้วค่อยเพิ่มใหม่)
  const existingSlots = sheetData_(SHEET_SPECIAL_SLOTS).filter(r => fmtDate_(r.date) === payload.date);
  existingSlots.sort((a, b) => b._row - a._row).forEach(r => deleteRow_(SHEET_SPECIAL_SLOTS, r._row));
  payload.slots.forEach(s => {
    appendRow_(SHEET_SPECIAL_SLOTS, { id: Utilities.getUuid(), date: payload.date, startTime: s.start, endTime: s.end }, ['id', 'date', 'startTime', 'endTime']);
  });

  bumpCalendarVersion_();
  return { ok: true };
}

function removeSpecialOpen_(payload) {
  const rows = sheetData_(SHEET_SPECIAL_OPEN);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) deleteRow_(SHEET_SPECIAL_OPEN, match._row);
  const slotRows = sheetData_(SHEET_SPECIAL_SLOTS).filter(r => fmtDate_(r.date) === payload.date);
  slotRows.sort((a, b) => b._row - a._row).forEach(r => deleteRow_(SHEET_SPECIAL_SLOTS, r._row));
  bumpCalendarVersion_();
  return { ok: true };
}

/**
 * หาว่าวันที่ที่กำหนด "เปิด/ปิด" จริงๆ และมีช่วงเวลาอะไรบ้าง โดยเรียงลำดับความสำคัญ:
 * 1) เปิดรับพิเศษ (SpecialOpen) — override ทุกอย่าง แม้วันนั้นจะปิดตามตารางประจำสัปดาห์
 * 2) วันปิดเฉพาะกิจ/วันหยุด (ClosedDates)
 * 3) ตารางเวลาเปิด-ปิดประจำสัปดาห์ (Schedule + ScheduleSlots)
 * คืนค่า slotDefs = [{start, end}, ...] เรียงตามเวลา — ช่วงเวลาที่กำหนดเองไว้ ไม่ใช่การหารเท่าๆ กัน
 */
function resolveDayOpen_(date) {
  const sortSlots = arr => arr.slice().sort((a, b) => a.start < b.start ? -1 : (a.start > b.start ? 1 : 0));
  const dedupe = arr => { const seen = {}; return arr.filter(s => { const k = s.start + '-' + s.end; if (seen[k]) return false; seen[k] = true; return true; }); };

  let base;
  const special = sheetData_(SHEET_SPECIAL_OPEN).find(r => fmtDate_(r.date) === date);
  if (special) {
    const slotDefs = sheetData_(SHEET_SPECIAL_SLOTS)
      .filter(r => fmtDate_(r.date) === date)
      .map(r => ({ start: r.startTime, end: r.endTime }));
    base = { isOpen: true, slotDefs, source: 'special', note: special.note };
  } else {
    const closedRow = sheetData_(SHEET_CLOSED).find(r => fmtDate_(r.date) === date);
    if (closedRow) {
      base = { isOpen: false, reason: closedRow.reason, source: 'closed' };
    } else {
      const dow = new Date(date + 'T00:00:00').getDay();
      const sched = sheetData_(SHEET_SCHEDULE).find(r => Number(r.day) === dow);
      if (sched && sched.isOpen === true) {
        const slotDefs = sheetData_(SHEET_SCHEDULE_SLOTS)
          .filter(r => Number(r.weekday) === dow)
          .map(r => ({ start: r.startTime, end: r.endTime }));
        base = { isOpen: true, slotDefs, source: 'weekly' };
      } else {
        base = { isOpen: false, source: 'weekly' };
      }
    }
  }

  // กฎปิดอัตโนมัติตามวันที่ในเดือน (เช่น ปิดทั้งวันทุกวันสิ้นเดือน) — มีผลเหนือตารางประจำสัปดาห์ แต่ไม่เหนือ "เปิดรับพิเศษ"
  if (base.source !== 'special') {
    const recurringReason = getRecurringClosedReason_(date);
    if (recurringReason && base.isOpen) {
      base = { isOpen: false, reason: recurringReason, source: 'recurringClosed' };
    }
  }

  // ช่วงเวลาพิเศษเสริม (ExtraSlots) — เพิ่มเติมเข้าไปจากตารางปกติเฉพาะวันนั้นวันเดียว ไม่ไปแก้ตารางประจำสัปดาห์
  // ถ้าวันนั้นปิดอยู่ แต่มีการเพิ่มช่วงเวลาพิเศษไว้ ให้ถือว่าเปิดเฉพาะช่วงที่เพิ่มนั้น
  const extra = sheetData_(SHEET_EXTRA_SLOTS)
    .filter(r => fmtDate_(r.date) === date)
    .map(r => ({ start: r.startTime, end: r.endTime }));
  if (extra.length) {
    const merged = sortSlots(dedupe((base.isOpen ? base.slotDefs : []).concat(extra)));
    return Object.assign({}, base, { isOpen: true, slotDefs: merged, hasExtraSlots: true });
  }
  if (base.isOpen) base.slotDefs = sortSlots(base.slotDefs);
  return base;
}

/* ---------------------------- ปิด/ไม่ว่างอัตโนมัติ (ตามวันที่ในเดือน) ---------------------------- */
// ต่างจาก ClinicRules (ตามวันในสัปดาห์) ตรงนี้ยึดตาม "วันที่" ของเดือน เช่น วันที่ 1, วันสุดท้ายของเดือน
// dayOfMonth: '1'-'31' หรือ 'last' (วันสุดท้ายของเดือนนั้นๆ)
// ถ้าไม่ระบุ startTime/endTime (ว่างทั้งคู่) = ปิดทั้งวัน; ถ้าระบุ = บล็อกเฉพาะช่วงเวลานั้น (เหมือนตั้งไม่ว่าง)

function getBusyRules_() {
  return { ok: true, data: sheetData_(SHEET_BUSY_RULES) };
}

function addBusyRule_(payload) {
  const patternType = payload.patternType === 'weekday' ? 'weekday' : 'dom';
  if (patternType === 'dom' && !payload.dayOfMonth) return { ok: false, error: 'กรุณาระบุวันที่ในเดือน' };
  if (patternType === 'weekday' && (payload.weekday === undefined || payload.weekday === '' || !payload.nth)) {
    return { ok: false, error: 'กรุณาระบุวันในสัปดาห์และความถี่' };
  }
  const hasRange = payload.startTime && payload.endTime;
  if (hasRange && payload.startTime >= payload.endTime) return { ok: false, error: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด' };
  appendRow_(SHEET_BUSY_RULES, {
    id: Utilities.getUuid(),
    patternType: patternType,
    dayOfMonth: patternType === 'dom' ? payload.dayOfMonth : '',
    weekday: patternType === 'weekday' ? payload.weekday : '',
    nth: patternType === 'weekday' ? payload.nth : '',
    startTime: hasRange ? payload.startTime : '',
    endTime: hasRange ? payload.endTime : '',
    type: payload.type || 'ประชุม',
    note: payload.note || ''
  }, ['id', 'patternType', 'dayOfMonth', 'weekday', 'nth', 'startTime', 'endTime', 'type', 'note']);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeBusyRule_(payload) {
  const rows = sheetData_(SHEET_BUSY_RULES);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_BUSY_RULES, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/** วันที่นี้ตรงกับเงื่อนไข "วันที่ X ของเดือน" หรือ "วันสุดท้ายของเดือน" หรือไม่ */
function matchesDayOfMonth_(ruleValue, dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (String(ruleValue) === 'last') {
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === daysInMonth;
  }
  return Number(ruleValue) === d.getDate();
}

/** วันที่นี้ตรงกับกฎหรือไม่ รองรับทั้งแบบ "วันที่ X ในเดือน" (dom) และ "วันในสัปดาห์ + ความถี่" (weekday) เหมือนกฎคลินิกอัตโนมัติ */
function matchesBusyRule_(rule, dateStr) {
  if (rule.patternType === 'weekday') {
    const info = weekdayOccurrenceInfo_(dateStr);
    if (Number(rule.weekday) !== info.weekday) return false;
    return rule.nth === 'every' || String(rule.nth) === String(info.occurrence) || (rule.nth === 'last' && info.isLast);
  }
  return matchesDayOfMonth_(rule.dayOfMonth, dateStr);
}

/** เหตุผลวันปิดทั้งวันจากกฎอัตโนมัติ (ถ้ามีมากกว่า 1 กฎตรงกัน จะรวมข้อความ) หรือ null ถ้าไม่มี */
function getRecurringClosedReason_(dateStr) {
  const rules = sheetData_(SHEET_BUSY_RULES).filter(r => !r.startTime && matchesBusyRule_(r, dateStr));
  if (!rules.length) return null;
  return rules.map(r => r.note || r.type || 'ปิดประจำเดือน').join(', ');
}

/** ช่วงเวลาไม่ว่างจากกฎอัตโนมัติที่ตรงกับวันนี้ (รูปแบบเดียวกับแถวในชีต Busy) */
function getRecurringBusyBlocks_(dateStr) {
  return sheetData_(SHEET_BUSY_RULES)
    .filter(r => r.startTime && r.endTime && matchesBusyRule_(r, dateStr))
    .map(r => ({ id: 'rule-' + r.id, date: dateStr, startTime: r.startTime, endTime: r.endTime, type: r.type || 'ประชุม', note: r.note || '' }));
}

/** รวม Busy ของวันนั้น (ที่เพิ่มเองรายวัน) เข้ากับ Busy จากกฎอัตโนมัติ */
function getBusyForDate_(dateStr) {
  const direct = sheetData_(SHEET_BUSY).filter(r => fmtDate_(r.date) === dateStr);
  return direct.concat(getRecurringBusyBlocks_(dateStr));
}

/* ---------------------------- ช่วงเวลาพิเศษเสริม (เฉพาะวันเดียว) ---------------------------- */
// ต่างจาก "เปิดรับพิเศษ" ตรงที่นี่คือ "เพิ่ม" ช่วงเวลาเข้าไปจากของเดิมที่มีอยู่แล้ว ไม่ใช่การเปิดวันทั้งวันใหม่

function addExtraSlot_(payload) {
  if (!payload.date || !payload.start || !payload.end) return { ok: false, error: 'กรุณาระบุวันที่และช่วงเวลา' };
  if (payload.start >= payload.end) return { ok: false, error: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด' };
  appendRow_(SHEET_EXTRA_SLOTS, {
    id: Utilities.getUuid(), date: payload.date, startTime: payload.start, endTime: payload.end, note: payload.note || ''
  }, ['id', 'date', 'startTime', 'endTime', 'note']);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeExtraSlot_(payload) {
  const rows = sheetData_(SHEET_EXTRA_SLOTS);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_EXTRA_SLOTS, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/** แก้ไข/เพิ่มรหัส ICD ของนัดที่บันทึกไปแล้ว (payload: {id, icd10:[], icd9:[]}) — ทำได้แม้นัดนั้นผ่านไปแล้วหรือมาแล้ว ยกเว้นนัดที่ถูกยกเลิก */
function updateAppointmentIcd_(payload) {
  const rows = sheetData_(SHEET_APPTS);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบนัดหมายนี้' };
  if (match.status !== 'active') return { ok: false, error: 'นัดนี้ถูกยกเลิกแล้ว แก้ไขรหัส ICD ไม่ได้' };

  let icd10 = Array.isArray(payload.icd10) ? payload.icd10.filter(Boolean) : [];
  if (icd10.indexOf(ICD10_AUTO_CODE) === -1) icd10.unshift(ICD10_AUTO_CODE);
  icd10 = [...new Set(icd10)];
  if (icd10.length > 2) return { ok: false, error: 'ระบุรหัส ICD-10 ได้ไม่เกิน 2 รหัส' };

  let icd9 = Array.isArray(payload.icd9) ? payload.icd9.filter(Boolean) : [];
  if (icd9.indexOf(ICD9_AUTO_CODE) === -1) icd9.unshift(ICD9_AUTO_CODE);
  icd9 = [...new Set(icd9)];
  if (icd9.length > 6) return { ok: false, error: 'ระบุรหัส ICD-9 ได้ไม่เกิน 6 รหัส' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  ensureColumns_(sheet, ['icd10', 'icd9']); // เผื่อยังไม่ได้รัน setupSheets ใหม่
  ensureApptTextColumns_(); // ไม่งั้น "9339,9319" จะถูกชีตแปลงเป็นเลขตัวเดียว
  sheet.getRange(match._row, colIndex_(sheet, 'icd10')).setValue(icd10.join(','));
  sheet.getRange(match._row, colIndex_(sheet, 'icd9')).setValue(icd9.join(','));
  invalidateCache_(SHEET_APPTS);
  return { ok: true };
}

/** แก้ไขเลขบัตรประชาชนของนัดที่บันทึกไปแล้ว (payload: {id, nationalId}) — เจ้าหน้าที่นัดก็แก้ได้ ไม่จำกัดแค่นักกายภาพ */
function updateAppointmentInfo_(payload) {
  const rows = sheetData_(SHEET_APPTS);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบนัดหมายนี้' };
  if (match.status !== 'active') return { ok: false, error: 'นัดนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้' };

  const nid = String(payload.nationalId || '').trim();
  if (nid && !/^\d{13}$/.test(nid.replace(/-/g, ''))) {
    return { ok: false, error: 'เลขบัตรประชาชนต้องมี 13 หลัก' };
  }

  // แก้ไขได้ทุกช่อง: ประเภท/เวลา/ชื่อ/นามสกุล/หมู่/เบอร์/หมายเหตุ/เลขบัตร (ช่องไหนไม่ได้ส่งมา = ไม่แตะ ใช้ร่วมกับโค้ดเวอร์ชันเก่าที่ส่งแค่เลขบัตรได้)
  const has = k => payload[k] !== undefined;
  if (has('type') && APPT_TYPES.indexOf(payload.type) === -1) return { ok: false, error: 'ประเภทนัดไม่ถูกต้อง' };
  if (has('firstName') && !String(payload.firstName).trim()) return { ok: false, error: 'กรุณากรอกชื่อ' };
  if (has('lastName') && !String(payload.lastName).trim()) return { ok: false, error: 'กรุณากรอกนามสกุล' };
  if (has('moo') && !String(payload.moo).trim()) return { ok: false, error: 'กรุณากรอกหมู่' };

  // เปลี่ยนเวลา: ตรวจว่าช่วงใหม่ว่างจริง (ไม่นับนัดนี้เองเป็นตัวชน)
  const timeChanged = has('startTime') && has('endTime') &&
    (payload.startTime !== match.startTime || payload.endTime !== match.endTime);
  if (timeChanged) {
    const check = isSlotAvailable_(fmtDate_(match.date), payload.startTime, payload.endTime, match.id);
    if (!check.ok) return check;
  }

  // ผูกนัดนี้กับทะเบียนคนไข้ใหม่ตามข้อมูลหลังแก้ไข (เช่น แก้ชื่อที่พิมพ์ผิด เติมเลขบัตร เปลี่ยนเบอร์)
  const newFirst = has('firstName') ? payload.firstName : match.firstName;
  const newLast = has('lastName') ? payload.lastName : match.lastName;
  const link = linkPatient_({
    firstName: newFirst,
    lastName: newLast,
    nationalId: nid,
    phone: has('phone') ? payload.phone : match.phone,
    moo: has('moo') ? payload.moo : match.moo
  }, {
    oldPtn: match.ptn,
    apptId: match.id,
    date: fmtDate_(match.date),
    nameEdited: nameKey_(newFirst, newLast) !== nameKey_(match.firstName, match.lastName)
  });
  if (!link.ok) return link;
  ensureApptTextColumns_();

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  const set = (col, val) => sheet.getRange(match._row, colIndex_(sheet, col)).setValue(val);
  if (String(match.ptn || '') !== link.ptn) set('ptn', link.ptn);
  set('nationalId', nid);
  if (has('type')) set('type', payload.type);
  if (timeChanged) { set('startTime', payload.startTime); set('endTime', payload.endTime); }
  if (has('firstName')) set('firstName', String(payload.firstName).trim());
  if (has('lastName')) set('lastName', String(payload.lastName).trim());
  if (has('moo')) set('moo', String(payload.moo).trim());
  if (has('phone')) set('phone', String(payload.phone || '').trim());
  if (has('note')) set('note', String(payload.note || '').trim());
  invalidateCache_(SHEET_APPTS);
  bumpCalendarVersion_();
  return { ok: true, ptn: link.ptn, isNewPatient: link.isNew, patient: link.patient };
}

/* ---------------------------- รหัส ICD-10 / ICD-9 ---------------------------- */
// ช่องแรกของแต่ละประเภทถูกล็อกเป็นรหัสอัตโนมัติ (isAuto=true) เสมอ ช่องที่เหลือเลือกจากรายการนี้เอง
//
// ปัญหาที่ต้องระวัง: Google Sheet แปลงข้อความที่มีแต่ตัวเลขกับจุลภาคเป็น "ตัวเลข" ให้เอง
// รหัส ICD-9 หลายรหัสที่บันทึกเป็น "9339,9319" จึงกลายเป็นเลขตัวเดียว 93399319 (จุลภาคที่คั่นรหัสหาย)
// และรหัสในชีตรายการรหัสก็กลายเป็นตัวเลข ทำให้หน้าเว็บเทียบกับรหัสที่เลือกไว้ไม่ตรง
// วิธีแก้: 1) ตั้งคอลัมน์เป็น "ข้อความธรรมดา" ก่อนเขียน (ensureApptTextColumns_) ข้อมูลใหม่จึงไม่ถูกแปลง
//          2) ตอนอ่าน แปลงค่าที่เคยถูกรวมเป็นเลขตัวเดียวกลับเป็นรายการรหัส (icdCodes_) โดยไม่แก้ข้อมูลเดิมในชีต

/** ตั้งคอลัมน์เบอร์โทร/รหัส ICD/PTN ของชีตนัดเป็นข้อความธรรมดา (ทำครั้งเดียว ข้อมูลเดิมในชีตไม่ถูกแก้) */
function ensureApptTextColumns_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('APPT_TEXT_COLS') === '1') return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  ensureColumns_(sheet, ['icd10', 'icd9', 'ptn']);
  ['phone', 'icd10', 'icd9', 'ptn'].forEach(h => {
    sheet.getRange(1, colIndex_(sheet, h), sheet.getMaxRows(), 1).setNumberFormat('@');
  });
  props.setProperty('APPT_TEXT_COLS', '1');
}

/** รายการรหัสจากชีตรหัส โดยให้ code เป็นข้อความเสมอ (ในชีตอาจถูกเก็บเป็นตัวเลข เช่น 9339) */
function icdCodeList_(sheetName) {
  return sheetData_(sheetName).map(r => Object.assign({}, r, { code: normText_(r.code) }));
}

/** แบ่งข้อความตัวเลขยาวๆ ออกเป็นรหัสที่รู้จัก — คืนผลเฉพาะเมื่อแบ่งได้แบบเดียวเท่านั้น (ไม่กำกวม) */
function segmentCodes_(s, known) {
  const results = [];
  const walk = (pos, acc) => {
    if (results.length > 1) return;
    if (pos === s.length) { results.push(acc.slice()); return; }
    known.forEach(k => {
      if (k && s.substr(pos, k.length) === k) { acc.push(k); walk(pos + k.length, acc); acc.pop(); }
    });
  };
  walk(0, []);
  return results.length === 1 ? results[0] : null;
}

/**
 * แปลงค่าในคอลัมน์ icd10/icd9 ของนัดเป็นรายการรหัส (ข้อความ)
 * known = รหัสที่มีในชีตรายการรหัส ใช้กู้รหัส ICD-9 ที่ถูกชีตรวมเป็นเลขตัวเดียว (ส่งมาเฉพาะ ICD-9)
 * กู้ได้เมื่อรวมกันไม่เกิน 15 หลัก (ประมาณ 3 รหัส) เกินกว่านั้นชีตเก็บตัวเลขไม่ครบ กู้คืนไม่ได้ จะคืนค่าตามที่เห็นในชีต
 */
function icdCodes_(value, known) {
  const s = normText_(value);
  if (!s) return [];
  if (s.indexOf(',') !== -1) return s.split(',').map(x => x.trim()).filter(Boolean);
  if (known && /^\d+$/.test(s) && s.length > 4 && s.length <= 15 && known.indexOf(s) === -1) {
    const seg = segmentCodes_(s, known.filter(k => /^\d+$/.test(k)));
    if (seg) return seg;
    if (s.length % 4 === 0) return s.match(/\d{4}/g); // รหัสหัตถการ ICD-9 ที่ใช้กันเป็นเลข 4 หลัก
  }
  return [s];
}
function knownIcd9_() {
  return icdCodeList_(SHEET_ICD9).map(r => r.code).filter(Boolean);
}
/** สำเนาของแถวนัดที่ส่งให้หน้าเว็บ: รหัส ICD และเบอร์โทรเป็นข้อความที่ถูกต้องเสมอ */
function apptForClient_(a, known9) {
  return Object.assign({}, a, {
    icd10: icdCodes_(a.icd10).join(','),
    icd9: icdCodes_(a.icd9, known9).join(','),
    phone: normPhone_(a.phone),
    ptn: normText_(a.ptn)
  });
}

function getIcd10Codes_() {
  return { ok: true, data: icdCodeList_(SHEET_ICD10) };
}
function addIcd10Code_(payload) {
  if (!payload.code || !payload.label) return { ok: false, error: 'กรุณากรอกทั้งรหัสและคำอธิบาย' };
  appendRow_(SHEET_ICD10, { id: Utilities.getUuid(), code: payload.code, label: payload.label, isAuto: false }, ['id', 'code', 'label', 'isAuto']);
  return { ok: true };
}
function removeIcd10Code_(payload) {
  const rows = sheetData_(SHEET_ICD10);
  const match = rows.find(r => r.id === payload.id);
  if (match && match.isAuto === true) return { ok: false, error: 'ลบรหัสอัตโนมัติหลักไม่ได้' };
  if (match) deleteRow_(SHEET_ICD10, match._row);
  return { ok: true };
}

function getIcd9Codes_() {
  return { ok: true, data: icdCodeList_(SHEET_ICD9) };
}
function addIcd9Code_(payload) {
  if (!payload.code || !payload.label) return { ok: false, error: 'กรุณากรอกทั้งรหัสและคำอธิบาย' };
  appendRow_(SHEET_ICD9, { id: Utilities.getUuid(), code: payload.code, label: payload.label, isAuto: false }, ['id', 'code', 'label', 'isAuto']);
  return { ok: true };
}
function removeIcd9Code_(payload) {
  const rows = sheetData_(SHEET_ICD9);
  const match = rows.find(r => r.id === payload.id);
  if (match && match.isAuto === true) return { ok: false, error: 'ลบรหัสอัตโนมัติหลักไม่ได้' };
  if (match) deleteRow_(SHEET_ICD9, match._row);
  return { ok: true };
}

/* ---------------------------- ทะเบียนคนไข้ / PTN ---------------------------- */
// หลักการ: ข้อมูลที่ไม่ค่อยเปลี่ยนของคนไข้ (ชื่อ นามสกุล เลขบัตร เบอร์ หมู่) เก็บไว้ที่ชีต Patients ที่เดียว
// แต่ละนัดในชีต Appointments มีคอลัมน์ ptn ชี้กลับมาที่คนไข้คนนั้น — นับจำนวนครั้ง/ดูประวัติรายคนได้จาก ptn
// "คนเดียวกัน" ตัดสินจาก 1) PTN ที่ผู้ใช้กดเลือกเอง 2) เลขบัตรประชาชน 13 หลักตรงกัน 3) ชื่อ+นามสกุลตรงกันและมีอยู่คนเดียวในทะเบียน

/** สร้างชีต Patients และคอลัมน์ ptn ในชีต Appointments ถ้ายังไม่มี (เรียกซ้ำได้ ไม่กระทบข้อมูลเดิม) */
function ensurePatientInfra_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apptSheet = ss.getSheetByName(SHEET_APPTS);
  let sheet = ss.getSheetByName(SHEET_PATIENTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PATIENTS);
    // ตั้งทั้งคอลัมน์เป็น "ข้อความธรรมดา" ก่อนใส่ข้อมูล ไม่งั้นเลข 0 นำหน้าเบอร์โทรจะหาย
    sheet.getRange(1, 1, sheet.getMaxRows(), PATIENT_HEADERS.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, PATIENT_HEADERS.length).setValues([PATIENT_HEADERS]);
    sheet.setFrozenRows(1);
    // เบอร์โทรในชีตนัดก็เช่นกัน: นัดที่ลงหลังจากนี้จะเก็บเป็นข้อความ เลข 0 นำหน้าไม่หาย (นัดเก่าไม่ถูกแก้)
    apptSheet.getRange(1, colIndex_(apptSheet, 'phone'), apptSheet.getMaxRows(), 1).setNumberFormat('@');
    invalidateCache_(SHEET_PATIENTS);
  }
  ensureColumns_(apptSheet, ['ptn']);
  return sheet;
}

function normText_(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
}
/** เลขบัตร 13 หลัก (ตัดขีด/ช่องว่างออก) ถ้าไม่ครบ 13 หลักคืนค่าว่าง */
function normNid_(v) {
  const d = String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
  return d.length === 13 ? d : '';
}
/** เบอร์โทร: เติมเลข 0 นำหน้ากลับให้เบอร์ที่ชีตเคยแปลงเป็นตัวเลขจนเลข 0 หาย (เช่น 860341397 -> 0860341397) */
function normPhone_(v) {
  let s = normText_(v);
  if (/^\d{8,9}$/.test(s) && s.charAt(0) !== '0') s = '0' + s;
  return s;
}
/** ค่าที่มีแต่เครื่องหมาย เช่น "." หรือ "-" (พิมพ์ไว้เพื่อให้ผ่านช่องบังคับกรอก) ไม่นับเป็นข้อมูลจริง */
function meaningful_(v) {
  const s = normText_(v);
  return /[0-9A-Za-z฀-๿]/.test(s) ? s : '';
}
function nameKey_(first, last) {
  return (normText_(first) + '|' + normText_(last)).toLowerCase();
}

/** ปี พ.ศ. 2 หลักของวันที่ 'yyyy-MM-dd' (ใช้เป็นปีใน PTN) — วันที่ไม่ถูกต้องใช้วันนี้แทน */
function ptnYear_(dateStr) {
  let s = String(dateStr === undefined || dateStr === null ? '' : dateStr);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) s = todayStr_();
  let be = Number(s.slice(0, 4)) + 543;
  if (PTN_FISCAL_YEAR && Number(s.slice(5, 7)) >= 10) be++;
  return ('0' + (be % 100)).slice(-2);
}
function formatPtn_(yy, n) {
  let s = String(n);
  while (s.length < PTN_DIGITS) s = '0' + s;
  return PTN_PREFIX + yy + '-' + s;
}
/** แยก PTN ที่มีปีเป็น { yy, n } — ถ้าไม่ใช่รูปแบบที่มีปี (เช่น PT00001 ของรุ่นก่อน) คืน null */
function parsePtn_(ptn) {
  const m = /^PTN(\d{2})-(\d+)$/.exec(normText_(ptn));
  return m ? { yy: m[1], n: Number(m[2]) } : null;
}
/** PTN เดียวกันในจำนวนหลักมาตรฐาน (PTN69-00001 -> PTN69-0001) — ปีและเลขลำดับไม่เปลี่ยน ถ้าไม่ใช่รูปแบบที่มีปีคืนค่าว่าง */
function canonPtn_(ptn) {
  const p = parsePtn_(ptn);
  return p ? formatPtn_(p.yy, p.n) : '';
}
/** เลขลำดับถัดไปของปี yy: ดูทั้งทะเบียนและ PTN ที่เคยใช้ในชีตนัด เลขที่เคยออกแล้วจะไม่ถูกนำกลับมาใช้กับคนอื่น */
function nextPtnNumber_(yy, patients, appts) {
  let max = 0;
  const see = v => { const p = parsePtn_(v); if (p && p.yy === yy && p.n > max) max = p.n; };
  patients.forEach(p => see(p.ptn));
  (appts || []).forEach(a => see(a.ptn));
  return max + 1;
}

/** อ่านทะเบียนคนไข้ทั้งหมด (ยังไม่มีชีต = ยังไม่มีคนไข้) */
function patientsData_() {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PATIENTS)) return [];
  return sheetData_(SHEET_PATIENTS).filter(p => normText_(p.ptn));
}

/** ข้อมูลคนไข้ที่ส่งให้หน้าเว็บ (เฉพาะช่องที่ใช้เติมในฟอร์มนัด) */
function publicPatient_(p) {
  return {
    ptn: normText_(p.ptn),
    firstName: normText_(p.firstName),
    lastName: normText_(p.lastName),
    nationalId: normNid_(p.nationalId) || normText_(p.nationalId),
    phone: normPhone_(p.phone),
    moo: normText_(p.moo)
  };
}

function getPatients_() {
  return { ok: true, data: patientsData_().map(publicPatient_) };
}

/**
 * สรุปประวัติของคนไข้ 1 คน สำหรับแสดงในฟอร์มนัดเมื่อเลือกคนไข้เดิม
 * payload: { ptn, date, startTime } — date/startTime = นัดที่กำลังจะลง ใช้หาว่า "ครั้งก่อน" คือครั้งไหน
 */
function getPatientSummary_(payload) {
  const ptn = normText_(payload.ptn);
  if (!ptn) return { ok: false, error: 'ไม่ได้ระบุ PTN' };
  const today = todayStr_();
  const known9 = knownIcd9_();
  const rows = [];
  sheetData_(SHEET_APPTS).forEach(a => {
    if (!a.id || !a.date || normText_(a.ptn) !== ptn) return;
    let date;
    try { date = fmtDate_(a.date); } catch (e) { return; }
    rows.push({
      date: date,
      startTime: normText_(a.startTime),
      endTime: normText_(a.endTime),
      type: a.type,
      status: a.status,
      attended: !!a.attendedAt,
      icd10: icdCodes_(a.icd10),
      icd9: icdCodes_(a.icd9, known9)
    });
  });
  const stamp = r => r.date + ' ' + r.startTime;
  rows.sort((x, y) => stamp(x) < stamp(y) ? 1 : (stamp(x) > stamp(y) ? -1 : 0)); // ใหม่สุดก่อน

  const active = rows.filter(r => r.status === 'active');
  const attended = active.filter(r => r.attended);
  const upcoming = active.filter(r => r.date >= today && !r.attended).reverse(); // ใกล้สุดก่อน
  // "ครั้งก่อน" = นัดล่าสุดที่อยู่ก่อนนัดที่กำลังจะลง
  const refDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || '')) ? payload.date : today;
  const ref = refDate + ' ' + (normText_(payload.startTime) || '99:99');
  const previous = active.find(r => stamp(r) < ref) || null;
  const pick = r => ({ date: r.date, startTime: r.startTime, endTime: r.endTime, type: r.type, attended: r.attended, icd10: r.icd10, icd9: r.icd9 });

  return {
    ok: true,
    data: {
      ptn: ptn,
      attendedCount: attended.length,
      appointmentCount: active.length,
      cancelledCount: rows.length - active.length,
      firstVisit: attended.length ? attended[attended.length - 1].date : '',
      lastVisit: attended.length ? attended[0].date : '',
      upcoming: upcoming.map(pick),
      previous: previous ? pick(previous) : null,
      history: active.slice(0, 5).map(pick)
    }
  };
}

/**
 * เขียนข้อมูลคนไข้ลงแถวที่ต่อเนื่องกัน เริ่มที่ startRow (เฉพาะคอลัมน์ของระบบ ไม่แตะคอลัมน์อื่นที่ผู้ใช้อาจเพิ่มเองในชีต)
 * เขียนเป็น "ข้อความธรรมดา" เสมอ เลข 0 นำหน้าเบอร์โทรจะได้ไม่หาย
 */
function writePatientRows_(sheet, startRow, recs) {
  if (!recs.length) return;
  const needRows = startRow + recs.length - 1 - sheet.getMaxRows();
  if (needRows > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needRows); // ชีตเต็มแล้ว: เพิ่มแถวให้พอก่อนเขียน
  const lastCol = Math.max(sheet.getLastColumn(), PATIENT_HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const val = (rec, h) => String(rec[h] === undefined || rec[h] === null ? '' : rec[h]);
  if (PATIENT_HEADERS.every((h, i) => headers[i] === h)) {
    // คอลัมน์เรียงตามมาตรฐาน: เขียนทีเดียวทั้งก้อน (เร็วกว่าเขียนทีละช่องมาก)
    sheet.getRange(startRow, 1, recs.length, PATIENT_HEADERS.length)
      .setNumberFormat('@')
      .setValues(recs.map(rec => PATIENT_HEADERS.map(h => val(rec, h))));
  } else {
    recs.forEach((rec, r) => {
      PATIENT_HEADERS.forEach(h => {
        const i = headers.indexOf(h);
        if (i !== -1) sheet.getRange(startRow + r, i + 1).setNumberFormat('@').setValue(val(rec, h));
      });
    });
  }
  invalidateCache_(SHEET_PATIENTS);
}
function writePatientRow_(sheet, row, rec) {
  writePatientRows_(sheet, row, [rec]);
}

/** จำนวนนัด (ทุกสถานะ) ที่ผูกกับ PTN นี้ ไม่นับนัดที่ระบุใน excludeApptId */
function countApptsWithPtn_(ptn, excludeApptId) {
  return sheetData_(SHEET_APPTS).filter(a => a.id && String(a.ptn || '') === String(ptn) && a.id !== excludeApptId).length;
}

/**
 * หาคนไข้ในทะเบียนที่ตรงกับข้อมูลที่กรอก ถ้าไม่มีให้ออก PTN ใหม่ แล้วคืน PTN กลับไปผูกกับนัด
 * input: { firstName, lastName, nationalId, phone, moo }
 * opts.pickedPtn = PTN ที่ผู้ใช้กดเลือกจากรายชื่อคนไข้เดิมตอนทำนัดใหม่
 * opts.oldPtn / opts.apptId = PTN เดิมและ id ของนัดที่กำลังถูกแก้ไข
 *
 * ลำดับการตัดสิน:
 *  1) กดเลือกคนไข้เดิมมา -> ใช้คนนั้น (ถ้าเลขบัตรที่กรอกเป็นของอีกคนในทะเบียน จะแจ้งเตือนและไม่บันทึก)
 *  2) เลขบัตรตรงกับคนในทะเบียน -> คนนั้น
 *  3) (ตอนแก้ไขนัด) ไม่ได้แก้ชื่อ -> คนเดิมของนัดนี้ (ถือว่าเป็นการแก้เลขบัตร/เบอร์/หมู่ของคนนั้น)
 *  4) ชื่อ+นามสกุลตรงกับคนในทะเบียน "คนเดียว" และเลขบัตรไม่ขัดกัน -> คนนั้น
 *  5) (ตอนแก้ไขนัด) แก้ชื่อ และคนเดิมของนัดนี้ไม่มีนัดอื่นเลย -> แก้ทะเบียนของคนเดิมให้ตรงกับนัด (กรณีพิมพ์ชื่อผิดตอนลงนัดครั้งแรก)
 *  6) นอกนั้น -> คนไข้ใหม่ ออก PTN ถัดไป
 * ข้อมูลในทะเบียนจะถูกอัปเดตเบอร์/หมู่/เลขบัตรตามที่กรอกล่าสุด แต่ไม่ถูกทับด้วยค่าว่าง (ยกเว้นกรณีข้อ 5)
 * opts.nameEdited = true เมื่อผู้ใช้แก้ชื่อหรือนามสกุลของนัดในการบันทึกครั้งนี้
 * opts.date = วันที่ของนัด ('yyyy-MM-dd') ใช้กำหนดปีใน PTN เมื่อเป็นคนไข้ใหม่
 */
function linkPatient_(input, opts) {
  opts = opts || {};
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // กันสองเครื่องลงคนไข้ใหม่พร้อมกันแล้วได้ PTN ซ้ำ
  } catch (e) {
    return { ok: false, error: 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง' };
  }
  try {
    const sheet = ensurePatientInfra_();
    delete _sheetCache_[SHEET_PATIENTS]; // อ่านทะเบียนสดหลังได้ล็อก
    const patients = patientsData_();

    const first = normText_(input.firstName), last = normText_(input.lastName);
    const nid = normNid_(input.nationalId);
    const phone = normPhone_(meaningful_(input.phone));
    const moo = meaningful_(input.moo);
    const key = nameKey_(first, last);

    const byPtn = ptn => normText_(ptn) ? (patients.find(p => normText_(p.ptn) === normText_(ptn)) || null) : null;
    const idOwner = nid ? (patients.find(p => normNid_(p.nationalId) === nid) || null) : null;
    const picked = byPtn(opts.pickedPtn);
    const old = byPtn(opts.oldPtn);

    // rename = แก้ชื่อในทะเบียนตามที่กรอก, mirror = ทะเบียนของคนนี้มีแค่นัดนี้นัดเดียว ให้ข้อมูลในทะเบียนตรงกับนัดทุกช่อง
    let target = null, rename = false, mirror = false;
    if (picked) {
      if (idOwner && idOwner !== picked) {
        return { ok: false, error: 'เลขบัตรนี้อยู่ในทะเบียนของ ' + normText_(idOwner.ptn) + ' (' + normText_(idOwner.firstName) + ' ' + normText_(idOwner.lastName) + ') แล้ว กรุณาตรวจสอบเลขบัตร' };
      }
      target = picked;
    } else if (idOwner) {
      target = idOwner;
      rename = idOwner === old && opts.nameEdited === true; // เลขบัตรยืนยันว่าเป็นคนเดิม และผู้ใช้ตั้งใจแก้ชื่อ = แก้ตัวสะกดในทะเบียนด้วย
    } else if (old && (opts.nameEdited !== true || nameKey_(old.firstName, old.lastName) === key)) {
      target = old; // ไม่ได้เปลี่ยนชื่อ = ยังเป็นคนเดิม (เป็นการแก้เลขบัตร/เบอร์/หมู่ของคนนั้น)
    } else {
      // ชื่อตรงกัน และเลขบัตรไม่ขัดกัน (ฝั่งใดฝั่งหนึ่งยังไม่มีเลขบัตร) — ต้องเหลือคนเดียวเท่านั้นถึงจะถือว่าเป็นคนเดียวกัน
      const sameName = patients.filter(p => nameKey_(p.firstName, p.lastName) === key && (!nid || !normNid_(p.nationalId)));
      if (sameName.length === 1) {
        target = sameName[0];
      } else if (old && countApptsWithPtn_(old.ptn, opts.apptId) === 0) {
        target = old;
        mirror = true;
      }
    }

    const now = new Date().toISOString();
    if (!target) {
      const yy = ptnYear_(opts.date); // ปีของนัดแรก = ปีที่มาครั้งแรก
      const rec = {
        ptn: formatPtn_(yy, nextPtnNumber_(yy, patients, sheetData_(SHEET_APPTS))),
        firstName: first, lastName: last, nationalId: nid, phone: phone, moo: moo,
        createdAt: now, updatedAt: now
      };
      writePatientRow_(sheet, sheet.getLastRow() + 1, rec);
      return { ok: true, ptn: rec.ptn, isNew: true, patient: publicPatient_(rec) };
    }

    const cur = publicPatient_(target);
    const rec = {
      ptn: cur.ptn,
      firstName: (rename || mirror) ? first : cur.firstName,
      lastName: (rename || mirror) ? last : cur.lastName,
      nationalId: mirror ? nid : (nid || cur.nationalId),
      phone: mirror ? phone : (phone || cur.phone),
      moo: mirror ? moo : (moo || cur.moo),
      createdAt: normText_(target.createdAt) || now,
      updatedAt: now
    };
    const changed = ['firstName', 'lastName', 'nationalId', 'phone', 'moo'].some(k => rec[k] !== normText_(target[k]));
    if (changed) writePatientRow_(sheet, target._row, rec);
    return { ok: true, ptn: rec.ptn, isNew: false, patient: publicPatient_(rec) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * รัน "ครั้งเดียว" จากตัวแก้ไข Apps Script (เลือก setupPatients จาก dropdown ข้างปุ่ม "เรียกใช้" แล้วกด Run)
 * สิ่งที่ทำ: สร้างชีต Patients, ไล่ออก PTN ให้คนไข้จากนัดที่มีอยู่แล้ว (เรียงตามวันที่มาครั้งแรก), แล้วเติม PTN ลงคอลัมน์ ptn ของทุกนัด
 * PTN รูปแบบเก่า (PT00001 หรือ PTN69-00001) จะถูกแปลงเป็นรูปแบบปัจจุบัน (PTN69-0001) ทั้งในชีต Patients และในทุกนัด
 * รันซ้ำได้ปลอดภัย: คนที่มี PTN รูปแบบปัจจุบันแล้วจะไม่ถูกออกเลขใหม่ และนัดที่มี PTN ถูกต้องแล้วจะไม่ถูกแก้
 * (ชื่อฟังก์ชันไม่ลงท้ายด้วย _ เพื่อให้ขึ้นในรายการ Run)
 */
function setupPatients() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pSheet = ensurePatientInfra_();
    const aSheet = ss.getSheetByName(SHEET_APPTS);
    _sheetCache_ = {};

    const appts = sheetData_(SHEET_APPTS).filter(a => a.id);
    const dateOf = a => { try { return fmtDate_(a.date); } catch (e) { return ''; } };
    const stampOf = a => dateOf(a) + ' ' + (a.createdAt instanceof Date ? a.createdAt.toISOString() : normText_(a.createdAt));
    const ordered = appts.slice().sort((x, y) => stampOf(x) < stampOf(y) ? -1 : (stampOf(x) > stampOf(y) ? 1 : 0));

    // people = คนที่อยู่ในทะเบียนแล้ว + คนใหม่ที่พบจากนัด (ยังไม่มี ptn)
    const people = patientsData_().map(p => {
      const pub = publicPatient_(p);
      const created = p.createdAt instanceof Date ? p.createdAt.toISOString() : normText_(p.createdAt);
      return { ptn: pub.ptn, firstName: pub.firstName, lastName: pub.lastName, nid: normNid_(pub.nationalId), phone: pub.phone, moo: pub.moo, key: nameKey_(pub.firstName, pub.lastName), firstStamp: '', isNew: false, row: p._row, created: created };
    });
    const personOfAppt = {}; // id ของนัด -> คน
    const ambiguous = {};
    const newPerson = a => {
      const p = { ptn: '', firstName: normText_(a.firstName), lastName: normText_(a.lastName), nid: normNid_(a.nationalId), phone: '', moo: '', key: nameKey_(a.firstName, a.lastName), firstStamp: stampOf(a), isNew: true };
      people.push(p);
      return p;
    };
    const absorb = (p, a) => { // นัดถูกไล่จากเก่าไปใหม่ ค่าล่าสุดที่เป็นข้อมูลจริงจึงเป็นค่าที่เหลืออยู่
      personOfAppt[a.id] = p;
      if (!p.isNew) return;
      const ph = normPhone_(meaningful_(a.phone)), mo = meaningful_(a.moo);
      if (ph) p.phone = ph;
      if (mo) p.moo = mo;
      p.firstName = normText_(a.firstName);
      p.lastName = normText_(a.lastName);
      p.key = nameKey_(p.firstName, p.lastName);
    };

    const active = ordered.filter(a => a.status === 'active');
    // รอบ 0: นัดที่มี PTN อยู่แล้วและพบในทะเบียน
    active.forEach(a => {
      const p = normText_(a.ptn) ? people.find(x => x.ptn === normText_(a.ptn)) : null;
      if (p) personOfAppt[a.id] = p;
    });
    // รอบ 1: นัดที่มีเลขบัตร — เลขบัตรเดียวกัน = คนเดียวกัน
    active.forEach(a => {
      if (personOfAppt[a.id]) return;
      const nid = normNid_(a.nationalId);
      if (!nid) return;
      let p = people.find(x => x.nid === nid);
      if (!p) {
        const sameName = people.filter(x => x.key === nameKey_(a.firstName, a.lastName) && !x.nid);
        if (sameName.length === 1) { p = sameName[0]; p.nid = nid; }
      }
      absorb(p || newPerson(a), a);
    });
    // รอบ 2: นัดที่ไม่มีเลขบัตร — ชื่อ+นามสกุลตรงกับคนเดียวในทะเบียน = คนเดียวกัน
    active.forEach(a => {
      if (personOfAppt[a.id]) return;
      const key = nameKey_(a.firstName, a.lastName);
      const sameName = people.filter(x => x.key === key);
      let p = null;
      if (sameName.length === 1) p = sameName[0];
      else if (sameName.length > 1) {
        ambiguous[normText_(a.firstName) + ' ' + normText_(a.lastName)] = true;
        const noId = sameName.filter(x => !x.nid);
        if (noId.length === 1) p = noId[0];
      }
      absorb(p || newPerson(a), a);
    });

    // วันที่ของนัดแรกของแต่ละคน (นัดถูกเรียงจากเก่าไปใหม่แล้ว) ใช้ทั้งเรียงลำดับและกำหนดปีใน PTN
    people.forEach(p => { p.firstStamp = ''; });
    active.forEach(a => { const p = personOfAppt[a.id]; if (p && !p.firstStamp) p.firstStamp = stampOf(a); });
    const today = todayStr_();
    people.forEach(p => {
      if (!/^\d{4}-\d{2}-\d{2}/.test(p.firstStamp)) p.firstStamp = (/^\d{4}-\d{2}-\d{2}/.test(p.created) ? p.created.slice(0, 10) : today) + ' ~';
    });

    // ออก PTN ให้คนใหม่ และแปลง PTN รูปแบบเก่า (ของคนที่อยู่ในทะเบียนแล้ว) เป็นรูปแบบปัจจุบัน เรียงตามวันที่ของนัดแรก
    const needNumber = people.filter(p => !parsePtn_(p.ptn))
      .sort((x, y) => x.firstStamp < y.firstStamp ? -1 : (x.firstStamp > y.firstStamp ? 1 : 0));
    const nextOfYear = {};
    const remap = {}; // PTN รูปแบบเก่า -> PTN ใหม่
    needNumber.forEach(p => {
      const yy = ptnYear_(p.firstStamp.slice(0, 10));
      if (!nextOfYear[yy]) nextOfYear[yy] = nextPtnNumber_(yy, people, appts);
      const newPtn = formatPtn_(yy, nextOfYear[yy]++);
      if (p.ptn) remap[p.ptn] = newPtn;
      p.ptn = newPtn;
    });

    // PTN ที่มีปีแล้วแต่จำนวนหลักไม่ตรงมาตรฐาน: ปรับจำนวนหลักอย่างเดียว ปีและเลขลำดับคงเดิม
    const repadded = people.filter(p => needNumber.indexOf(p) === -1 && canonPtn_(p.ptn) !== p.ptn);
    repadded.forEach(p => { const c = canonPtn_(p.ptn); remap[p.ptn] = c; p.ptn = c; });

    const now = new Date().toISOString();
    const fresh = needNumber.filter(p => p.isNew);
    const converted = needNumber.filter(p => !p.isNew).concat(repadded);
    if (converted.length) { // แก้เฉพาะช่อง ptn ของแถวเดิมในชีต Patients
      const pCol = colIndex_(pSheet, 'ptn');
      const pRange = pSheet.getRange(2, pCol, pSheet.getLastRow() - 1, 1);
      const pValues = pRange.getValues();
      converted.forEach(p => { pValues[p.row - 2][0] = p.ptn; });
      pRange.setNumberFormat('@').setValues(pValues);
    }
    writePatientRows_(pSheet, pSheet.getLastRow() + 1, fresh.map(p => (
      { ptn: p.ptn, firstName: p.firstName, lastName: p.lastName, nationalId: p.nid, phone: p.phone, moo: p.moo, createdAt: now, updatedAt: now }
    )));

    // ใส่ PTN ลงคอลัมน์ ptn ของนัด: เติมช่องที่ยังว่าง และเปลี่ยน PTN รูปแบบเก่าเป็นรูปแบบปัจจุบัน
    // (นัดที่ยกเลิกแล้วและยังไม่มี PTN จะเติมให้เฉพาะเมื่อระบุคนได้ชัดเจน)
    const resolveCancelled = a => {
      const nid = normNid_(a.nationalId);
      if (nid) { const p = people.find(x => x.nid === nid); if (p) return p; }
      const sameName = people.filter(x => x.key === nameKey_(a.firstName, a.lastName) && (!nid || !x.nid));
      return sameName.length === 1 ? sameName[0] : null;
    };
    ensureApptTextColumns_();
    const lastRow = aSheet.getLastRow();
    let tagged = 0;
    if (lastRow > 1) {
      const col = colIndex_(aSheet, 'ptn');
      const range = aSheet.getRange(2, col, lastRow - 1, 1);
      const values = range.getValues();
      appts.forEach(a => {
        const i = a._row - 2;
        const cur = normText_(values[i][0]);
        let want = cur;
        if (personOfAppt[a.id]) want = personOfAppt[a.id].ptn;
        else if (cur && remap[cur]) want = remap[cur];
        else if (cur && canonPtn_(cur)) want = canonPtn_(cur);
        else if (!cur) { const p = resolveCancelled(a); want = p ? p.ptn : ''; }
        if (want && want !== cur) { values[i][0] = want; tagged++; }
      });
      range.setNumberFormat('@').setValues(values);
    }
    invalidateCache_(SHEET_APPTS);
    invalidateCache_(SHEET_PATIENTS);

    const total = people.length;
    const noId = people.filter(p => !p.nid).length;
    Logger.log('ออก PTN ใหม่ ' + fresh.length + ' คน · เปลี่ยนรูปแบบ PTN เดิม ' + converted.length + ' คน (รวมในทะเบียน ' + total + ' คน) · ใส่/แก้ PTN ในนัด ' + tagged + ' รายการ');
    Logger.log('คนไข้ที่ยังไม่มีเลขบัตรในทะเบียน ' + noId + ' คน (จับคู่ด้วยชื่อ+นามสกุลเท่านั้น)');
    const amb = Object.keys(ambiguous);
    if (amb.length) Logger.log('ชื่อซ้ำกันมากกว่า 1 คน ควรตรวจในชีต Patients: ' + amb.join(', '));
    Logger.log('เสร็จแล้ว! เปิดแท็บ Patients ในชีตเพื่อตรวจรายชื่อได้เลย');
  } finally {
    lock.releaseLock();
  }
}

/* ---------------------------- Appointments ---------------------------- */

function addAppointment_(payload, auth) {
  if (APPT_TYPES.indexOf(payload.type) === -1) return { ok: false, error: 'ประเภทนัดไม่ถูกต้อง' };
  if (!payload.firstName || !payload.lastName) return { ok: false, error: 'กรุณากรอกชื่อและนามสกุล' };
  if (!payload.moo) return { ok: false, error: 'กรุณากรอกหมู่' };
  if (payload.nationalId && !/^\d{13}$/.test(String(payload.nationalId).replace(/-/g, ''))) {
    return { ok: false, error: 'เลขบัตรประชาชนต้องมี 13 หลัก' };
  }

  const check = isSlotAvailable_(payload.date, payload.startTime, payload.endTime);
  if (!check.ok) return check;

  // ช่องแรกของ ICD-10/ICD-9 ล็อกเป็นรหัสอัตโนมัติเสมอ ไม่ว่าฝั่งหน้าเว็บจะส่งมาครบหรือไม่
  let icd10 = Array.isArray(payload.icd10) ? payload.icd10.filter(Boolean) : [];
  if (icd10.indexOf(ICD10_AUTO_CODE) === -1) icd10.unshift(ICD10_AUTO_CODE);
  icd10 = [...new Set(icd10)];
  if (icd10.length > 2) return { ok: false, error: 'ระบุรหัส ICD-10 ได้ไม่เกิน 2 รหัส' };

  let icd9 = Array.isArray(payload.icd9) ? payload.icd9.filter(Boolean) : [];
  if (icd9.indexOf(ICD9_AUTO_CODE) === -1) icd9.unshift(ICD9_AUTO_CODE);
  icd9 = [...new Set(icd9)];
  if (icd9.length > 6) return { ok: false, error: 'ระบุรหัส ICD-9 ได้ไม่เกิน 6 รหัส' };

  // หา/สร้างคนไข้ในทะเบียน แล้วผูก PTN เข้ากับนัดนี้ (payload.ptn = PTN ที่ผู้ใช้กดเลือกจากรายชื่อคนไข้เดิม ถ้ามี)
  const link = linkPatient_(payload, { pickedPtn: payload.ptn, date: payload.date });
  if (!link.ok) return link;
  ensureApptTextColumns_(); // รหัส ICD/เบอร์โทรต้องถูกเก็บเป็นข้อความ ไม่งั้นชีตจะแปลงเป็นตัวเลข

  appendRowByHeaders_(SHEET_APPTS, {
    id: Utilities.getUuid(),
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    type: payload.type,
    firstName: payload.firstName,
    lastName: payload.lastName,
    moo: payload.moo,
    phone: payload.phone || '',
    nationalId: payload.nationalId || '',
    note: payload.note || '',
    createdBy: auth.username,
    createdAt: new Date().toISOString(),
    status: 'active',
    icd10: icd10.join(','),
    icd9: icd9.join(','),
    ptn: link.ptn
  });

  bumpCalendarVersion_();
  return { ok: true, ptn: link.ptn, isNewPatient: link.isNew, patient: link.patient };
}

function cancelAppointment_(payload) {
  const rows = sheetData_(SHEET_APPTS);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบนัดหมายนี้' };
  if (match.attendedAt) {
    return { ok: false, error: 'นัดนี้บันทึกว่ามาทำกายภาพแล้ว ยกเลิกไม่ได้ (ต้องยกเลิกการบันทึก "มาแล้ว" ก่อน)' };
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  sheet.getRange(match._row, colIndex_(sheet, 'status')).setValue('cancelled');
  invalidateCache_(SHEET_APPTS);
  bumpCalendarVersion_();
  return { ok: true };
}

/**
 * บันทึกว่าคนไข้มาทำกายภาพแล้ว (หรือยกเลิกการบันทึก) — เก็บเวลาและผู้บันทึกไว้ในชีต Appointments
 * เพื่อใช้ทำ dashboard/สถิติภายหลัง (payload: {id, attended: true|false})
 * ไม่แตะคอลัมน์ status เพื่อให้ช่วงเวลานั้นยังถือว่า "มีนัดอยู่" ตามเดิม
 */
function markAttended_(payload, auth) {
  const rows = sheetData_(SHEET_APPTS);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบนัดหมายนี้' };
  if (match.status !== 'active') return { ok: false, error: 'นัดนี้ถูกยกเลิกแล้ว' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  ensureColumns_(sheet, ['attendedAt', 'attendedBy']); // เผื่อยังไม่ได้รัน setupSheets ใหม่
  const atCol = colIndex_(sheet, 'attendedAt');
  const byCol = colIndex_(sheet, 'attendedBy');

  if (payload.attended === false) {
    sheet.getRange(match._row, atCol).clearContent();
    sheet.getRange(match._row, byCol).clearContent();
  } else {
    sheet.getRange(match._row, atCol).setValue(new Date());
    sheet.getRange(match._row, byCol).setValue(auth.username);
  }
  invalidateCache_(SHEET_APPTS);
  return { ok: true };
}

function isSlotAvailable_(date, startTime, endTime, excludeApptId) {
  const resolved = resolveDayOpen_(date);
  if (!resolved.isOpen) {
    return { ok: false, error: resolved.reason ? 'วันนี้ปิดทำการ: ' + resolved.reason : 'วันนี้ไม่เปิดให้บริการ' };
  }
  const matchDef = resolved.slotDefs.find(d => d.start === startTime && d.end === endTime);
  if (!matchDef) {
    return { ok: false, error: 'ช่วงเวลานี้ไม่ได้อยู่ในตารางเวลาที่กำหนดไว้' };
  }

  const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

  const busyToday = sheetData_(SHEET_BUSY).filter(r => fmtDate_(r.date) === date);
  for (const b of busyToday) {
    if (overlaps(startTime, endTime, b.startTime, b.endTime)) {
      return { ok: false, error: 'ช่วงเวลานี้นักกายภาพไม่ว่าง (' + b.type + ')' };
    }
  }

  const apptsToday = sheetData_(SHEET_APPTS).filter(r => fmtDate_(r.date) === date && r.status === 'active' && r.id !== excludeApptId);
  for (const a of apptsToday) {
    if (overlaps(startTime, endTime, a.startTime, a.endTime)) {
      return { ok: false, error: 'ช่วงเวลานี้มีนัดอยู่แล้ว' };
    }
  }

  return { ok: true };
}

/* ---------------------------- Dashboard / สถิติ ---------------------------- */

function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function addDaysStr_(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween_(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
/** คีย์แทน "คนไข้คนเดียวกัน": ใช้เลขบัตรถ้ามีครบ 13 หลัก ไม่งั้นใช้ ชื่อ+นามสกุล+หมู่ (นับโดยประมาณ) */
function patientKey_(a) {
  const nid = String(a.nationalId || '').replace(/\D/g, '');
  if (nid.length === 13) return 'id:' + nid;
  return 'nm:' + [a.firstName, a.lastName, a.moo].map(x => String(x === undefined || x === null ? '' : x).trim().toLowerCase()).join('|');
}
function cmpMoo_(x, y) {
  const nx = Number(x), ny = Number(y);
  if (!isNaN(nx) && !isNaN(ny)) return nx - ny;
  return String(x) < String(y) ? -1 : (String(x) > String(y) ? 1 : 0);
}

/**
 * สรุปสถิติการให้บริการช่วง [from, to] (payload: {from:'yyyy-MM-dd', to:'yyyy-MM-dd'})
 * ไม่ส่งเบอร์/เลขบัตรของคนไข้กลับไป มีแต่ตัวเลขสรุป ยกเว้น byPatient ที่มี PTN และชื่อ (หน้านี้เปิดได้เฉพาะนักกายภาพ)
 * "ไม่มาตามนัด" นับเฉพาะนัดที่วันผ่านไปแล้ว และอยู่หลังวันแรกที่เริ่มมีการกด "มาแล้ว"
 * (นัดก่อนหน้านั้นไม่มีข้อมูลการมา จะนับเป็นไม่มาทั้งหมดไม่ได้)
 */
function getDashboard_(payload) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(payload.from || ''), to = String(payload.to || '');
  if (!re.test(from) || !re.test(to)) return { ok: false, error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  if (from > to) return { ok: false, error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' };
  const spanDays = daysBetween_(from, to) + 1;
  if (spanDays > 1830) return { ok: false, error: 'ช่วงเวลายาวเกินไป (ไม่เกิน 5 ปี)' };

  const tz = Session.getScriptTimeZone();
  const today = todayStr_();

  const rows = sheetData_(SHEET_APPTS)
    .filter(r => r.id && r.date)
    .map(r => ({
      date: fmtDate_(r.date),
      type: r.type,
      moo: String(r.moo === undefined || r.moo === null ? '' : r.moo).trim(),
      status: r.status,
      attendedDate: r.attendedAt ? Utilities.formatDate(new Date(r.attendedAt), tz, 'yyyy-MM-dd') : '',
      ptn: normText_(r.ptn),
      key: normText_(r.ptn) ? 'ptn:' + normText_(r.ptn) : patientKey_(r) // มี PTN ใช้ PTN นับคน (แม่นกว่าชื่อ)
    }));

  // วันแรกที่มีการกด "มาแล้ว" (ใช้ตัดสินว่านัดไหนมีข้อมูลการมาให้เทียบได้)
  let trackingStart = '';
  rows.forEach(a => { if (a.attendedDate && (!trackingStart || a.attendedDate < trackingStart)) trackingStart = a.attendedDate; });

  const inRange = rows.filter(a => a.date >= from && a.date <= to);
  const active = inRange.filter(a => a.status === 'active');
  const cancelled = inRange.filter(a => a.status === 'cancelled').length;
  const attended = active.filter(a => a.attendedDate);
  const upcoming = active.filter(a => a.date >= today && !a.attendedDate).length;

  const tracked = trackingStart ? active.filter(a => a.date < today && a.date >= trackingStart) : [];
  const trackedAttended = tracked.filter(a => a.attendedDate).length;
  const noShow = tracked.length - trackedAttended;
  const attendanceRate = tracked.length ? trackedAttended / tracked.length : null;

  const visitsByKey = {};
  attended.forEach(a => { visitsByKey[a.key] = (visitsByKey[a.key] || 0) + 1; });
  const keys = Object.keys(visitsByKey);

  const byType = APPT_TYPES.map(t => ({
    name: t,
    total: active.filter(a => a.type === t).length,
    attended: attended.filter(a => a.type === t).length
  }));

  const mooMap = {};
  active.forEach(a => {
    const m = a.moo || 'ไม่ระบุ';
    if (!mooMap[m]) mooMap[m] = { name: m, total: 0, attended: 0 };
    mooMap[m].total++;
    if (a.attendedDate) mooMap[m].attended++;
  });
  const byMoo = Object.keys(mooMap).map(k => mooMap[k])
    .sort((x, y) => (y.attended - x.attended) || (y.total - x.total) || cmpMoo_(x.name, y.name));

  // จำนวนครั้งรายคน (เฉพาะนัดที่ผูก PTN แล้ว) เรียงตามจำนวนครั้งที่มารับบริการ
  const nameOfPtn = {};
  patientsData_().forEach(p => { nameOfPtn[normText_(p.ptn)] = (normText_(p.firstName) + ' ' + normText_(p.lastName)).trim(); });
  const patientMap = {};
  active.forEach(a => {
    if (!a.ptn) return;
    if (!patientMap[a.ptn]) patientMap[a.ptn] = { ptn: a.ptn, name: nameOfPtn[a.ptn] || '', total: 0, attended: 0 };
    patientMap[a.ptn].total++;
    if (a.attendedDate) patientMap[a.ptn].attended++;
  });
  const allPatients = Object.keys(patientMap).map(k => patientMap[k])
    .sort((x, y) => (y.attended - x.attended) || (y.total - x.total) || (x.ptn < y.ptn ? -1 : 1));
  const BY_PATIENT_LIMIT = 30;

  // แยกตามคลินิก: ใช้การตั้งค่าคลินิก "ปัจจุบัน" ของแต่ละวันที่นัด
  const clinicCache = {};
  const clinicOf = date => {
    if (!(date in clinicCache)) {
      const c = resolveClinicForDate_(date);
      clinicCache[date] = c ? { name: c.name, color: c.color } : { name: 'ไม่ได้กำหนดคลินิก', color: '#9AA5A1' };
    }
    return clinicCache[date];
  };
  const clinicMap = {};
  active.forEach(a => {
    const c = clinicOf(a.date);
    if (!clinicMap[c.name]) clinicMap[c.name] = { name: c.name, color: c.color, total: 0, attended: 0 };
    clinicMap[c.name].total++;
    if (a.attendedDate) clinicMap[c.name].attended++;
  });
  const byClinic = Object.keys(clinicMap).map(k => clinicMap[k])
    .sort((x, y) => (y.attended - x.attended) || (y.total - x.total));

  // แยกตามวันในสัปดาห์ (จ-ศ, ส, อา)
  const wdNames = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 0: 'อาทิตย์' };
  const wdMap = {};
  [1, 2, 3, 4, 5, 6, 0].forEach(d => { wdMap[d] = { name: wdNames[d], total: 0, attended: 0 }; });
  active.forEach(a => {
    const d = new Date(a.date + 'T00:00:00Z').getUTCDay();
    wdMap[d].total++;
    if (a.attendedDate) wdMap[d].attended++;
  });
  const byWeekday = [1, 2, 3, 4, 5].map(d => wdMap[d]).concat([6, 0].map(d => wdMap[d]).filter(w => w.total > 0));

  // แนวโน้ม: รายวันถ้าช่วงไม่เกิน 45 วัน ไม่งั้นรายเดือน
  const granularity = spanDays <= 45 ? 'day' : 'month';
  const trend = [], idx = {};
  if (granularity === 'day') {
    for (let i = 0; i < spanDays; i++) {
      const k = addDaysStr_(from, i);
      idx[k] = trend.length;
      trend.push({ key: k, total: 0, attended: 0 });
    }
  } else {
    let cur = from.slice(0, 7);
    const endKey = to.slice(0, 7);
    while (cur <= endKey) {
      idx[cur] = trend.length;
      trend.push({ key: cur, total: 0, attended: 0 });
      let y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7)) + 1;
      if (m > 12) { m = 1; y++; }
      cur = y + '-' + String(m).padStart(2, '0');
    }
  }
  active.forEach(a => {
    const i = idx[granularity === 'day' ? a.date : a.date.slice(0, 7)];
    if (i !== undefined) {
      trend[i].total++;
      if (a.attendedDate) trend[i].attended++;
    }
  });

  return {
    ok: true,
    data: {
      from, to, today, trackingStart, granularity,
      totals: {
        appointments: active.length,
        attended: attended.length,
        upcoming,
        cancelled,
        noShow,
        trackedPast: tracked.length,
        attendanceRate,
        patientsSeen: keys.length,
        repeatPatients: keys.filter(k => visitsByKey[k] >= 2).length
      },
      byType, byMoo, byClinic, byWeekday, trend,
      byPatient: allPatients.slice(0, BY_PATIENT_LIMIT),
      byPatientTotal: allPatients.length
    }
  };
}

/* ---------------------------- Calendar / detail views ---------------------------- */

/** ดึงข้อมูลสรุปทั้งเดือน เพื่อวาดปฏิทิน (payload: {year, month}) */
/** เลขเวอร์ชันของข้อมูลปฏิทิน — เพิ่มขึ้นทุกครั้งที่มีการแก้ไขอะไรก็ตามที่กระทบหน้าปฏิทิน เพื่อล้างแคชผลลัพธ์เดือนทั้งหมดทันที */
function bumpCalendarVersion_() {
  const props = PropertiesService.getScriptProperties();
  const v = Number(props.getProperty('CAL_VERSION') || '1') + 1;
  props.setProperty('CAL_VERSION', String(v));
}
function getCalendarVersion_() {
  return PropertiesService.getScriptProperties().getProperty('CAL_VERSION') || '1';
}

function getCalendar_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month); // 1-12

  // แคชผลลัพธ์ทั้งเดือนไว้ฝั่งเซิร์ฟเวอร์ — เดือนที่เคยเปิดดูแล้วจะโหลดเกือบทันทีในครั้งถัดไป
  const cacheKey = 'calendar2_v' + getCalendarVersion_() + '_' + year + '_' + month;
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return { ok: true, data: JSON.parse(cached) };
  } catch (e) { /* แคชใช้ไม่ได้ก็คำนวณสดตามปกติ */ }

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);

  const closedDates = sheetData_(SHEET_CLOSED);
  const specialOpen = sheetData_(SHEET_SPECIAL_OPEN);
  const appts = sheetData_(SHEET_APPTS).filter(r => r.status === 'active');

  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = fmtDate_(d);
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const resolved = resolveDayOpen_(dateStr);
    const isClosed = !resolved.isOpen;
    const isSpecialOpen = resolved.source === 'special';

    const dayBusy = getBusyForDate_(dateStr); // รวม Busy รายวัน + กฎปิดอัตโนมัติตามวันที่ในเดือน
    const dayAppts = appts.filter(a => fmtDate_(a.date) === dateStr);
    const opdCount = dayAppts.filter(a => a.type === 'OPD').length;
    const communityCount = dayAppts.filter(a => a.type === 'ลงชุมชน').length;

    // นับจำนวนช่องเวลาที่ยังว่างอยู่ (เอาไว้โชว์ "ว่างอีก N" บนปฏิทิน)
    let slotsAvailable = null;
    let slotsTotal = 0;
    if (resolved.isOpen) {
      const slots = buildSlotsFromDefs_(resolved.slotDefs, dayBusy, dayAppts);
      slotsAvailable = slots.filter(s => s.available).length;
      slotsTotal = slots.length;
    }

    // แสดงคลินิกเฉพาะวันที่เปิดให้บริการจริง (วันปิดไม่มีความหมายที่จะขึ้นป้ายคลินิก)
    const clinic = resolved.isOpen ? resolveClinicForDate_(dateStr) : null;

    days.push({
      date: dateStr,
      isWeekend,
      isClosed,
      isSpecialOpen,
      closedReason: isClosed ? (resolved.reason || '') : '',
      busyTypes: [...new Set(dayBusy.map(b => b.type))],
      opdCount,
      communityCount,
      slotsAvailable,
      slotsTotal,
      clinicName: clinic ? clinic.name : null,
      clinicColor: clinic ? clinic.color : null,
      clinicNote: clinic ? clinic.note : ''
    });
  }

  try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(days), 3600); } catch (e) { /* ข้อมูลใหญ่เกินแคชได้ก็ข้ามไป */ }
  return { ok: true, data: days };
}

/** รายละเอียดของวันเดียว: ช่องเวลาว่าง + รายการนัด + busy + คลินิกวันนี้ (payload: {date}) */
function getDayDetail_(payload) {
  const date = payload.date;
  const resolved = resolveDayOpen_(date);

  const busy = getBusyForDate_(date); // รวม Busy รายวัน + กฎปิดอัตโนมัติตามวันที่ในเดือน
  const known9 = knownIcd9_();
  const appts = sheetData_(SHEET_APPTS)
    .filter(r => fmtDate_(r.date) === date && r.status === 'active')
    .sort((a, b) => a.startTime < b.startTime ? -1 : 1)
    .map(a => apptForClient_(a, known9));

  let slots = [];
  if (resolved.isOpen) {
    slots = buildSlotsFromDefs_(resolved.slotDefs, busy, appts);
  }

  const clinic = resolved.isOpen ? resolveClinicForDate_(date) : null;

  // รายการช่วงเวลาปกติของ "วันในสัปดาห์นี้" (ไม่ว่าวันนี้จะเปิดจริงหรือไม่) เอาไว้เป็นค่าตั้งต้นตอนกด "เปิดรับพิเศษ"
  const dow = new Date(date + 'T00:00:00').getDay();
  const weeklySlots = sheetData_(SHEET_SCHEDULE_SLOTS)
    .filter(r => Number(r.weekday) === dow)
    .map(r => ({ start: r.startTime, end: r.endTime }))
    .sort((a, b) => a.start < b.start ? -1 : 1);

  // ช่วงเวลาพิเศษเสริมที่เพิ่มไว้เฉพาะวันนี้ (แสดง+ลบทีละรายการได้ในแผงรายละเอียดวัน)
  const extraSlots = sheetData_(SHEET_EXTRA_SLOTS)
    .filter(r => fmtDate_(r.date) === date)
    .map(r => ({ id: r.id, start: r.startTime, end: r.endTime, note: r.note }))
    .sort((a, b) => a.start < b.start ? -1 : 1);

  return {
    ok: true,
    data: {
      date,
      isOpen: resolved.isOpen,
      isSpecialOpen: resolved.source === 'special',
      closedReason: resolved.reason || '',
      slotDefs: resolved.isOpen ? resolved.slotDefs : [],
      weeklySlots,
      extraSlots,
      busy,
      appointments: appts,
      slots,
      clinic: clinic
    }
  };
}

/** สร้างรายการช่วงเวลาจากที่กำหนดเองไว้ (ไม่ใช่การหารเท่าๆ กัน) พร้อมเช็คว่าช่วงไหนไม่ว่างแล้วบ้าง */
function buildSlotsFromDefs_(slotDefs, busy, appts) {
  return slotDefs.map(def => {
    const busyHit = busy.find(b => def.start < b.endTime && b.startTime < def.end);
    const apptHit = appts.find(a => def.start < a.endTime && a.startTime < def.end);
    return {
      start: def.start,
      end: def.end,
      available: !busyHit && !apptHit,
      busyType: busyHit ? busyHit.type : null,
      appointment: apptHit || null
    };
  });
}
