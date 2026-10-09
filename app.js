/**
 * ต้องแก้ API_URL ให้เป็น URL ของ Web App ที่ deploy จาก Google Apps Script
 * (ดูขั้นตอนใน README.md)
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbz4KXgSY-2DC0YJ0IqIV50D8VTZtXITHkyj5MP-ae9fOaJiaqg5tyHKxLTcxAm7XIf0/exec';

const state = {
  token: localStorage.getItem('token') || null,
  role: localStorage.getItem('role') || null,
  displayName: localStorage.getItem('displayName') || '',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  currentDate: null,
  currentDayDetail: null,
  clinicTypes: [],
  icd10Codes: [],
  icd9Codes: [],
  currentApptDetailId: null,
  settingsLoaded: false,
  patients: [],          // ทะเบียนคนไข้ (PTN) ใช้ค้นหา/เติมข้อมูลคนไข้เดิมในฟอร์มนัด
  patientsLoaded: false,
  pickedPatient: null,   // คนไข้เดิมที่กดเลือกไว้ในฟอร์มนัดที่กำลังเปิดอยู่
  patientSummary: null,  // สรุปประวัติของคนไข้ที่เลือกไว้ (จำนวนครั้ง นัดที่รออยู่ รหัสครั้งก่อน)
  prevIcdApplied: false  // กด "ใช้รหัสครั้งก่อน" ไว้หรือไม่
};

/* ---------------- สีคลินิก: กันตัวอักษรกลืนกับพื้นหลัง ----------------
 * สีคลินิกเลือกเองได้จากหน้าตั้งค่า (input type=color) จะได้สีอะไรก็ได้ ถ้าดันเลือกสีอ่อน
 * (เช่น เหลืองพาสเทล ชมพูอ่อน) แล้วเอาไปเป็นทั้งสีตัวอักษรและสีพื้นหลัง (หรือพื้นหลังที่เป็นเฉดอ่อนของสีเดียวกัน)
 * จะกลืนกันจนอ่านไม่ออก ฟังก์ชันพวกนี้คำนวณ contrast ตามสูตร WCAG แล้วปรับสีให้อ่านออกเสมอ
 */
function hexToRgb_(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}
function relLum_([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio_(hex1, hex2) {
  const l1 = relLum_(hexToRgb_(hex1));
  const l2 = relLum_(hexToRgb_(hex2));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
/**
 * ปรับสีคลินิกที่ตั้งไว้ (อาจเป็นสีสด เช่น น้ำเงินจัด ชมพูจัด เหลืองสะท้อนแสง) ให้เป็นโทนเอิร์ธ:
 * คง "เฉด" (hue) เดิมไว้เพื่อให้แต่ละคลินิกยังแยกกันออก แต่ลดความสดลงและทำให้เข้มลงนิดหน่อย
 * ออกมาเป็นสีหม่นๆ แบบดินเผา/มะกอก/น้ำเงินเทา/ม่วงโกโก้ ใช้พื้นหลังแถบชื่อคลินิก ตัวอักษรขาวอ่านชัดเสมอ
 */
function earthify_(hex) {
  const [r0, g0, b0] = hexToRgb_(hex).map(v => v / 255);
  const max = Math.max(r0, g0, b0), min = Math.min(r0, g0, b0);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r0) h = ((g0 - b0) / d) % 6;
    else if (max === g0) h = (b0 - r0) / d + 2;
    else h = (r0 - g0) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const s = 0.38;   // ความสดคงที่ค่อนข้างต่ำ = สีหม่นแบบธรรมชาติ
  const l = 0.34;   // เข้มพอให้ตัวอักษรขาวอ่านชัด
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return '#' + rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
/** เลือกว่าตัวอักษรบนพื้นหลังสีนี้ควรเป็นขาวหรือเข้ม โดยดูว่าแบบไหนคอนทราสต์ดีกว่า */
function readableTextOn_(bgHex) {
  const whiteContrast = contrastRatio_('#FFFFFF', bgHex);
  const inkContrast = contrastRatio_('#223029', bgHex);
  return whiteContrast >= inkContrast ? '#FFFFFF' : '#223029';
}

/* ---------------- API helper (ใช้ JSONP เพื่อเลี่ยงปัญหา CORS ของ Apps Script) ---------------- */

const JSONP_TIMEOUT_MS = 30000; // ถ้าเกิน 30 วิไม่มีการตอบกลับ ถือว่าเชื่อมต่อไม่สำเร็จ ไม่ปล่อยให้ค้างเงียบๆ ไม่มีที่สิ้นสุด

function jsonp_(action, payload) {
  return new Promise((resolve, reject) => {
    const callbackName = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('timeout'));
    }, JSONP_TIMEOUT_MS);

    window[callbackName] = (data) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('network error'));
    };

    const url = `${API_URL}?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(JSON.stringify(payload))}&callback=${callbackName}`;
    script.src = url;
    document.body.appendChild(script);
  });
}

// ปลุกสคริปต์ทันทีที่หน้าเว็บโหลด (ก่อนผู้ใช้กดอะไรเลย) เผื่อเครื่องเย็นอยู่ (ไม่มีคนใช้มาสักพัก)
// กว่าผู้ใช้จะพิมพ์ชื่อ/รหัสผ่านแล้วกดเข้าสู่ระบบเสร็จ สคริปต์มักจะอุ่นพอแล้ว ไม่ต้องรอผลอะไรจากตรงนี้
jsonp_('ping', {}).catch(() => {});

async function api(action, payload = {}) {
  if (state.token) payload.token = state.token;
  let data;
  try {
    data = await jsonp_(action, payload);
  } catch (e) {
    return { ok: false, error: 'เชื่อมต่อไม่สำเร็จ (หมดเวลารอ) กรุณาลองใหม่อีกครั้ง' };
  }
  if (!data.ok && data.error === 'กรุณาเข้าสู่ระบบใหม่') {
    logout();
  }
  // การกระทำใดๆ ที่ไม่ใช่ "get..." ถือว่าเป็นการแก้ไขข้อมูล ต้องล้างแคชปฏิทินที่ดักไว้ล่วงหน้าทันที
  // มิเช่นนั้นจะเห็นข้อมูลเก่าค้างอยู่หลังบันทึก/ยกเลิก/แก้ไขต่างๆ
  if (data.ok && action !== 'login' && action !== 'markAttended' && action.indexOf('get') !== 0) {
    Object.keys(_calendarPrefetchCache_).forEach(k => delete _calendarPrefetchCache_[k]);
  }
  return data;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ---------------- Auth ---------------- */

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  const res = await api('login', { username, password });
  if (!res.ok) { errEl.textContent = res.error; return; }

  state.token = res.token;
  state.role = res.role;
  state.displayName = res.displayName;
  localStorage.setItem('token', res.token);
  localStorage.setItem('role', res.role);
  localStorage.setItem('displayName', res.displayName);
  enterApp();
});

function logout() {
  state.token = null;
  state.patients = [];
  state.patientsLoaded = false;
  state.pickedPatient = null;
  localStorage.clear();
  document.getElementById('appView').classList.add('hidden');
  document.getElementById('loginView').classList.remove('hidden');
}
document.getElementById('logoutBtn')?.addEventListener('click', logout);

function enterApp() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('whoName').textContent = state.displayName;
  document.getElementById('whoRole').textContent = state.role === 'physio' ? 'นักกายภาพบำบัด' : 'เจ้าหน้าที่นัดหมาย';
  document.querySelectorAll('.physio-only').forEach(el => {
    el.style.display = state.role === 'physio' ? '' : 'none';
  });
  // ปฏิทินสำคัญที่สุด ให้ขึ้นก่อนโดยไม่ต้องแย่งคิว Apps Script กับคำขออื่น
  // (ยิงหลายคำขอพร้อมกันตอนเปิดเว็บทำให้ทุกอย่างช้าลง เพราะ Apps Script จำกัดจำนวนที่ทำงานพร้อมกันได้)
  renderCalendar().then(() => {
    if (state.role === 'physio') refreshClinicTypes();
    refreshIcdCodes().then(refreshPatients); // ทะเบียนคนไข้โหลดต่อท้าย ไม่แย่งคิวกับคำขออื่น
  });
}

/* ---------------- Navigation ---------------- */

document.querySelectorAll('.navBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.navBtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.getElementById('calendarView').classList.toggle('hidden', view !== 'calendar');
    document.getElementById('settingsView').classList.toggle('hidden', view !== 'settings');
    document.getElementById('dashboardView')?.classList.toggle('hidden', view !== 'dashboard');
    if (view === 'settings' && !state.settingsLoaded) loadSettings();
    if (view === 'dashboard' && !state.dashboardLoaded) { setDashPreset_('thisMonth'); loadDashboard(); }
  });
});

/* ---------------- ปฏิทิน ---------------- */

const MONTH_NAMES = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

document.getElementById('prevMonth')?.addEventListener('click', () => shiftMonth(-1));
document.getElementById('nextMonth')?.addEventListener('click', () => shiftMonth(1));

function shiftMonth(delta) {
  state.month += delta;
  if (state.month < 1) { state.month = 12; state.year--; }
  if (state.month > 12) { state.month = 1; state.year++; }
  renderCalendar();
}

let _calendarReqId_ = 0; // กันปัญหาเดือนค้าง: ถ้ากดเปลี่ยนเดือนเร็วๆ ผลลัพธ์เก่าที่มาช้ากว่าจะถูกทิ้งไป ไม่ทับของใหม่
const _calendarPrefetchCache_ = {}; // เก็บผลลัพธ์เดือนที่ดึงไว้ล่วงหน้า key: "year-month"

function fetchCalendarMonth_(year, month) {
  const key = year + '-' + month;
  if (!_calendarPrefetchCache_[key]) {
    _calendarPrefetchCache_[key] = api('getCalendar', { year, month }).then(res => {
      // อย่าแคชผลลัพธ์ที่ล้มเหลวไว้ถาวร (เช่น จากการดักโหลดล่วงหน้าเบื้องหลังที่พลาด) มิเช่นนั้นครั้งหน้าจะเจอ error ซ้ำเดิมตลอด
      if (!res.ok) delete _calendarPrefetchCache_[key];
      return res;
    });
  }
  return _calendarPrefetchCache_[key];
}

async function renderCalendar() {
  const reqId = ++_calendarReqId_;
  const reqYear = state.year, reqMonth = state.month; // จับค่าปี/เดือนไว้ตอนเริ่มคำขอ ใช้ค่านี้ตลอดฟังก์ชัน
  // กันเดือนค้าง: ไม่อิง state.year/state.month ซ้ำหลัง await เพราะระหว่างรอ ผู้ใช้อาจกดเปลี่ยนเดือนอีกจนค่าถูกเขียนทับไปแล้ว
  document.getElementById('monthLabel').textContent = `${MONTH_NAMES[reqMonth - 1]} ${reqYear + 543}`;
  document.getElementById('prevMonth').disabled = true;
  document.getElementById('nextMonth').disabled = true;

  const grid = document.getElementById('calendarGrid');
  grid.classList.add('loading');
  if (!grid.children.length) grid.innerHTML = '<div class="calendar-loading-msg">กำลังโหลดปฏิทิน...</div>';

  const res = await fetchCalendarMonth_(reqYear, reqMonth);

  document.getElementById('prevMonth').disabled = false;
  document.getElementById('nextMonth').disabled = false;
  // เช็คสองชั้น: ทั้งเลขคำขอ (กันคำขอเก่าที่มาช้ากว่า) และเดือน/ปีที่กำลังแสดงอยู่จริงตอนนี้ (กันทุกกรณีที่คิดไม่ถึง)
  if (reqId !== _calendarReqId_ || state.year !== reqYear || state.month !== reqMonth) return;
  grid.classList.remove('loading');
  if (!res.ok) {
    delete _calendarPrefetchCache_[reqYear + '-' + reqMonth]; // เผื่อโหลดพลาด ครั้งหน้าจะได้ลองใหม่
    // ต้องล้างข้อความ "กำลังโหลดปฏิทิน..." ออกด้วย ไม่งั้นจะค้างคาอยู่แบบนั้นตลอดไปแม้ error จะเกิดขึ้นแล้วจริงๆ
    grid.innerHTML = `<div class="calendar-loading-msg">โหลดปฏิทินไม่สำเร็จ: ${res.error || 'ไม่ทราบสาเหตุ'} — <a href="#" id="calendarRetryLink">ลองใหม่</a></div>`;
    document.getElementById('calendarRetryLink')?.addEventListener('click', (e) => { e.preventDefault(); renderCalendar(); });
    toast(res.error);
    return;
  }

  grid.innerHTML = '';

  // ตัดเสาร์-อาทิตย์ออกจากปฏิทินไปเลย ไม่แสดงเป็นคอลัมน์อีกต่อไป (เหลือแค่ จ-ศ)
  const weekdayDays = res.data.filter(day => {
    const dow = new Date(day.date + 'T00:00:00').getDay();
    return dow !== 0 && dow !== 6;
  });

  if (weekdayDays.length) {
    // จำนวนช่องว่างนำหน้า คำนวณจากวันในสัปดาห์ (จ=0 ... ศ=4) ของวันทำการวันแรกของเดือน
    const firstDow = new Date(weekdayDays[0].date + 'T00:00:00').getDay(); // 1(จ)-5(ศ)
    const leadingBlank = firstDow - 1;
    for (let i = 0; i < leadingBlank; i++) {
      const blank = document.createElement('div');
      blank.className = 'day-cell other-month';
      grid.appendChild(blank);
    }
  }

  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  state.calendarTodayStr_ = todayStr;

  // ไฮไลต์ชื่อวันในหัวตารางของ "วันนี้" (เฉพาะตอนที่กำลังดูเดือนปัจจุบัน และวันนี้ไม่ใช่เสาร์-อาทิตย์)
  document.querySelectorAll('.weekday-row span').forEach((el, i) => {
    const todayDow = now.getDay(); // 0(อา)-6(ส)
    const isTodayCol = reqYear === now.getFullYear() && reqMonth === now.getMonth() + 1 &&
      todayDow >= 1 && todayDow <= 5 && i === todayDow - 1;
    el.classList.toggle('today-col', isTodayCol);
  });

  // เก็บข้อมูลดิบของแต่ละวันไว้ใน state ด้วย (key: วันที่) เพื่อให้ "ยกเลิกนัด" แก้ไขช่องของวันนั้นในเครื่องได้ทันที
  // โดยไม่ต้องขอข้อมูลทั้งเดือนใหม่จากเซิร์ฟเวอร์อีกรอบ (ลดเวลารอหลังกดยกเลิกไปได้มาก)
  state.calendarDaysByDate_ = {};
  weekdayDays.forEach(day => {
    state.calendarDaysByDate_[day.date] = day;
    grid.appendChild(buildDayCellEl_(day));
  });
}

/** สร้าง element ของช่องวันหนึ่งในปฏิทิน จาก object ข้อมูลวันนั้น (ใช้ร่วมกันทั้งตอน render เต็มเดือน และตอนแก้ไขเฉพาะวันในเครื่องหลังยกเลิกนัด) */
function buildDayCellEl_(day) {
  const cell = document.createElement('div');
  const isToday = day.date === state.calendarTodayStr_;
  const isFull = !day.isClosed && day.slotsTotal > 0 && day.slotsAvailable === 0;
  cell.className = 'day-cell' + (day.isClosed ? ' closed' : '') + (day.clinicColor ? ' has-clinic' : '') +
    (isToday ? ' today' : '') + (isFull ? ' full' : '');
  cell.dataset.date = day.date;
  const clinicBg = day.clinicColor ? earthify_(day.clinicColor) : '';
  if (clinicBg) cell.style.setProperty('--clinic-color', clinicBg);
  const dayNum = Number(day.date.split('-')[2]);

  const clinicTextColor = clinicBg ? readableTextOn_(clinicBg) : '';
  const clinicLine = day.clinicName
    ? `<div class="clinic-line" style="background:${clinicBg};color:${clinicTextColor}" title="${(day.clinicNote || '').replace(/"/g, '')}">${day.clinicName}</div>`
    : '';

  const badges = [];
  if (day.isSpecialOpen) badges.push(`<span class="badge special-tag">เปิดพิเศษ</span>`);
  if (isFull) {
    badges.push(`<span class="badge full-tag">เต็ม</span>`);
  } else if (!day.isClosed && day.slotsAvailable !== null && day.slotsAvailable !== undefined) {
    badges.push(`<span class="badge avail-tag">ว่างอีก ${day.slotsAvailable}</span>`);
  }
  if (day.opdCount) badges.push(`<span class="badge opd">OPD ${day.opdCount}</span>`);
  if (day.communityCount) badges.push(`<span class="badge community">ลงชุมชน ${day.communityCount}</span>`);
  day.busyTypes.forEach(t => badges.push(`<span class="badge busy">${t}</span>`));
  if (day.isClosed && day.isWeekend && day.busyTypes.length === 0 && !day.opdCount && !day.communityCount) {
    // วันหยุดสุดสัปดาห์ ไม่ต้องมี badge เพิ่ม
  } else if (day.isClosed && !day.isWeekend) {
    badges.push(`<span class="badge closed-tag">ปิด${day.closedReason ? ': ' + day.closedReason : ''}</span>`);
  }

  cell.innerHTML = `${clinicLine}<div class="day-head"><div class="day-num">${dayNum}</div>${isToday ? '<span class="today-tag">วันนี้</span>' : ''}</div><div class="day-badges">${badges.join('')}</div>`;
  // นักกายภาพคลิกวันปิดได้ด้วย เพื่อใช้ปุ่ม "เปิดรับพิเศษวันนี้"; เจ้าหน้าที่นัดคลิกได้เฉพาะวันเปิด
  if (!day.isClosed || state.role === 'physio') {
    cell.addEventListener('click', () => openDayPanel(day.date));
  }
  return cell;
}

/**
 * แก้ไขช่องวันเดียวในปฏิทินให้ตรงกับการยกเลิกนัดที่เพิ่งทำในเครื่อง โดยไม่ขอข้อมูลทั้งเดือนใหม่จากเซิร์ฟเวอร์
 * ใช้ได้เฉพาะตอนที่ปฏิทินเดือนปัจจุบันเคยโหลดสำเร็จมาก่อนแล้วเท่านั้น (ถ้ายังไม่มีข้อมูลวันนั้นเก็บไว้ ให้ไปขอใหม่ตามปกติแทน)
 */
function patchCalendarDayAfterCancel_(dateStr, apptType, newSlotsAvailable) {
  const day = state.calendarDaysByDate_ && state.calendarDaysByDate_[dateStr];
  if (!day) { renderCalendar(); return; } // ไม่มีข้อมูลเดิมเก็บไว้ (เช่น ยังไม่เคยโหลดเดือนนี้สำเร็จ) ไปขอใหม่ตามปกติ

  if (apptType === 'OPD') day.opdCount = Math.max(0, (day.opdCount || 0) - 1);
  else if (apptType === 'ลงชุมชน') day.communityCount = Math.max(0, (day.communityCount || 0) - 1);
  if (newSlotsAvailable !== null && newSlotsAvailable !== undefined) day.slotsAvailable = newSlotsAvailable;

  const oldCell = document.querySelector(`#calendarGrid .day-cell[data-date="${dateStr}"]`);
  if (!oldCell) return; // วันนั้นไม่ได้อยู่ในหน้าปฏิทินที่กำลังแสดงอยู่ตอนนี้ (เช่น สลับเดือนไปแล้ว) ไม่ต้องทำอะไรต่อ
  oldCell.replaceWith(buildDayCellEl_(day));
}

function prefetchAdjacentMonths_() {
  let py = state.year, pm = state.month - 1;
  if (pm < 1) { pm = 12; py--; }
  let ny = state.year, nm = state.month + 1;
  if (nm > 12) { nm = 1; ny++; }
  fetchCalendarMonth_(py, pm);
  fetchCalendarMonth_(ny, nm);
}

/* ---------------- แผงรายละเอียดวัน ---------------- */

const dayPanel = document.getElementById('dayPanel');
const dayPanelBackdrop = document.getElementById('dayPanelBackdrop');

document.getElementById('closeDayPanel')?.addEventListener('click', closeDayPanel);
dayPanelBackdrop?.addEventListener('click', closeDayPanel);

function closeDayPanel() {
  dayPanel.classList.add('hidden');
  dayPanelBackdrop.classList.add('hidden');
}

async function openDayPanel(dateStr) {
  state.currentDate = dateStr;
  const res = await api('getDayDetail', { date: dateStr });
  if (!res.ok) { toast(res.error); return; }
  state.currentDayDetail = res.data;

  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  document.getElementById('dayPanelTitle').textContent =
    `วัน${weekdays[d.getDay()]}ที่ ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear() + 543}`;

  const closedNote = document.getElementById('dayPanelClosedNote');
  if (!res.data.isOpen) {
    closedNote.textContent = res.data.closedReason ? `ปิดทำการ: ${res.data.closedReason}` : 'ปิดทำการวันนี้';
    closedNote.classList.remove('hidden');
  } else {
    closedNote.classList.add('hidden');
  }

  renderSlots(res.data.slots);
  renderApptList(res.data.appointments);
  renderClinicDisplay(res.data.clinic);
  renderClinicEditor(res.data.clinic);
  renderDayToggleActions(res.data);
  renderExtraSlotList(res.data.extraSlots);
  renderBusyList(res.data.busy);

  dayPanel.classList.remove('hidden');
  dayPanelBackdrop.classList.remove('hidden');
}

function renderSlots(slots) {
  const box = document.getElementById('slotList');
  box.innerHTML = '';
  if (!slots.length) { box.innerHTML = '<span style="color:var(--ink-soft);font-size:13px;">ไม่มีช่วงเวลาให้บริการ</span>'; return; }
  slots.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'slot-btn ' + (s.available ? 'available' : 'taken');
    btn.textContent = s.start;
    const reason = s.available ? 'ว่าง' : (s.busyType ? `ไม่ว่าง: ${s.busyType}` : (s.appointment ? `มีนัด: ${s.appointment.firstName} ${s.appointment.lastName}` : 'ไม่ว่าง'));
    btn.title = reason;
    if (s.available) {
      // นักกายภาพกดช่องว่างแล้วเลือกได้เลยว่าจะจองนัด หรือจะปิดช่วงนี้ (ตั้งไม่ว่าง) ในขั้นตอนเดียว ไม่ต้องสลับไปกดปุ่มอื่นแยก
      // ส่วนเจ้าหน้าที่ (staff) ไม่มีสิทธิ์ปิดช่วงเวลา กดแล้วไปหน้าจองนัดตรงทันทีเหมือนเดิม
      btn.addEventListener('click', () => {
        if (state.role === 'physio') openSlotActionModal_(s.start, s.end);
        else openApptModal(s.start);
      });
    } else {
      // เดิมกดช่องที่ไม่ว่างแล้วไม่มีอะไรเกิดขึ้นเลย ผู้ใช้ไม่รู้ว่าทำไมถึงจองไม่ได้ — เปลี่ยนให้กดแล้วบอกเหตุผลทันที
      btn.addEventListener('click', () => toast(`ช่วง ${s.start}-${s.end} ${reason}`));
    }
    box.appendChild(btn);
  });
}

/** แสดงรายการ "ช่วงไม่ว่าง" ของวันนี้ (ทั้งที่เพิ่มเองรายวัน และที่มาจากกฎอัตโนมัติ) ให้เห็นในแผงรายละเอียดวันเลย
 *  ไม่ใช่แค่ป้ายบนปฏิทินเดือนเท่านั้น — เดิมข้อมูลนี้ถูกดึงมาอยู่แล้วแต่ไม่เคยถูกแสดงผลที่นี่ */
function renderBusyList(busy) {
  const section = document.getElementById('busySection');
  const list = document.getElementById('busyList');
  if (!section || !list) return;
  if (!busy || !busy.length) { section.classList.add('hidden'); list.innerHTML = ''; return; }
  section.classList.remove('hidden');
  list.innerHTML = '';
  busy.forEach(b => {
    const isFromRule = String(b.id).indexOf('rule-') === 0; // มาจากกฎอัตโนมัติ ("ปิด/ไม่ว่างอัตโนมัติ" ในหน้าตั้งค่า) แก้/ลบจากตรงนี้ไม่ได้ ต้องไปทำที่หน้าตั้งค่า
    const canEdit = !isFromRule && state.role === 'physio';
    const li = document.createElement('li');
    // แสดงเป็น "เหตุผล เวลาเริ่ม ถึง เวลาสิ้นสุด" อ่านง่ายกว่ารูปแบบ "เวลา-เวลา เหตุผล" เดิม
    li.innerHTML = `<span>${b.type || 'ไม่ว่าง'} ${b.startTime} ถึง ${b.endTime}${b.note ? ' — ' + b.note : ''}${isFromRule ? ' <span class="badge avail-tag">กฎอัตโนมัติ</span>' : ''}</span>` +
      (canEdit ? `<span class="busy-item-actions"><button class="busy-edit-btn" data-edit-id="${b.id}">แก้ไข</button><button data-id="${b.id}">ลบ</button></span>` : '');
    list.appendChild(li);
  });
  list.querySelectorAll('button[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = (busy || []).find(x => x.id === btn.dataset.editId);
      if (b) openBusyModal_(b);
    });
  });
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api('removeBusy', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); return; }
      toast('ลบช่วงไม่ว่างแล้ว');
      await Promise.all([openDayPanel(state.currentDate), renderCalendar()]); // ส่งผลต่อช่วงเวลาว่าง/จำนวนในปฏิทิน จึงต้องโหลดใหม่ทั้งคู่
    });
  });
}

function renderApptList(appts) {
  const list = document.getElementById('apptList');
  list.innerHTML = '';
  if (!appts.length) { list.innerHTML = '<li style="border:none;color:var(--ink-soft);">ยังไม่มีนัดหมาย</li>'; return; }
  state.currentAppts = appts; // เก็บไว้ใช้เปิดดูรายละเอียด
  const isPhysio = state.role === 'physio';
  appts.forEach(a => {
    const li = document.createElement('li');
    li.dataset.viewId = a.id;
    li.style.cursor = 'pointer';
    if (a.attendedAt) li.classList.add('attended');

    // ปุ่มด้านล่างของแต่ละนัด: มาแล้ว (นักกายภาพ) / ยกเลิกนัด (เฉพาะที่ยังไม่มา)
    let actions = '';
    if (a.attendedAt) {
      if (isPhysio) actions += `<button class="appt-unattend" data-id="${a.id}">ยกเลิกการบันทึก "มาแล้ว"</button>`;
    } else {
      if (isPhysio) actions += `<button class="appt-attend" data-id="${a.id}">มาแล้ว ✓</button>`;
      actions += `<button class="appt-cancel" data-id="${a.id}">ยกเลิกนัด</button>`;
    }

    li.innerHTML = `
      <div><span class="appt-time">${a.startTime}-${a.endTime}</span>${a.firstName} ${a.lastName}
        <span class="badge ${a.type === 'OPD' ? 'opd' : 'community'}">${a.type}</span>
        ${a.attendedAt ? '<span class="badge attended-tag">มาแล้ว ✓</span>' : ''}</div>
      <div style="color:var(--ink-soft);font-size:12px;">${a.ptn ? a.ptn + ' · ' : ''}หมู่ ${a.moo}${a.phone ? ' · โทร ' + a.phone : ''}</div>
      ${actions ? `<div class="appt-actions">${actions}</div>` : ''}`;
    list.appendChild(li);
  });

  list.querySelectorAll('li[data-view-id]').forEach(li => {
    li.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // กดปุ่มในรายการ ไม่ต้องเปิดรายละเอียด
      const appt = state.currentAppts.find(a => a.id === li.dataset.viewId);
      if (appt) openApptDetail(appt);
    });
  });

  list.querySelectorAll('.appt-cancel').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('ยืนยันยกเลิกนัดนี้?')) return;
      btn.disabled = true;
      btn.textContent = 'กำลังยกเลิก...';
      const res = await api('cancelAppointment', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); btn.disabled = false; btn.textContent = 'ยกเลิกนัด'; return; }
      toast('ยกเลิกนัดแล้ว');
      applyLocalCancel_(btn.dataset.id);
    });
  });

  // บันทึก/ยกเลิกการบันทึกว่า "มาทำกายภาพแล้ว"
  // ไม่กระทบจำนวน OPD/ชุมชนหรือช่วงเวลาว่างในปฏิทิน จึงอัปเดตเฉพาะข้อมูลในเครื่อง (local state)
  // แล้ว render รายการนัดใหม่ทันที โดยไม่ต้องยิง getDayDetail ซ้ำ — เร็วขึ้นมาก ไม่มีการรอเครือข่ายรอบสอง
  list.querySelectorAll('.appt-attend, .appt-unattend').forEach(btn => {
    btn.addEventListener('click', async () => {
      const attended = btn.classList.contains('appt-attend');
      btn.disabled = true;
      const res = await api('markAttended', { id: btn.dataset.id, attended });
      if (!res.ok) { toast(res.error); btn.disabled = false; return; }
      toast(attended ? 'บันทึกว่ามาทำกายภาพแล้ว' : 'ยกเลิกการบันทึกแล้ว');
      const appt = (state.currentDayDetail?.appointments || []).find(a => a.id === btn.dataset.id);
      if (appt) {
        appt.attendedAt = attended ? new Date().toISOString() : '';
        appt.attendedBy = attended ? state.displayName : '';
        renderApptList(state.currentDayDetail.appointments);
      } else {
        // ไม่พบใน state (ไม่ควรเกิดขึ้น) — สำรองด้วยการโหลดใหม่
        await openDayPanel(state.currentDate);
      }
    });
  });
}

/**
 * คำนวณช่วงเวลาว่าง/ไม่ว่างใหม่ในเครื่อง — สูตรเดียวกับ buildSlotsFromDefs_ ฝั่งเซิร์ฟเวอร์ (Code.gs) ทุกประการ
 * ใช้คู่กับ applyLocalCancel_ เพื่อเลี่ยงการขอ getDayDetail ใหม่หลังยกเลิกนัด
 */
function recomputeSlots_(slotDefs, busy, appts) {
  return (slotDefs || []).map(def => {
    const busyHit = (busy || []).find(b => def.start < b.endTime && b.startTime < def.end);
    const apptHit = (appts || []).find(a => def.start < a.endTime && a.startTime < def.end);
    return {
      start: def.start,
      end: def.end,
      available: !busyHit && !apptHit,
      busyType: busyHit ? busyHit.type : null,
      appointment: apptHit || null
    };
  });
}

/**
 * ยกเลิกนัดสำเร็จฝั่งเซิร์ฟเวอร์แล้ว — อัปเดตแผงรายละเอียดวันและช่องในปฏิทินให้ตรงกันในเครื่องทันที
 * โดยไม่ต้องขอ getDayDetail/getCalendar ใหม่เลย (ทั้งสองตัวเป็นคำขอที่หนักกว่าตัวอื่นๆ ในหน้านี้
 * เพราะต้องคำนวณช่วงเวลาทั้งหมดของวัน/เดือนใหม่ ยิ่งถ้า Apps Script กำลังหน่วงอยู่ จะยิ่งรอนาน)
 * ใช้ได้เพราะเรารู้ข้อมูลของนัดที่ถูกยกเลิกอยู่แล้วในเครื่อง (วันที่ ช่วงเวลา ประเภท) และมีสูตรคำนวณช่วงว่างเหมือนฝั่งเซิร์ฟเวอร์ทุกประการ
 */
function applyLocalCancel_(apptId) {
  const detail = state.currentDayDetail;
  if (!detail) { renderCalendar(); return; }
  const idx = (detail.appointments || []).findIndex(a => a.id === apptId);
  if (idx === -1) { openDayPanel(state.currentDate); return; } // ไม่พบในเครื่อง (ไม่ควรเกิดขึ้น) — สำรองด้วยการโหลดใหม่
  const [cancelled] = detail.appointments.splice(idx, 1);

  if (detail.isOpen) {
    detail.slots = recomputeSlots_(detail.slotDefs, detail.busy, detail.appointments);
  }
  renderApptList(detail.appointments);
  renderSlots(detail.slots);

  const newSlotsAvailable = detail.isOpen ? detail.slots.filter(s => s.available).length : null;
  patchCalendarDayAfterCancel_(state.currentDate, cancelled.type, newSlotsAvailable);
}

/* ---------------- ดูรายละเอียดนัดหมาย ---------------- */

const apptDetailModal = document.getElementById('apptDetailModal');
const apptDetailModalBackdrop = document.getElementById('apptDetailModalBackdrop');

function fmtDateTime_(v) {
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

function openApptDetail(a) {
  // ข้อมูลที่แก้ไขได้ย้ายไปเป็นช่องกรอกด้านล่างทั้งหมด ตรงนี้แสดงเฉพาะสถานะ/ผู้บันทึก/รหัส ICD (ดูอย่างเดียว)
  const rows = [
    ['PTN', a.ptn || '-'],
    ['วันที่นัด', state.currentDate || '-'],
    ['รหัส ICD-10', formatIcdList_(a.icd10, state.icd10Codes) || '-'],
    ['รหัส ICD-9', formatIcdList_(a.icd9, state.icd9Codes) || '-'],
    ['สถานะ', a.attendedAt ? `มาทำกายภาพแล้ว (${fmtDateTime_(a.attendedAt)})` : 'ยังไม่ได้บันทึกว่ามา'],
    ['บันทึกนัดโดย', a.createdBy || '-']
  ];
  document.getElementById('apptDetailBody').innerHTML = rows.map(([label, value]) =>
    `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`
  ).join('');

  state.currentApptDetailId = a.id;

  document.getElementById('detailType').value = a.type;
  document.getElementById('detailFirstName').value = a.firstName || '';
  document.getElementById('detailLastName').value = a.lastName || '';
  document.getElementById('detailMoo').value = a.moo || '';
  document.getElementById('detailPhone').value = a.phone || '';
  document.getElementById('detailNote').value = a.note || '';
  document.getElementById('detailNationalId').value = a.nationalId || '';
  // เวลา: เลือกได้เฉพาะช่วงที่ว่าง + ช่วงเดิมของนัดนี้เอง
  const timeSel = document.getElementById('detailTime');
  timeSel.innerHTML = '';
  (state.currentDayDetail?.slots || []).filter(s => s.available || s.start === a.startTime).forEach(s => {
    const opt = document.createElement('option');
    opt.value = `${s.start}|${s.end}`;
    opt.textContent = `${s.start} - ${s.end}`;
    timeSel.appendChild(opt);
  });
  if (!timeSel.querySelector(`option[value="${a.startTime}|${a.endTime}"]`)) {
    const opt = document.createElement('option');
    opt.value = `${a.startTime}|${a.endTime}`;
    opt.textContent = `${a.startTime} - ${a.endTime}`;
    timeSel.appendChild(opt);
  }
  timeSel.value = `${a.startTime}|${a.endTime}`;
  document.getElementById('detailSaveError').textContent = '';
  const saveAllBtn = document.getElementById('detailSaveAllBtn');
  if (saveAllBtn) saveAllBtn.style.display = a.status === 'cancelled' ? 'none' : '';

  const cancelBtn = document.getElementById('apptDetailCancelBtn');
  cancelBtn.dataset.id = a.id;
  cancelBtn.style.display = a.attendedAt ? 'none' : ''; // มาแล้วห้ามยกเลิกนัด (ต้องยกเลิกการบันทึกก่อน)

  const attendBtn = document.getElementById('apptDetailAttendBtn');
  if (attendBtn) {
    attendBtn.dataset.id = a.id;
    attendBtn.dataset.attended = a.attendedAt ? '1' : '';
    attendBtn.textContent = a.attendedAt ? 'ยกเลิกการบันทึก "มาแล้ว"' : 'บันทึกว่ามาทำกายภาพแล้ว ✓';
    attendBtn.className = (a.attendedAt ? 'secondary' : 'primary') + ' physio-only';
  }

  // แก้ไข/เพิ่มรหัส ICD ของนัดที่จองไปแล้ว (เฉพาะนักกายภาพ, นัดที่ยังไม่ถูกยกเลิก)
  const auto10 = autoCodeOf_(state.icd10Codes), auto9 = autoCodeOf_(state.icd9Codes);
  const icd10Sel = String(a.icd10 || '').split(',').map(s => s.trim()).filter(c => c && c !== auto10);
  const icd9Sel = String(a.icd9 || '').split(',').map(s => s.trim()).filter(c => c && c !== auto9);
  renderIcdSlots_('detailIcd10Slots', state.icd10Codes, 2, icd10Sel);
  renderIcdSlots_('detailIcd9Slots', state.icd9Codes, 6, icd9Sel);

  apptDetailModal?.classList.remove('hidden');
  apptDetailModalBackdrop?.classList.remove('hidden');
}

document.getElementById('detailSaveAllBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const errEl = document.getElementById('detailSaveError');
  errEl.textContent = '';
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  const val = document.getElementById('detailNationalId').value.trim();
  const [startTime, endTime] = document.getElementById('detailTime').value.split('|');
  const info = {
    id: state.currentApptDetailId,
    type: document.getElementById('detailType').value,
    startTime, endTime,
    firstName: document.getElementById('detailFirstName').value.trim(),
    lastName: document.getElementById('detailLastName').value.trim(),
    moo: document.getElementById('detailMoo').value.trim(),
    phone: document.getElementById('detailPhone').value.trim(),
    note: document.getElementById('detailNote').value.trim(),
    nationalId: val
  };
  const tasks = [api('updateAppointmentInfo', info)];
  if (state.role === 'physio') {
    tasks.push(api('updateAppointmentIcd', {
      id: state.currentApptDetailId,
      icd10: gatherIcdSlots_('detailIcd10Slots'),
      icd9: gatherIcdSlots_('detailIcd9Slots')
    }));
  }
  const results = await Promise.all(tasks);
  btn.disabled = false;
  btn.textContent = originalText;

  const failed = results.find(r => !r.ok);
  if (failed) { errEl.textContent = failed.error; return; }
  upsertPatient_(results[0].patient);
  toast('บันทึกการแก้ไขแล้ว');
  // ชื่อ/ประเภท/เวลาเปลี่ยนแล้ว กระทบทั้งแผงวันและตัวเลขบนปฏิทิน จึงโหลดใหม่ทั้งคู่
  closeApptDetail();
  await Promise.all([openDayPanel(state.currentDate), renderCalendar()]);
});
function closeApptDetail() {
  apptDetailModal?.classList.add('hidden');
  apptDetailModalBackdrop?.classList.add('hidden');
}
document.getElementById('apptDetailCloseBtn')?.addEventListener('click', closeApptDetail);
document.getElementById('apptDetailAttendBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const attended = !btn.dataset.attended; // ตอนนี้ยังไม่มา -> บันทึกว่ามา / ตอนนี้มาแล้ว -> ยกเลิกการบันทึก
  btn.disabled = true;
  const res = await api('markAttended', { id: btn.dataset.id, attended });
  btn.disabled = false;
  if (!res.ok) { toast(res.error); return; }
  toast(attended ? 'บันทึกว่ามาทำกายภาพแล้ว' : 'ยกเลิกการบันทึกแล้ว');
  // ไม่กระทบปฏิทินเช่นเดียวกับปุ่มในรายการ — อัปเดต state ในเครื่องแล้ว render รายการใหม่ทันที
  const appt = (state.currentDayDetail?.appointments || []).find(a => a.id === btn.dataset.id);
  if (appt) {
    appt.attendedAt = attended ? new Date().toISOString() : '';
    appt.attendedBy = attended ? state.displayName : '';
    renderApptList(state.currentDayDetail.appointments);
  }
  closeApptDetail();
});
apptDetailModalBackdrop?.addEventListener('click', closeApptDetail);
document.getElementById('apptDetailCancelBtn')?.addEventListener('click', async (e) => {
  if (!confirm('ยืนยันยกเลิกนัดนี้?')) return;
  const id = e.target.dataset.id;
  e.target.disabled = true;
  const res = await api('cancelAppointment', { id });
  e.target.disabled = false;
  if (!res.ok) { toast(res.error); return; }
  toast('ยกเลิกนัดแล้ว');
  closeApptDetail();
  applyLocalCancel_(id);
});

/* ---------------- คลินิกประจำวัน (แสดง + แก้ไข) ---------------- */

async function refreshClinicTypes() {
  const res = await api('getClinicTypes');
  if (res.ok) state.clinicTypes = res.data;
}

function renderClinicDisplay(clinic) {
  const box = document.getElementById('clinicDisplay');
  if (!clinic) {
    box.innerHTML = '<span style="color:var(--ink-soft);font-size:13px;">ยังไม่กำหนดคลินิกวันนี้</span>';
    return;
  }
  const tagBg = earthify_(clinic.color);
  box.innerHTML = `<span class="badge clinic-tag" style="background:${tagBg};color:${readableTextOn_(tagBg)}">${clinic.name}</span>` +
    (clinic.fromRule ? '<span style="color:var(--ink-soft);font-size:11px;margin-left:6px;">(ตามกฎอัตโนมัติ)</span>' : '') +
    (clinic.note ? `<div style="color:var(--ink-soft);font-size:12px;margin-top:6px;">${clinic.note}</div>` : '');
}

function renderClinicEditor(clinic) {
  const editor = document.getElementById('clinicEditor');
  if (state.role !== 'physio') { editor.classList.add('hidden'); return; }
  editor.classList.remove('hidden');

  const select = document.getElementById('clinicSelect');
  select.innerHTML =
    '<option value="">-- ใช้ค่าอัตโนมัติ (ถ้ามีกฎ) --</option>' +
    '<option value="__NONE__">ไม่มีคลินิก (เฉพาะวันนี้)</option>' +
    state.clinicTypes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  // ถ้าคลินิกที่แสดงมาจากกฎอัตโนมัติ ให้ปล่อยช่องเลือกเป็นค่าว่าง (ยังไม่ได้ override เฉพาะวันนี้)
  select.value = (clinic && !clinic.fromRule) ? clinic.id : '';
  document.getElementById('clinicNoteInput').value = (clinic && !clinic.fromRule) ? clinic.note : '';
}

document.getElementById('saveClinicBtn')?.addEventListener('click', async () => {
  const date = state.currentDate;
  const clinicTypeId = document.getElementById('clinicSelect').value;
  const note = document.getElementById('clinicNoteInput').value.trim();
  const btn = document.getElementById('saveClinicBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  const res = clinicTypeId
    ? await api('setClinicDay', { date, clinicTypeId, note })
    : await api('removeClinicDay', { date });

  btn.disabled = false;
  btn.textContent = originalText;
  if (!res.ok) { toast(res.error); return; }
  toast('บันทึกคลินิกวันนี้แล้ว');
  await Promise.all([openDayPanel(date), renderCalendar()]);
});

/* ---------------- ปิดรับ/เปิดรับพิเศษวันนี้ (นักกายภาพ) ---------------- */

function renderDayToggleActions(dayDetail) {
  const box = document.getElementById('dayToggleActions');
  if (state.role !== 'physio') { box.innerHTML = ''; return; }
  box.innerHTML = '';

  if (dayDetail.isOpen && dayDetail.isSpecialOpen) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = 'ยกเลิกเปิดรับพิเศษวันนี้';
    btn.addEventListener('click', async () => {
      const res = await api('removeSpecialOpen', { date: state.currentDate });
      if (!res.ok) { toast(res.error); return; }
      toast('ยกเลิกเปิดรับพิเศษแล้ว');
      await Promise.all([openDayPanel(state.currentDate), renderCalendar()]);
    });
    box.appendChild(btn);
  } else if (dayDetail.isOpen) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = 'ปิดรับวันนี้';
    btn.addEventListener('click', async () => {
      const reason = prompt('ระบุเหตุผล (ไม่บังคับ):', '') || '';
      const res = await api('addClosedDate', { date: state.currentDate, reason });
      if (!res.ok) { toast(res.error); return; }
      toast('ปิดรับวันนี้แล้ว');
      await Promise.all([openDayPanel(state.currentDate), renderCalendar()]);
    });
    box.appendChild(btn);
  } else {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = 'เปิดรับพิเศษวันนี้';
    btn.addEventListener('click', () => openSpecialModal(state.currentDate));
    box.appendChild(btn);
  }
}

/* ---------------- เวลาพิเศษเสริม (เฉพาะวันเดียว ไม่กระทบตารางปกติ) ---------------- */

function renderExtraSlotList(rows) {
  const list = document.getElementById('extraSlotList');
  if (!list) return;
  list.innerHTML = '';
  if (!rows || !rows.length) return; // ไม่มีรายการ ไม่ต้องโชว์อะไรเลย (ไม่ใช่ข้อมูลหลักของวัน)
  rows.forEach(s => {
    // เช็คว่าช่วงเวลาพิเศษนี้ยังว่างอยู่ไหม (เทียบกับ slots ของวันที่แสดงอยู่) เพื่อให้กดเข้าไปทำนัดได้ทันที
    const matchSlot = (state.currentDayDetail?.slots || []).find(sl => sl.start === s.start && sl.end === s.end);
    const bookable = !!(matchSlot && matchSlot.available);

    const li = document.createElement('li');
    li.innerHTML = `<span class="extra-slot-label"${bookable ? ' style="cursor:pointer;text-decoration:underline;"' : ''}>${s.start}-${s.end}${s.note ? ' — ' + s.note : ''} <span class="badge special-tag">พิเศษ</span>${bookable ? '' : ' <span style="color:var(--ink-soft);">(มีนัด/ไม่ว่างแล้ว)</span>'}</span><button data-id="${s.id}">ลบ</button>`;
    list.appendChild(li);

    if (bookable) {
      li.querySelector('.extra-slot-label').addEventListener('click', () => openApptModal(s.start));
    }
  });
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api('removeExtraSlot', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); return; }
      toast('ลบเวลาพิเศษแล้ว');
      await Promise.all([openDayPanel(state.currentDate), renderCalendar()]);
    });
  });
}

const extraSlotModal = document.getElementById('extraSlotModal');
const extraSlotModalBackdrop = document.getElementById('extraSlotModalBackdrop');

document.getElementById('addExtraSlotBtn')?.addEventListener('click', () => {
  document.getElementById('extraSlotDate').value = state.currentDate;
  document.getElementById('extraSlotError').textContent = '';
  document.getElementById('extraSlotForm').reset();
  extraSlotModal?.classList.remove('hidden');
  extraSlotModalBackdrop?.classList.remove('hidden');
});
function closeExtraSlotModal() {
  extraSlotModal?.classList.add('hidden');
  extraSlotModalBackdrop?.classList.add('hidden');
}
document.getElementById('extraSlotCancelBtn')?.addEventListener('click', closeExtraSlotModal);
extraSlotModalBackdrop?.addEventListener('click', closeExtraSlotModal);

document.getElementById('extraSlotForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('extraSlotDate').value;
  const start = document.getElementById('extraSlotStart').value;
  const end = document.getElementById('extraSlotEnd').value;
  const note = document.getElementById('extraSlotNote').value.trim();
  const errEl = document.getElementById('extraSlotError');
  if (start >= end) { errEl.textContent = 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด'; return; }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const res = await api('addExtraSlot', { date, start, end, note });

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { errEl.textContent = res.error; return; }
  toast('เพิ่มเวลาพิเศษแล้ว');
  closeExtraSlotModal();
  await Promise.all([openDayPanel(date), renderCalendar()]);
});

const specialModal = document.getElementById('specialModal');
const specialModalBackdrop = document.getElementById('specialModalBackdrop');

/** สร้างแถวช่วงเวลา 1 แถว (ใช้ร่วมกันทั้งในหน้าตั้งค่าและโมดัลเปิดรับพิเศษ) */
function makeSlotRow_(start, end) {
  const row = document.createElement('div');
  row.className = 'slot-row';
  row.innerHTML = `
    <input type="time" class="slot-start" value="${start || ''}" />
    <span>–</span>
    <input type="time" class="slot-end" value="${end || ''}" />
    <button type="button" class="remove-slot-btn" title="ลบช่วงนี้">×</button>
  `;
  row.querySelector('.remove-slot-btn').addEventListener('click', () => row.remove());
  return row;
}

function openSpecialModal(date) {
  document.getElementById('specialDate').value = date;
  document.getElementById('specialError').textContent = '';
  document.getElementById('specialNote').value = '';

  const list = document.getElementById('specialSlotList');
  list.innerHTML = '';
  // ใช้ช่วงเวลาปกติของวันในสัปดาห์นี้เป็นค่าตั้งต้น ถ้ามี จะได้ไม่ต้องพิมพ์เอง แก้ไข/ลบ/เพิ่มได้อิสระ
  const weekly = (state.currentDayDetail && state.currentDayDetail.weeklySlots) || [];
  if (weekly.length) {
    weekly.forEach(s => list.appendChild(makeSlotRow_(s.start, s.end)));
  } else {
    list.appendChild(makeSlotRow_('08:30', '16:30'));
  }

  specialModal.classList.remove('hidden');
  specialModalBackdrop.classList.remove('hidden');
}
function closeSpecialModal() {
  specialModal.classList.add('hidden');
  specialModalBackdrop.classList.add('hidden');
}
document.getElementById('specialCancelBtn')?.addEventListener('click', closeSpecialModal);
specialModalBackdrop?.addEventListener('click', closeSpecialModal);
document.getElementById('specialAddSlotBtn')?.addEventListener('click', () => {
  document.getElementById('specialSlotList').appendChild(makeSlotRow_('', ''));
});

document.getElementById('specialForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('specialDate').value;

  const slots = [];
  document.querySelectorAll('#specialSlotList .slot-row').forEach(row => {
    const start = row.querySelector('.slot-start').value;
    const end = row.querySelector('.slot-end').value;
    if (start && end) slots.push({ start, end });
  });
  if (!slots.length) { document.getElementById('specialError').textContent = 'กรุณาระบุช่วงเวลาอย่างน้อย 1 ช่วง'; return; }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const res = await api('addSpecialOpen', {
    date,
    slots,
    note: document.getElementById('specialNote').value.trim()
  });

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { document.getElementById('specialError').textContent = res.error; return; }
  toast('เปิดรับพิเศษวันนี้แล้ว');
  closeSpecialModal();
  await Promise.all([openDayPanel(date), renderCalendar()]);
});

/* ---------------- โมดัลเพิ่มนัดหมาย ---------------- */

const apptModal = document.getElementById('apptModal');
const apptModalBackdrop = document.getElementById('apptModalBackdrop');

function openApptModal(startTime) {
  document.getElementById('apptDate').value = state.currentDate;
  document.getElementById('apptError').textContent = '';
  document.getElementById('apptForm').reset();
  resetPatientPicker_();
  if (!state.patientsLoaded) refreshPatients(); // เผื่อโหลดทะเบียนตอนเปิดเว็บไม่สำเร็จ

  const startSel = document.getElementById('apptStart');
  startSel.innerHTML = '';
  state.currentDayDetail.slots.filter(s => s.available).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.start;
    opt.textContent = `${s.start} - ${s.end}`;
    startSel.appendChild(opt);
  });
  if (startTime) startSel.value = startTime;

  renderIcdSlots_('apptIcd10Slots', state.icd10Codes, 2, []);
  renderIcdSlots_('apptIcd9Slots', state.icd9Codes, 6, []);

  apptModal.classList.remove('hidden');
  apptModalBackdrop.classList.remove('hidden');
}
function closeApptModal() {
  apptModal.classList.add('hidden');
  apptModalBackdrop.classList.add('hidden');
}
document.getElementById('apptCancelBtn')?.addEventListener('click', closeApptModal);

/* ---------------- ทะเบียนคนไข้ (PTN): ค้นหา + เติมข้อมูลคนไข้เดิมในฟอร์มนัด ---------------- */
// ทะเบียนทั้งหมดถูกโหลดมาเก็บไว้ในเครื่องครั้งเดียวหลังเข้าสู่ระบบ แล้วค้นหาในเครื่องขณะพิมพ์
// (ถ้ายิงไปถาม Apps Script ทุกตัวอักษรจะต้องรอครั้งละ 1-2 วินาที พิมพ์ชื่อแล้วรายชื่อจะขึ้นไม่ทัน)

async function refreshPatients() {
  const res = await api('getPatients');
  if (res.ok) { state.patients = res.data; state.patientsLoaded = true; }
}

/** อัปเดตทะเบียนในเครื่องให้ตรงกับที่เซิร์ฟเวอร์เพิ่งบันทึก (ไม่ต้องโหลดทะเบียนใหม่ทั้งชุด) */
function upsertPatient_(p) {
  if (!p || !p.ptn) return;
  const i = state.patients.findIndex(x => x.ptn === p.ptn);
  if (i === -1) state.patients.push(p); else state.patients[i] = p;
}

function normName_(s) {
  return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** หาคนไข้ในทะเบียนที่ชื่อ/นามสกุลมีข้อความที่พิมพ์อยู่ (สูงสุด 6 คน ชื่อที่ขึ้นต้นตรงกันมาก่อน) */
function findPatientMatches_(first, last) {
  const f = normName_(first), l = normName_(last);
  if ((f + l).length < 2) return [];
  const hits = [];
  state.patients.forEach(p => {
    const pf = normName_(p.firstName), pl = normName_(p.lastName);
    let score;
    const q = f.replace(/\s/g, '');
    if (!l && q.length >= 3 && /\d/.test(q) && String(p.ptn).toLowerCase().indexOf(q) !== -1) {
      score = 0; // พิมพ์ PTN (หรือบางส่วน เช่น 69-0001) ในช่องชื่อ
    } else if (f && !l && f.indexOf(' ') !== -1) {
      // พิมพ์ชื่อและนามสกุลรวมกันในช่องชื่อ เช่น "สมชาย ใจ"
      const at = (pf + ' ' + pl).indexOf(f);
      if (at === -1) return;
      score = at === 0 ? 0 : 2;
    } else {
      const fAt = f ? pf.indexOf(f) : 0;
      const lAt = l ? pl.indexOf(l) : 0;
      if (fAt === -1 || lAt === -1) return;
      score = (fAt === 0 ? 0 : 2) + (lAt === 0 ? 0 : 1);
    }
    hits.push({ p, score });
  });
  hits.sort((a, b) => a.score - b.score ||
    String(a.p.firstName).localeCompare(String(b.p.firstName), 'th') ||
    String(a.p.lastName).localeCompare(String(b.p.lastName), 'th'));
  return hits.slice(0, 6).map(h => h.p);
}

function renderPatientSuggest_(matches) {
  const box = document.getElementById('apptPatientSuggest');
  if (!box) return;
  box.innerHTML = '';
  if (!matches.length) { box.classList.add('hidden'); return; }

  const head = document.createElement('div');
  head.className = 'patient-suggest-head';
  head.textContent = 'คนไข้เดิมในทะเบียน — กดเลือกเพื่อเติมข้อมูล';
  box.appendChild(head);

  matches.forEach(p => {
    // สร้างด้วย textContent ทั้งหมด ไม่ต่อสตริงเป็น HTML เพราะเป็นข้อมูลที่คนพิมพ์เข้ามา
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'patient-suggest-item';

    const top = document.createElement('span');
    top.className = 'patient-suggest-name';
    const name = document.createElement('span');
    name.textContent = `${p.firstName} ${p.lastName}`;
    const ptn = document.createElement('span');
    ptn.className = 'patient-suggest-ptn';
    ptn.textContent = p.ptn;
    top.append(name, ptn);

    const nid = String(p.nationalId || '').replace(/\D/g, '');
    const parts = [];
    if (p.moo) parts.push('หมู่ ' + p.moo);
    if (p.phone) parts.push('โทร ' + p.phone);
    parts.push(nid.length === 13 ? 'เลขบัตรลงท้าย ' + nid.slice(-4) : 'ยังไม่มีเลขบัตร');
    const sub = document.createElement('span');
    sub.className = 'patient-suggest-sub';
    sub.textContent = parts.join(' · ');

    btn.append(top, sub);
    btn.addEventListener('click', () => pickPatient_(p));
    box.appendChild(btn);
  });
  box.classList.remove('hidden');
}

function renderPatientStatus_() {
  const box = document.getElementById('apptPatientStatus');
  if (!box) return;
  box.innerHTML = '';
  const p = state.pickedPatient;
  if (!p) { box.classList.add('hidden'); return; }
  const label = document.createElement('span');
  label.textContent = `คนไข้เดิม · ${p.ptn}`;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.textContent = 'ไม่ใช่คนนี้';
  undo.addEventListener('click', () => { unpickPatient_(); updatePatientSuggest_(); });
  box.append(label, undo);
  box.classList.remove('hidden');
}

/** กดเลือกคนไข้เดิม: เติมชื่อ นามสกุล หมู่ เบอร์ เลขบัตร จากทะเบียนลงฟอร์ม */
function pickPatient_(p) {
  state.pickedPatient = p;
  document.getElementById('apptPtn').value = p.ptn;
  document.getElementById('apptFirstName').value = p.firstName || '';
  document.getElementById('apptLastName').value = p.lastName || '';
  document.getElementById('apptMoo').value = p.moo || '';
  document.getElementById('apptPhone').value = p.phone || '';
  document.getElementById('apptNationalId').value = String(p.nationalId || '').replace(/\D/g, '');
  renderPatientSuggest_([]);
  renderPatientStatus_();
  loadPatientSummary_(p);
}

/**
 * เลิกเลือกคนไข้เดิม และล้างช่องที่ระบบเติมให้ (เฉพาะช่องที่ยังเป็นค่าของคนนั้นอยู่ ช่องที่พิมพ์แก้เองแล้วไม่ล้าง)
 * ต้องล้าง ไม่งั้นเลขบัตรของคนเดิมจะค้างอยู่ในฟอร์ม แล้วนัดของคนใหม่จะถูกผูกกับคนเดิมด้วยเลขบัตรนั้น
 */
function unpickPatient_() {
  const p = state.pickedPatient;
  if (!p) return;
  const clearIfSame = (id, val) => {
    const el = document.getElementById(id);
    if (el.value.trim() === String(val || '').trim()) el.value = '';
  };
  clearIfSame('apptMoo', p.moo);
  clearIfSame('apptPhone', p.phone);
  clearIfSame('apptNationalId', String(p.nationalId || '').replace(/\D/g, ''));
  state.pickedPatient = null;
  document.getElementById('apptPtn').value = '';
  renderPatientStatus_();
  clearPatientSummary_();
}

function resetPatientPicker_() {
  state.pickedPatient = null;
  const ptnEl = document.getElementById('apptPtn');
  if (ptnEl) ptnEl.value = '';
  renderPatientSuggest_([]);
  renderPatientStatus_();
  clearPatientSummary_();
}

/* ---------------- สรุปประวัติคนไข้เดิม: จำนวนครั้ง นัดที่รออยู่ รหัส ICD ครั้งก่อน ---------------- */

/** ป้องกันข้อความที่คนพิมพ์เข้ามา (ชื่อ ฯลฯ) ถูกตีความเป็น HTML เวลาต่อสตริงใส่ innerHTML */
function esc_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 'yyyy-MM-dd' -> '6 ต.ค. 2569' */
function fmtThaiDate_(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  return `${Number(m[3])} ${THAI_MONTH_SHORT[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
}

let _summaryReq_ = 0; // กันผลลัพธ์ของคนที่เลือกก่อนหน้ามาทับของคนที่เลือกล่าสุด

async function loadPatientSummary_(p) {
  const req = ++_summaryReq_;
  state.patientSummary = null;
  renderPatientSummary_('loading');
  const res = await api('getPatientSummary', {
    ptn: p.ptn,
    date: document.getElementById('apptDate').value,
    startTime: document.getElementById('apptStart').value
  });
  if (req !== _summaryReq_ || !state.pickedPatient || state.pickedPatient.ptn !== p.ptn) return; // เปลี่ยนคน/ปิดฟอร์มไปแล้ว
  if (!res.ok) { renderPatientSummary_(null); return; } // โหลดไม่ได้ก็ทำนัดต่อได้ตามปกติ แค่ไม่มีสรุป
  state.patientSummary = res.data;
  renderPatientSummary_(res.data);
}

/** ซ่อนสรุป และถ้าเคยกด "ใช้รหัสครั้งก่อน" ไว้ ให้ล้างรหัสที่เติมออกด้วย (ไม่งั้นรหัสของคนเดิมจะติดไปกับคนใหม่) */
function clearPatientSummary_() {
  _summaryReq_++;
  state.patientSummary = null;
  if (state.prevIcdApplied) setApptIcdSlots_([], []);
  state.prevIcdApplied = false;
  renderPatientSummary_(null);
}

function setApptIcdSlots_(icd10, icd9) {
  renderIcdSlots_('apptIcd10Slots', state.icd10Codes, 2, icd10);
  renderIcdSlots_('apptIcd9Slots', state.icd9Codes, 6, icd9);
}

/** รหัสครั้งก่อนที่ไม่ใช่รหัสอัตโนมัติ (รหัสอัตโนมัติระบบใส่ให้ทุกนัดอยู่แล้ว) ตัดให้พอดีจำนวนช่อง */
function prevExtraCodes_(prev) {
  const auto10 = autoCodeOf_(state.icd10Codes), auto9 = autoCodeOf_(state.icd9Codes);
  return {
    icd10: (prev.icd10 || []).map(String).filter(c => c && c !== auto10).slice(0, 1),
    icd9: (prev.icd9 || []).map(String).filter(c => c && c !== auto9).slice(0, 5)
  };
}

/** s = 'loading' | null | ข้อมูลจาก getPatientSummary */
function renderPatientSummary_(s) {
  const box = document.getElementById('apptPatientSummary');
  const prevBox = document.getElementById('apptPrevIcd');
  if (!box || !prevBox) return;
  box.innerHTML = '';
  prevBox.innerHTML = '';
  prevBox.classList.add('hidden');
  if (!s) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const line = (parent, cls, text) => { const el = document.createElement('div'); if (cls) el.className = cls; el.textContent = text; parent.appendChild(el); return el; };
  if (s === 'loading') { line(box, '', 'กำลังโหลดประวัติ...'); return; }

  line(box, 'patient-summary-main', s.attendedCount > 0 ? `มารับบริการแล้ว ${s.attendedCount} ครั้ง` : 'ยังไม่มีบันทึกว่ามารับบริการ');
  const parts = [];
  if (s.attendedCount > 0 && s.lastVisit) parts.push('ครั้งล่าสุด ' + fmtThaiDate_(s.lastVisit));
  parts.push(`นัดทั้งหมด ${s.appointmentCount} ครั้ง`);
  if (s.cancelledCount > 0) parts.push(`ยกเลิก ${s.cancelledCount} ครั้ง`);
  line(box, '', parts.join(' · '));
  if (s.upcoming && s.upcoming.length) {
    const u = s.upcoming[0];
    line(box, 'patient-summary-warn', `มีนัดรออยู่แล้ว: ${fmtThaiDate_(u.date)} เวลา ${u.startTime}` +
      (s.upcoming.length > 1 ? ` และอีก ${s.upcoming.length - 1} นัด` : ''));
  }

  // รหัสครั้งก่อน: แสดงเหนือช่องรหัส ICD พร้อมปุ่มให้เลือกใช้ (ไม่กด = เลือกรหัสใหม่เองตามปกติ)
  const prev = s.previous;
  if (!prev) return;
  prevBox.classList.remove('hidden');
  line(prevBox, 'prev-icd-title', `รหัสครั้งก่อน · ${fmtThaiDate_(prev.date)}` + (prev.attended ? '' : ' (ยังไม่ได้บันทึกว่ามา)'));
  line(prevBox, '', 'ICD-10: ' + (formatIcdList_((prev.icd10 || []).join(','), state.icd10Codes) || '-'));
  line(prevBox, '', 'ICD-9: ' + (formatIcdList_((prev.icd9 || []).join(','), state.icd9Codes) || '-'));
  const extra = prevExtraCodes_(prev);
  if (!extra.icd10.length && !extra.icd9.length) {
    line(prevBox, 'prev-icd-note', 'ครั้งก่อนมีเฉพาะรหัสอัตโนมัติ ซึ่งระบบใส่ให้ทุกนัดอยู่แล้ว');
    return;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'secondary';
  btn.id = 'apptPrevIcdBtn';
  btn.textContent = state.prevIcdApplied ? 'ล้างรหัสที่เติม (เลือกใหม่เอง)' : 'ใช้รหัสครั้งก่อน';
  btn.addEventListener('click', () => {
    state.prevIcdApplied = !state.prevIcdApplied;
    if (state.prevIcdApplied) setApptIcdSlots_(extra.icd10, extra.icd9); else setApptIcdSlots_([], []);
    renderPatientSummary_(s);
  });
  prevBox.appendChild(btn);
  if (state.prevIcdApplied) line(prevBox, 'prev-icd-note', 'เติมรหัสครั้งก่อนลงช่องด้านล่างแล้ว แก้ไขเพิ่มเติมได้');
}

/** เรียกทุกครั้งที่พิมพ์ในช่องชื่อ/นามสกุล/เลขบัตร */
function updatePatientSuggest_() {
  const first = document.getElementById('apptFirstName').value;
  const last = document.getElementById('apptLastName').value;
  const picked = state.pickedPatient;

  // แก้ชื่อหลังเลือกคนไข้เดิมไปแล้ว = ไม่ใช่คนเดิมอีกต่อไป ให้เลิกเลือก (เลือกใหม่จากรายชื่อได้เสมอ)
  if (picked && (normName_(first) !== normName_(picked.firstName) || normName_(last) !== normName_(picked.lastName))) {
    unpickPatient_();
  }
  if (state.pickedPatient) { renderPatientSuggest_([]); return; }

  // พิมพ์เลขบัตรครบ 13 หลักแล้วตรงกับคนในทะเบียน: เสนอคนนั้นก่อน
  const nid = document.getElementById('apptNationalId').value.replace(/\D/g, '');
  const byNid = nid.length === 13 ? state.patients.filter(p => String(p.nationalId || '').replace(/\D/g, '') === nid) : [];
  renderPatientSuggest_(byNid.length ? byNid : findPatientMatches_(first, last));
}

['apptFirstName', 'apptLastName', 'apptNationalId'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', updatePatientSuggest_);
});

/* ---------------- รหัส ICD-10 / ICD-9 (ใช้ร่วมกันทั้งตอนทำนัดและตอนแก้ไข) ---------------- */

async function refreshIcdCodes() {
  const [r10, r9] = await Promise.all([api('getIcd10Codes'), api('getIcd9Codes')]);
  if (r10.ok) state.icd10Codes = r10.data;
  if (r9.ok) state.icd9Codes = r9.data;
}

function autoCodeOf_(codeList) {
  const a = (codeList || []).find(c => c.isAuto === true);
  return a ? String(a.code) : null; // เทียบรหัสเป็นข้อความเสมอ (ในชีตรหัสตัวเลขล้วนอาจถูกเก็บเป็นตัวเลข)
}

/**
 * วาดช่อง ICD ทั้งหมด: ช่องแรกล็อกเป็นรหัสอัตโนมัติเสมอ (แก้ไม่ได้) ช่องที่เหลือเป็น dropdown ให้เลือกเอง
 * selected = รายการรหัส "ที่ไม่ใช่รหัสอัตโนมัติ" ที่เคยเลือกไว้แล้ว เรียงตามช่อง (ใช้ตอนเปิดแก้ไขนัดเดิม)
 */
function renderIcdSlots_(containerId, codeList, totalSlots, selected) {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.innerHTML = '';
  selected = selected || [];

  const autoEntry = (codeList || []).find(c => c.isAuto === true);
  const options = (codeList || []).filter(c => c.isAuto !== true);

  const row0 = document.createElement('div');
  row0.className = 'icd-slot-row';
  row0.innerHTML = `<span class="icd-slot-label">1</span><div class="icd-slot-auto">${autoEntry ? autoEntry.code + ' - ' + autoEntry.label : '(ยังไม่ได้ตั้งรหัสอัตโนมัติ)'}</div>`;
  box.appendChild(row0);

  for (let i = 1; i < totalSlots; i++) {
    const row = document.createElement('div');
    row.className = 'icd-slot-row';
    const selVal = String(selected[i - 1] || '');
    // รหัสที่เคยเลือกไว้แต่ถูกลบออกจากรายการรหัสไปแล้ว: ยังต้องแสดงเป็นตัวเลือก ไม่งั้นกดบันทึกแล้วรหัสนั้นจะหายเงียบๆ
    const missing = selVal && !options.some(o => String(o.code) === selVal);
    row.innerHTML = `
      <span class="icd-slot-label">${i + 1}</span>
      <select class="icd-slot-select">
        <option value="">-- ไม่เลือก --</option>
        ${missing ? `<option value="${esc_(selVal)}" selected>${esc_(selVal)} (ไม่อยู่ในรายการรหัส)</option>` : ''}
        ${options.map(o => `<option value="${esc_(o.code)}" ${String(o.code) === selVal ? 'selected' : ''}>${esc_(o.code)} - ${esc_(o.label)}</option>`).join('')}
      </select>`;
    box.appendChild(row);
  }
}

/** อ่านค่ารหัสที่เลือกไว้ทั้งหมดจากช่อง (ไม่รวมรหัสอัตโนมัติ ฝั่งหลังบ้านจะใส่ให้เองเสมอ) */
function gatherIcdSlots_(containerId) {
  const box = document.getElementById(containerId);
  const codes = [];
  box?.querySelectorAll('.icd-slot-select').forEach(sel => { if (sel.value) codes.push(sel.value); });
  return codes;
}

/** แปลงสตริงรหัสที่คั่นด้วยจุลภาค (เก็บในชีต) ให้เป็นข้อความอ่านง่าย "รหัส - คำอธิบาย" */
function formatIcdList_(str, codeList) {
  const codes = String(str || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!codes.length) return '';
  return codes.map(c => {
    const found = (codeList || []).find(x => String(x.code) === c);
    return found ? `${c} - ${found.label}` : c;
  }).join(', ');
}
apptModalBackdrop?.addEventListener('click', closeApptModal);

document.getElementById('apptForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('apptDate').value;
  const startTime = document.getElementById('apptStart').value;
  const slot = state.currentDayDetail.slots.find(s => s.start === startTime);
  const endTime = slot ? slot.end : startTime;

  // เลือกคนไข้เดิมไว้ แต่เลขบัตรที่กรอกไม่ตรงกับทะเบียน: ถามก่อน เพราะบันทึกแล้วเลขบัตรในทะเบียนจะถูกแก้ตาม
  const picked = state.pickedPatient;
  const typedNid = document.getElementById('apptNationalId').value.replace(/\D/g, '');
  const pickedNid = picked ? String(picked.nationalId || '').replace(/\D/g, '') : '';
  if (picked && pickedNid.length === 13 && typedNid.length === 13 && typedNid !== pickedNid) {
    const okToChange = confirm(`เลขบัตรที่กรอกไม่ตรงกับทะเบียนของ ${picked.ptn}\n\nในทะเบียน: ${pickedNid}\nที่กรอก: ${typedNid}\n\nกด "ตกลง" เพื่อแก้เลขบัตรในทะเบียนเป็นเลขที่กรอก\nกด "ยกเลิก" เพื่อกลับไปตรวจ`);
    if (!okToChange) return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const res = await api('addAppointment', {
    date, startTime, endTime,
    ptn: picked ? picked.ptn : '',
    type: document.getElementById('apptType').value,
    firstName: document.getElementById('apptFirstName').value.trim(),
    lastName: document.getElementById('apptLastName').value.trim(),
    moo: document.getElementById('apptMoo').value.trim(),
    phone: document.getElementById('apptPhone').value.trim(),
    nationalId: document.getElementById('apptNationalId').value.trim(),
    note: document.getElementById('apptNote').value.trim(),
    icd10: gatherIcdSlots_('apptIcd10Slots'),
    icd9: gatherIcdSlots_('apptIcd9Slots')
  });

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { document.getElementById('apptError').textContent = res.error; return; }
  upsertPatient_(res.patient);
  toast(res.ptn ? `บันทึกนัดหมายแล้ว · ${res.ptn}${res.isNewPatient ? ' (คนไข้ใหม่)' : ''}` : 'บันทึกนัดหมายแล้ว');
  closeApptModal();
  await Promise.all([openDayPanel(date), renderCalendar()]); // เรียกพร้อมกันแทนเรียงลำดับ ลดเวลารอ
});

/* ---------------- โมดัลเลือกการดำเนินการช่วงเวลาที่ว่าง (จองนัด / ปิดช่วงนี้) ---------------- */
// เดิมกดช่องเวลาที่ว่างแล้วเปิดโมดัลจองนัดตรงทันที ไม่มีทางปิดช่วงเวลานั้นได้จากตรงนี้เลย
// ต้องไปกดปุ่ม "ตั้งช่วงไม่ว่าง" แยกต่างหากแล้วพิมพ์เวลาเองใหม่ จึงเพิ่มขั้นตอนเลือกตรงนี้ก่อน

const slotActionModal = document.getElementById('slotActionModal');
const slotActionModalBackdrop = document.getElementById('slotActionModalBackdrop');
let slotActionPending_ = null; // {start, end} ของช่องที่กำลังเลือกอยู่

function openSlotActionModal_(start, end) {
  slotActionPending_ = { start, end };
  document.getElementById('slotActionTimeLabel').textContent = `${start}-${end}`;
  slotActionModal.classList.remove('hidden');
  slotActionModalBackdrop.classList.remove('hidden');
}
function closeSlotActionModal_() {
  slotActionModal.classList.add('hidden');
  slotActionModalBackdrop.classList.add('hidden');
  slotActionPending_ = null;
}
document.getElementById('slotActionCancelBtn')?.addEventListener('click', closeSlotActionModal_);
slotActionModalBackdrop?.addEventListener('click', closeSlotActionModal_);
document.getElementById('slotActionBookBtn')?.addEventListener('click', () => {
  const p = slotActionPending_;
  closeSlotActionModal_();
  if (p) openApptModal(p.start);
});
document.getElementById('slotActionCloseBtn')?.addEventListener('click', () => {
  const p = slotActionPending_;
  closeSlotActionModal_();
  if (p) openBusyModal_({ startTime: p.start, endTime: p.end });
});

/* ---------------- โมดัลตั้งช่วงไม่ว่าง (นักกายภาพ) ---------------- */

const busyModal = document.getElementById('busyModal');
const busyModalBackdrop = document.getElementById('busyModalBackdrop');

/** เปิดโมดัลตั้งช่วงไม่ว่าง ใช้ได้ทั้งเพิ่มใหม่ (prefill = ไม่มี id) และแก้ไขของเดิม (prefill มี id) */
function openBusyModal_(prefill) {
  prefill = prefill || {};
  document.getElementById('busyDate').value = state.currentDate;
  document.getElementById('busyForm').reset();
  document.getElementById('busyError').textContent = '';
  document.getElementById('busyId').value = prefill.id || '';
  document.getElementById('busyModalTitle').textContent = prefill.id ? 'แก้ไขช่วงไม่ว่าง' : 'ตั้งช่วงไม่ว่าง';
  document.querySelector('#busyForm button[type="submit"]').textContent = prefill.id ? 'บันทึกการแก้ไข' : 'บันทึก';
  if (prefill.type) document.getElementById('busyType').value = prefill.type;
  if (prefill.startTime) document.getElementById('busyStart').value = prefill.startTime;
  if (prefill.endTime) document.getElementById('busyEnd').value = prefill.endTime;
  if (prefill.note) document.getElementById('busyNote').value = prefill.note;
  busyModal.classList.remove('hidden');
  busyModalBackdrop.classList.remove('hidden');
}
document.getElementById('physioBusyBtn')?.addEventListener('click', () => openBusyModal_());
function closeBusyModal() {
  busyModal.classList.add('hidden');
  busyModalBackdrop.classList.add('hidden');
}
document.getElementById('busyCancelBtn')?.addEventListener('click', closeBusyModal);
busyModalBackdrop?.addEventListener('click', closeBusyModal);

document.getElementById('busyForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('busyDate').value;
  const busyId = document.getElementById('busyId').value;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const payload = {
    date,
    startTime: document.getElementById('busyStart').value,
    endTime: document.getElementById('busyEnd').value,
    type: document.getElementById('busyType').value,
    note: document.getElementById('busyNote').value.trim()
  };
  const res = busyId ? await api('updateBusy', { ...payload, id: busyId }) : await api('addBusy', payload);

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { document.getElementById('busyError').textContent = res.error; return; }
  toast('บันทึกช่วงไม่ว่างแล้ว');
  closeBusyModal();
  await Promise.all([openDayPanel(date), renderCalendar()]); // เรียกพร้อมกันแทนเรียงลำดับ ลดเวลารอ
});

/* ---------------- ตั้งค่า (เฉพาะนักกายภาพ) ---------------- */

const DAY_LABELS = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 0: 'อาทิตย์' };

async function loadSettings() {
  // เดิมหน้านี้เคยยิง 7 คำขอแยกกัน (เรียงลำดับทีละตัวเพื่อกัน Apps Script รับพร้อมกันไม่ไหว) ทำให้เปิดหน้าตั้งค่าครั้งแรกช้ามาก
  // เพราะค่าใช้จ่ายหลักไม่ได้อยู่ที่การอ่านชีต (ซึ่งมีแคชอยู่แล้ว) แต่อยู่ที่ "ค่าใช้จ่ายคงที่ต่อการยิงคำขอ 1 ครั้ง" ของ Apps Script Web App
  // ตอนนี้รวมทั้ง 7 ชุดไว้ในคำขอเดียว (getSettingsBundle) ฝั่งเซิร์ฟเวอร์รวมให้เสร็จในการประมวลผลครั้งเดียว ลดจาก 7 คำขอ เหลือ 1 คำขอ
  const res = await api('getSettingsBundle');
  if (!res.ok) { toast('โหลดข้อมูลหน้าตั้งค่าไม่สำเร็จ: ' + res.error); return; }
  const d = res.data;

  renderScheduleForm(d.schedule);
  renderClosedList(d.closedDates);
  state.clinicTypes = d.clinicTypes; renderClinicTypesList(d.clinicTypes); renderRuleClinicSelect(d.clinicTypes);
  renderClinicRulesList(d.clinicRules);
  state.icd10Codes = d.icd10; renderIcdCodeList_('icd10List', d.icd10, 'removeIcd10Code', reloadIcd10_);
  state.icd9Codes = d.icd9; renderIcdCodeList_('icd9List', d.icd9, 'removeIcd9Code', reloadIcd9_);
  renderBusyRulesList(d.busyRules);

  state.settingsLoaded = true;
}

// รีโหลดเฉพาะหัวข้อเดียว ใช้แทน loadSettings() เต็มรูปแบบหลังบันทึก/ลบในแต่ละหัวข้อ
// (เดิมทุกปุ่มบันทึก/ลบในหน้าตั้งค่าเรียก loadSettings() ที่ยิง 7 คำขอรวด ทำให้แต่ละคลิกช้ามาก)
async function reloadClosedDates_() {
  const res = await api('getClosedDates');
  if (res.ok) renderClosedList(res.data); else toast('โหลดวันปิดไม่สำเร็จ: ' + res.error);
}
async function reloadClinicTypes_() {
  const res = await api('getClinicTypes');
  if (res.ok) { state.clinicTypes = res.data; renderClinicTypesList(res.data); renderRuleClinicSelect(res.data); } else toast('โหลดประเภทคลินิกไม่สำเร็จ: ' + res.error);
}
async function reloadClinicRules_() {
  const res = await api('getClinicRules');
  if (res.ok) renderClinicRulesList(res.data); else toast('โหลดกฎคลินิกไม่สำเร็จ: ' + res.error);
}
async function reloadBusyRules_() {
  const res = await api('getBusyRules');
  if (res.ok) renderBusyRulesList(res.data); else toast('โหลดกฎปิดอัตโนมัติไม่สำเร็จ: ' + res.error);
}
async function reloadIcd10_() {
  const res = await api('getIcd10Codes');
  if (res.ok) { state.icd10Codes = res.data; renderIcdCodeList_('icd10List', res.data, 'removeIcd10Code'); } else toast('โหลดรหัส ICD-10 ไม่สำเร็จ: ' + res.error);
}
async function reloadIcd9_() {
  const res = await api('getIcd9Codes');
  if (res.ok) { state.icd9Codes = res.data; renderIcdCodeList_('icd9List', res.data, 'removeIcd9Code'); } else toast('โหลดรหัส ICD-9 ไม่สำเร็จ: ' + res.error);
}

function renderIcdCodeList_(listId, rows, removeAction, reloadFn) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<li style="background:none;color:var(--ink-soft);">ยังไม่มีรหัส</li>'; return; }
  rows.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${r.code} - ${r.label}${r.isAuto ? ' <span class="badge avail-tag">อัตโนมัติ</span>' : ''}</span>` +
      (r.isAuto ? '' : `<button data-id="${r.id}">ลบ</button>`);
    list.appendChild(li);
  });
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api(removeAction, { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); return; }
      reloadFn();
    });
  });
}

document.getElementById('icd10Form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('icd10Code').value.trim();
  const label = document.getElementById('icd10Label').value.trim();
  const res = await api('addIcd10Code', { code, label });
  if (!res.ok) { toast(res.error); return; }
  document.getElementById('icd10Form').reset();
  reloadIcd10_();
});

document.getElementById('icd9Form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('icd9Code').value.trim();
  const label = document.getElementById('icd9Label').value.trim();
  const res = await api('addIcd9Code', { code, label });
  if (!res.ok) { toast(res.error); return; }
  document.getElementById('icd9Form').reset();
  reloadIcd9_();
});

document.getElementById('refreshSettingsBtn')?.addEventListener('click', loadSettings);

function renderScheduleForm(data) {
  const box = document.getElementById('scheduleForm');
  box.innerHTML = '';
  const days = data.days || [];
  const allSlots = data.slots || [];
  // เรียงจันทร์(1)-ศุกร์(5) ก่อน แล้วค่อยเสาร์(6)-อาทิตย์(0)
  const order = [1, 2, 3, 4, 5, 6, 0];
  order.forEach(dayNum => {
    const dayRow = days.find(r => Number(r.day) === dayNum) || { day: dayNum, isOpen: dayNum >= 1 && dayNum <= 5 };
    const isWeekendFixed = dayNum === 0 || dayNum === 6;
    const daySlots = allSlots
      .filter(s => Number(s.weekday) === dayNum)
      .sort((a, b) => a.startTime < b.startTime ? -1 : 1);

    const block = document.createElement('div');
    block.className = 'weekday-block';
    block.dataset.day = dayNum;

    const header = document.createElement('div');
    header.className = 'weekday-header';
    header.innerHTML = `
      <span>${DAY_LABELS[dayNum]}</span>
      <label><input type="checkbox" class="sched-open" ${dayRow.isOpen ? 'checked' : ''} ${isWeekendFixed ? 'disabled title="เสาร์-อาทิตย์ปิดโดยอัตโนมัติ"' : ''}/> เปิด</label>
    `;
    block.appendChild(header);

    if (!isWeekendFixed) {
      const list = document.createElement('div');
      list.className = 'slot-editor-list';
      if (daySlots.length) {
        daySlots.forEach(s => list.appendChild(makeSlotRow_(s.startTime, s.endTime)));
      }
      block.appendChild(list);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'secondary add-slot-btn';
      addBtn.textContent = '+ เพิ่มช่วงเวลา';
      addBtn.addEventListener('click', () => list.appendChild(makeSlotRow_('', '')));
      block.appendChild(addBtn);
    }

    box.appendChild(block);
  });
}

document.getElementById('saveScheduleBtn')?.addEventListener('click', async (e) => {
  const btn = e.target;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  const days = [];
  const slots = [];
  document.querySelectorAll('.weekday-block').forEach(block => {
    const dayNum = Number(block.dataset.day);
    const isWeekendFixed = dayNum === 0 || dayNum === 6;
    const checkbox = block.querySelector('.sched-open');
    days.push({ day: dayNum, isOpen: isWeekendFixed ? false : checkbox.checked });

    block.querySelectorAll('.slot-row').forEach(row => {
      const start = row.querySelector('.slot-start').value;
      const end = row.querySelector('.slot-end').value;
      if (start && end) slots.push({ weekday: dayNum, start, end });
    });
  });

  const res = await api('setSchedule', { days, slots });
  btn.disabled = false;
  btn.textContent = originalText;
  if (!res.ok) { toast(res.error); return; }
  toast('บันทึกช่วงเวลานัดแล้ว');
  renderCalendar();
});

function renderClosedList(rows) {
  const list = document.getElementById('closedDateList');
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<li style="background:none;color:var(--ink-soft);">ยังไม่มีวันปิดเพิ่มเติม</li>'; return; }
  rows.sort((a,b) => a.date < b.date ? -1 : 1).forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${r.date}${r.reason ? ' — ' + r.reason : ''}</span><button data-date="${r.date}">ลบ</button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api('removeClosedDate', { date: btn.dataset.date });
      if (!res.ok) { toast(res.error); return; }
      await Promise.all([reloadClosedDates_(), renderCalendar()]); // เรียกพร้อมกัน ลดเวลารอ
    });
  });
}

document.getElementById('closedDateForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('closedDateInput').value;
  const reason = document.getElementById('closedReasonInput').value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';
  const res = await api('addClosedDate', { date, reason });
  submitBtn.disabled = false;
  submitBtn.textContent = originalText;
  if (!res.ok) { toast(res.error); return; }
  document.getElementById('closedDateForm').reset();
  await Promise.all([reloadClosedDates_(), renderCalendar()]); // เรียกพร้อมกัน ลดเวลารอ
});

/* ---------------- ประเภทคลินิก (ตั้งค่า) ---------------- */

function renderClinicTypesList(rows) {
  const list = document.getElementById('clinicTypeList');
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<li style="background:none;color:var(--ink-soft);">ยังไม่มีประเภทคลินิก</li>'; return; }
  rows.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="color-swatch" style="background:${r.color}"></span>${r.name}</span><span class="busy-item-actions"><button class="busy-edit-btn" data-edit-id="${r.id}">แก้ไข</button><button data-id="${r.id}">ลบ</button></span>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => startEditClinicType_(btn.dataset.editId));
  });
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('ลบประเภทคลินิกนี้? (วันที่เคยกำหนดคลินิกนี้ไว้จะถูกล้างไปด้วย)')) return;
      const res = await api('removeClinicType', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); return; }
      // การลบคลินิกจะลบกฎอัตโนมัติที่ผูกกับคลินิกนี้ทิ้งไปด้วย (ฝั่งเซิร์ฟเวอร์) จึงต้องโหลดกฎใหม่ด้วย
      await Promise.all([reloadClinicTypes_(), reloadClinicRules_(), renderCalendar()]);
    });
  });
}

function resetClinicTypeForm_() {
  document.getElementById('clinicTypeForm').reset();
  document.getElementById('clinicTypeColor').value = '#2B6E63';
  document.getElementById('clinicTypeEditId').value = '';
  document.querySelector('#clinicTypeForm button[type="submit"]').textContent = 'เพิ่มคลินิก';
  document.getElementById('clinicTypeCancelEdit').classList.add('hidden');
}
function startEditClinicType_(id) {
  const c = state.clinicTypes.find(x => x.id === id);
  if (!c) return;
  document.getElementById('clinicTypeName').value = c.name;
  document.getElementById('clinicTypeColor').value = c.color || '#2B6E63';
  document.getElementById('clinicTypeEditId').value = c.id;
  document.querySelector('#clinicTypeForm button[type="submit"]').textContent = 'บันทึกการแก้ไข';
  document.getElementById('clinicTypeCancelEdit').classList.remove('hidden');
  document.getElementById('clinicTypeName').focus();
}
document.getElementById('clinicTypeCancelEdit')?.addEventListener('click', resetClinicTypeForm_);

document.getElementById('clinicTypeForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('clinicTypeName').value.trim();
  const color = document.getElementById('clinicTypeColor').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';
  const editId = document.getElementById('clinicTypeEditId').value;
  const res = editId ? await api('updateClinicType', { id: editId, name, color }) : await api('addClinicType', { name, color });
  submitBtn.disabled = false;
  submitBtn.textContent = originalText;
  if (!res.ok) { toast(res.error); return; }
  resetClinicTypeForm_();
  if (editId) toast('บันทึกการแก้ไขแล้ว');
  await reloadClinicTypes_(); await Promise.all([reloadClinicRules_(), renderCalendar()]); // ชื่อ/สีเปลี่ยน ปฏิทินและรายการกฎต้องรีเฟรชตาม
});

/* ---------------- กฎคลินิกอัตโนมัติ (ตั้งค่า) ---------------- */

const RULE_WEEKDAY_LABELS = { '0': 'อาทิตย์', '1': 'จันทร์', '2': 'อังคาร', '3': 'พุธ', '4': 'พฤหัสบดี', '5': 'ศุกร์', '6': 'เสาร์' };
const RULE_NTH_LABELS = { every: 'ทุกสัปดาห์', '1': 'สัปดาห์ที่ 1', '2': 'สัปดาห์ที่ 2', '3': 'สัปดาห์ที่ 3', '4': 'สัปดาห์ที่ 4', last: 'สัปดาห์สุดท้าย' };

function renderRuleClinicSelect(clinicTypes) {
  const select = document.getElementById('ruleClinicSelect');
  select.innerHTML = clinicTypes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function renderClinicRulesList(rows) {
  const list = document.getElementById('clinicRuleList');
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<li style="background:none;color:var(--ink-soft);">ยังไม่มีกฎอัตโนมัติ</li>'; return; }
  rows.forEach(r => {
    const clinicType = state.clinicTypes.find(c => c.id === r.clinicTypeId);
    const clinicName = clinicType ? clinicType.name : '(ไม่พบคลินิก)';
    const weekdayLabel = RULE_WEEKDAY_LABELS[String(r.weekday)] || r.weekday;
    const nthLabel = RULE_NTH_LABELS[String(r.nth)] || r.nth;
    const li = document.createElement('li');
    li.innerHTML = `<span>${clinicName} — ${nthLabel === 'ทุกสัปดาห์' ? 'ทุกวัน' + weekdayLabel : `วัน${weekdayLabel} (${nthLabel})`}${r.note ? ' — ' + r.note : ''}</span><span class="busy-item-actions"><button class="busy-edit-btn" data-edit-id="${r.id}">แก้ไข</button><button data-id="${r.id}">ลบ</button></span>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => startEditClinicRule_(btn.dataset.editId, rows));
  });
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api('removeClinicRule', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); return; }
      await Promise.all([reloadClinicRules_(), renderCalendar()]);
    });
  });
}

function resetClinicRuleForm_() {
  document.getElementById('clinicRuleForm').reset();
  document.getElementById('ruleEditId').value = '';
  document.querySelector('#clinicRuleForm button[type="submit"]').textContent = 'เพิ่มกฎ';
  document.getElementById('ruleCancelEdit').classList.add('hidden');
}
function startEditClinicRule_(id, rows) {
  const r = rows.find(x => x.id === id);
  if (!r) return;
  document.getElementById('ruleClinicSelect').value = r.clinicTypeId;
  document.getElementById('ruleWeekday').value = String(r.weekday);
  document.getElementById('ruleNth').value = String(r.nth);
  document.getElementById('ruleNote').value = r.note || '';
  document.getElementById('ruleEditId').value = r.id;
  document.querySelector('#clinicRuleForm button[type="submit"]').textContent = 'บันทึกการแก้ไข';
  document.getElementById('ruleCancelEdit').classList.remove('hidden');
  document.getElementById('clinicRuleForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
document.getElementById('ruleCancelEdit')?.addEventListener('click', resetClinicRuleForm_);

document.getElementById('clinicRuleForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clinicTypeId = document.getElementById('ruleClinicSelect').value;
  const weekday = document.getElementById('ruleWeekday').value;
  const nth = document.getElementById('ruleNth').value;
  const note = document.getElementById('ruleNote').value.trim();
  if (!clinicTypeId) { toast('กรุณาเพิ่มประเภทคลินิกก่อน'); return; }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const editId = document.getElementById('ruleEditId').value;
  const res = editId ? await api('updateClinicRule', { id: editId, clinicTypeId, weekday, nth, note }) : await api('addClinicRule', { clinicTypeId, weekday, nth, note });

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { toast(res.error); return; }
  resetClinicRuleForm_();
  toast(editId ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มกฎอัตโนมัติแล้ว');
  await Promise.all([reloadClinicRules_(), renderCalendar()]);
});

/* ---------------- ปิด/ไม่ว่างอัตโนมัติ (ตามวัน) ---------------- */

// เติมตัวเลือก "วันที่ 1" ถึง "วันที่ 31" ในช่องตามวันที่ในเดือน (วันสุดท้ายของเดือนมีอยู่แล้วใน HTML)
(() => {
  const sel = document.getElementById('busyRuleDayOfMonth');
  if (!sel) return;
  for (let d = 31; d >= 1; d--) {
    const opt = document.createElement('option');
    opt.value = String(d);
    opt.textContent = 'วันที่ ' + d;
    sel.insertBefore(opt, sel.firstChild);
  }
})();

document.getElementById('busyRulePatternType')?.addEventListener('change', (e) => {
  const isWeekday = e.target.value === 'weekday';
  document.getElementById('busyRuleWeekdayFields').classList.toggle('hidden', !isWeekday);
  document.getElementById('busyRuleDomFields').classList.toggle('hidden', isWeekday);
});
document.getElementById('busyRulePartial')?.addEventListener('change', (e) => {
  document.getElementById('busyRuleTimeFields').classList.toggle('hidden', !e.target.checked);
});

function renderBusyRulesList(rows) {
  const list = document.getElementById('busyRuleList');
  if (!list) return;
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<li style="background:none;color:var(--ink-soft);">ยังไม่มีกฎปิดอัตโนมัติ</li>'; return; }
  rows.forEach(r => {
    let whenLabel;
    if (r.patternType === 'weekday') {
      const weekdayLabel = RULE_WEEKDAY_LABELS[String(r.weekday)] || r.weekday;
      const nthLabel = RULE_NTH_LABELS[String(r.nth)] || r.nth;
      whenLabel = nthLabel === 'ทุกสัปดาห์' ? 'ทุกวัน' + weekdayLabel : `วัน${weekdayLabel} (${nthLabel})`;
    } else {
      whenLabel = r.dayOfMonth === 'last' ? 'วันสุดท้ายของเดือน' : 'วันที่ ' + r.dayOfMonth + ' ของเดือน';
    }
    const timeLabel = r.startTime ? `${r.startTime}-${r.endTime} (${r.type})` : 'ปิดทั้งวัน';
    const li = document.createElement('li');
    li.innerHTML = `<span>${whenLabel} — ${timeLabel}${r.note ? ' — ' + r.note : ''}</span><button data-id="${r.id}">ลบ</button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api('removeBusyRule', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); return; }
      await Promise.all([reloadBusyRules_(), renderCalendar()]);
    });
  });
}

document.getElementById('busyRuleForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const patternType = document.getElementById('busyRulePatternType').value;
  const isPartial = document.getElementById('busyRulePartial').checked;
  const note = document.getElementById('busyRuleNote').value.trim();

  const payload = { patternType, note };
  if (patternType === 'weekday') {
    payload.weekday = document.getElementById('busyRuleWeekday').value;
    payload.nth = document.getElementById('busyRuleNth').value;
  } else {
    payload.dayOfMonth = document.getElementById('busyRuleDayOfMonth').value;
  }
  if (isPartial) {
    payload.startTime = document.getElementById('busyRuleStart').value;
    payload.endTime = document.getElementById('busyRuleEnd').value;
    payload.type = document.getElementById('busyRuleType').value;
    if (!payload.startTime || !payload.endTime) { toast('กรุณาระบุเวลาเริ่มและเวลาสิ้นสุด'); return; }
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const res = await api('addBusyRule', payload);

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { toast(res.error); return; }
  document.getElementById('busyRuleForm').reset();
  document.getElementById('busyRuleTimeFields').classList.add('hidden');
  document.getElementById('busyRuleWeekdayFields').classList.remove('hidden');
  document.getElementById('busyRuleDomFields').classList.add('hidden');
  toast('เพิ่มกฎปิดอัตโนมัติแล้ว');
  await Promise.all([reloadBusyRules_(), renderCalendar()]);
});

/* ---------------- เริ่มระบบ ---------------- */
// วางไว้ท้ายไฟล์เสมอ เพื่อให้ตัวแปร/ฟังก์ชันทั้งหมด (เช่น MONTH_NAMES) ถูกประกาศครบก่อนเรียกใช้งาน
/* ---------------- สถิติ (Dashboard) ---------------- */

function ymd_(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function setDashPreset_(preset) {
  const now = new Date();
  let from, to;
  if (preset === 'thisMonth') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (preset === 'lastMonth') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (preset === 'fiscal') {
    // ปีงบประมาณไทย: 1 ต.ค. - 30 ก.ย.
    const startYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
    from = new Date(startYear, 9, 1);
    to = new Date(startYear + 1, 8, 30);
  } else if (preset === 'year') {
    from = new Date(now.getFullYear(), 0, 1);
    to = new Date(now.getFullYear(), 11, 31);
  } else {
    return;
  }
  document.getElementById('dashFrom').value = ymd_(from);
  document.getElementById('dashTo').value = ymd_(to);
  document.querySelectorAll('.dash-presets button').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
}

document.querySelectorAll('.dash-presets button').forEach(b => {
  b.addEventListener('click', () => { setDashPreset_(b.dataset.preset); loadDashboard(); });
});
document.getElementById('dashApplyBtn')?.addEventListener('click', () => {
  document.querySelectorAll('.dash-presets button').forEach(b => b.classList.remove('active'));
  loadDashboard();
});
document.getElementById('refreshDashboardBtn')?.addEventListener('click', loadDashboard);

async function loadDashboard() {
  const from = document.getElementById('dashFrom').value;
  const to = document.getElementById('dashTo').value;
  const note = document.getElementById('dashNote');
  const body = document.getElementById('dashBody');
  if (!from || !to) return;
  if (from > to) { toast('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด'); return; }

  note.textContent = 'กำลังโหลด...';
  const res = await api('getDashboard', { from, to });
  if (!res.ok) { note.textContent = ''; toast(res.error); return; }
  state.dashboardLoaded = true;
  renderDashboard(res.data);
}

function pct_(n, d) { return d ? Math.round((n / d) * 100) : 0; }

function renderDashboard(d) {
  const note = document.getElementById('dashNote');
  const t = d.totals;
  const rateTxt = t.attendanceRate === null ? 'ยังไม่มีข้อมูล' : pct_(t.trackedPast ? Math.round(t.attendanceRate * t.trackedPast) : 0, t.trackedPast) + '%';
  note.textContent = `ช่วง ${d.from} ถึง ${d.to}` + (d.trackingStart ? ` · เริ่มมีข้อมูล "มาแล้ว" ตั้งแต่ ${d.trackingStart}` : ' · ยังไม่เคยมีการบันทึก "มาแล้ว" เลย');

  const kpis = [
    { label: 'นัดทั้งหมด (ไม่รวมยกเลิก)', num: t.appointments, cls: 'hero' },
    { label: 'มารับบริการแล้ว', num: t.attended, sub: pct_(t.attended, t.appointments) + '% ของนัดทั้งหมด' },
    { label: 'ยังไม่ถึงวันนัด', num: t.upcoming },
    { label: 'ไม่มาตามนัด', num: t.noShow, sub: t.trackedPast ? `จาก ${t.trackedPast} นัดที่ผ่านไปแล้ว` : 'ยังไม่มีข้อมูลเทียบ' },
    { label: 'อัตรามาตามนัด', num: rateTxt },
    { label: 'จำนวนคนไข้ที่มา (ไม่นับซ้ำ)', num: t.patientsSeen, sub: t.repeatPatients ? `มาซ้ำ ${t.repeatPatients} คน` : '' },
    { label: 'ยกเลิกนัด', num: t.cancelled }
  ];
  document.getElementById('dashBody').innerHTML = `
    <div class="kpi-grid">
      ${kpis.map(k => `
        <div class="kpi-card ${k.cls || ''}">
          <div class="kpi-num">${k.num}</div>
          <div class="kpi-label">${k.label}</div>
          ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
        </div>`).join('')}
    </div>
    <div class="dash-grid">
      <div class="dash-panel wide">
        <h3>แนวโน้มจำนวนนัด${d.granularity === 'day' ? 'รายวัน' : 'รายเดือน'}</h3>
        <p class="dash-sub">แท่งอ่อน = นัดทั้งหมด · แท่งเขียว = มารับบริการแล้ว</p>
        ${renderTrend_(d.trend, d.granularity)}
      </div>
      <div class="dash-panel">
        <h3>แยกตามประเภทนัด</h3>
        ${renderHBars_(d.byType)}
      </div>
      <div class="dash-panel">
        <h3>แยกตามคลินิก</h3>
        ${renderHBars_(d.byClinic, true)}
      </div>
      <div class="dash-panel">
        <h3>แยกตามหมู่</h3>
        <p class="dash-sub">เรียงตามจำนวนที่มารับบริการมากสุด</p>
        ${renderHBars_(d.byMoo.map(m => ({ name: 'หมู่ ' + m.name, total: m.total, attended: m.attended })))}
      </div>
      <div class="dash-panel">
        <h3>แยกตามวันในสัปดาห์</h3>
        ${renderHBars_(d.byWeekday)}
      </div>
      ${d.byPatient ? `
      <div class="dash-panel wide">
        <h3>จำนวนครั้งที่มารับบริการรายคน</h3>
        <p class="dash-sub">ตัวเลข = มารับบริการแล้ว / นัดทั้งหมดในช่วงนี้ · เรียงตามจำนวนครั้งที่มามากสุด${d.byPatientTotal > d.byPatient.length ? ` · แสดง ${d.byPatient.length} จาก ${d.byPatientTotal} คน` : ''}</p>
        ${renderPatientBars_(d.byPatient)}
      </div>` : ''}
    </div>
  `;
}

/** แถบจำนวนครั้งรายคน: PTN + ชื่อ + แถบ (นัดทั้งหมด/มาแล้ว) */
function renderPatientBars_(rows) {
  if (!rows || !rows.length) return '<div class="dash-empty">ยังไม่มีนัดที่ผูก PTN ในช่วงนี้</div>';
  const max = Math.max(1, ...rows.map(r => r.total));
  return rows.map(r => `
    <div class="hbar-row patient-row">
      <span class="hbar-label" title="${esc_(r.ptn)} ${esc_(r.name)}"><span class="patient-row-ptn">${esc_(r.ptn)}</span> ${esc_(r.name)}</span>
      <div class="hbar-track">
        <div class="hbar-total" style="width:${r.total / max * 100}%"></div>
        <div class="hbar-attended" style="width:${r.attended / max * 100}%"></div>
      </div>
      <span class="hbar-num">${r.attended}/${r.total}</span>
    </div>`).join('');
}

function renderHBars_(rows, useColor) {
  if (!rows || !rows.length) return '<div class="dash-empty">ไม่มีข้อมูลในช่วงนี้</div>';
  const max = Math.max(1, ...rows.map(r => r.total));
  return rows.map(r => `
    <div class="hbar-row">
      <span class="hbar-label" title="${r.name}">${r.name}</span>
      <div class="hbar-track">
        <div class="hbar-total" style="width:${r.total / max * 100}%"></div>
        <div class="hbar-attended" style="width:${r.attended / max * 100}%;${useColor && r.color ? `--bar-color:${r.color}` : ''}"></div>
      </div>
      <span class="hbar-num">${r.attended}/${r.total}</span>
    </div>`).join('');
}

function renderTrend_(trend, granularity) {
  if (!trend || !trend.length) return '<div class="dash-empty">ไม่มีข้อมูลในช่วงนี้</div>';
  const max = Math.max(1, ...trend.map(t => t.total));
  const showEvery = Math.ceil(trend.length / 20); // ป้ายกำกับเยอะไปจะอ่านไม่ออก โชว์เว้นช่วง
  const labelOf = k => granularity === 'day' ? k.slice(8) : THAI_MONTH_SHORT[Number(k.slice(5, 7)) - 1];
  return `<div class="trend-chart">${trend.map((t, i) => `
    <div class="trend-col" title="${t.key}: ${t.attended}/${t.total}">
      <div class="trend-bars">
        <div class="trend-total" style="height:${t.total / max * 100}%"></div>
        <div class="trend-attended" style="height:${t.attended / max * 100}%"></div>
      </div>
      <div class="trend-label">${i % showEvery === 0 ? labelOf(t.key) : ''}</div>
    </div>`).join('')}</div>`;
}

const THAI_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];


/* ---------------- พับ/ขยายแต่ละหัวข้อในหน้าตั้งค่า ---------------- */

function setupCollapsiblePanels_() {
  document.querySelectorAll('#settingsView .panel').forEach(panel => {
    const h3 = panel.querySelector('h3');
    if (!h3 || panel.dataset.collapsibleSetup) return;
    panel.dataset.collapsibleSetup = '1';

    // ย้ายทุกอย่างหลัง h3 เข้ากล่อง panel-body เดียว เพื่อพับ/ขยายได้ทีเดียวทั้งหมด
    const body = document.createElement('div');
    body.className = 'panel-body';
    const toMove = [];
    let node = h3.nextSibling;
    while (node) { toMove.push(node); node = node.nextSibling; }
    toMove.forEach(n => body.appendChild(n));
    panel.appendChild(body);

    const titleText = h3.textContent;
    h3.classList.add('panel-toggle');
    h3.innerHTML = `<span>${titleText}</span><span class="panel-chevron">▾</span>`;
    h3.addEventListener('click', () => panel.classList.toggle('collapsed'));

    panel.classList.add('collapsed'); // เริ่มต้นพับเก็บไว้ก่อน ให้ผู้ใช้กดดูทีละหัวข้อเอง
  });
}
setupCollapsiblePanels_();

if (state.token) enterApp();
