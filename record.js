/* ============================================================================
 * เวชระเบียน: แบบประเมินครั้งแรกของแต่ละ session (5 ชุด ตามแบบฟอร์มเดิมในชีต)
 * ใช้ของจาก app.js: api(), state, esc_(), toast(), showView_(), fmtThaiDate_(), todayYmd_(), logout()
 *
 * ช่องในแบบฟอร์มกำหนดที่ไฟล์นี้ (data-k = ชื่อคอลัมน์ในชีต Records) — เพิ่มช่องใหม่ที่นี่ได้เลย หลังบ้านเพิ่มคอลัมน์ให้เอง
 * ตัวเลือกดรอปดาวน์มาจากชีต RecordOptions (ชื่อรายการ = ชื่อคอลัมน์) รายการทดสอบ/เกณฑ์มาจากชีต AssessTests และ AssessNorms
 * ========================================================================== */

const REC = {
  setup: null,      // { options, tests, norms } จากหลังบ้าน
  patient: null,    // คนไข้ของแบบฟอร์มที่เปิดอยู่
  meta: null,       // { id, session, status, date, ... } ของชุดที่เปิดอยู่ (id ว่าง = ยังไม่เคยบันทึก)
  dirty: false,     // มีการแก้ไขที่ยังไม่ได้บันทึก
  autoDec: '',      // ข้อความ Decrease performance ที่ระบบเติมให้ล่าสุด (ใช้ดูว่าผู้ใช้แก้เองหรือยัง)
  saving: false
};
const REC_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const REC_OTHER = '__other__';

/* ---------------- ตัวช่วยสร้างช่องกรอก ---------------- */

const recAttr_ = s => esc_(String(s === undefined || s === null ? '' : s));
/** ดรอปดาวน์ที่เลือก "พิมพ์เอง…" ได้ — list = ชื่อรายการในชีต RecordOptions, ph = ข้อความบอกว่าช่องนี้คืออะไร */
function rDD(key, list, ph, cls) {
  const opts = ((REC.setup && REC.setup.options[list]) || []).map(o => `<option value="${recAttr_(o)}">${esc_(o)}</option>`).join('');
  return `<select data-k="${key}" data-list="${list}" class="rec-dd ${cls || 'm'}" aria-label="${recAttr_(ph)}"><option value="">${esc_(ph || 'เลือก')}</option>${opts}<option value="${REC_OTHER}">พิมพ์เอง…</option></select>`;
}
const rT = (key, ph, cls) => `<input type="text" data-k="${key}" class="${cls || 'm'}" placeholder="${recAttr_(ph)}" aria-label="${recAttr_(ph)}" maxlength="500">`;
const rTA = (key, ph) => `<textarea data-k="${key}" class="x" rows="2" placeholder="${recAttr_(ph)}" aria-label="${recAttr_(ph)}" maxlength="1000"></textarea>`;
const rNum = (key, label) => `<input type="number" data-k="${key}" class="s" inputmode="decimal" step="any" min="0" aria-label="${recAttr_(label)}">`;
const rTx = s => `<span class="tx">${s}</span>`;
const rCk = (key, label, cls) => `<label class="ck ${cls || ''}"><input type="checkbox" data-k="${key}">${label}</label>`;
/** ตัวเลือกแบบเลือกได้อย่างเดียว (เช่น None / Yes) — เก็บค่าเป็นคำเดียวในช่อง key กดซ้ำเพื่อยกเลิก */
const rPair = (key, items) => items.map(it => `<label class="ck ${it[2] || ''}"><input type="checkbox" data-pair="${key}" value="${it[0]}">${it[1]}</label>`).join('');
const rNY = key => rPair(key, [['none', 'None'], ['yes', 'Yes', 'warn']]);
const rNrs = (key, label) => `<span class="rec-nrs" data-nrs="${key}" role="group" aria-label="${recAttr_(label)}">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => `<button type="button" data-v="${i}">${i}</button>`).join('')}</span>`;
const rRow = (label, ...c) => `<div class="rec-row"><span class="lb">${label}</span>${c.join('')}</div>`;
/** แถวที่ต้องใช้เต็มความกว้าง (จอกว้างแบบฟอร์มจัด 2 คอลัมน์ แถวทั่วไปกินครึ่งเดียว) */
const rWide = html => html.replace('class="rec-row', 'class="rec-row wide');
/**
 * ส่วนที่ซ่อนไว้จนกว่าจะใช้ — cond: "ช่อง" (ติ๊กแล้ว/มีค่า) · "ช่อง=ค่า" · "ช่อง!=ค่า" (มีค่าและไม่ใช่ค่านั้น)
 * ช่องที่อยู่ในส่วนที่ซ่อนอยู่จะไม่ถูกบันทึก
 */
const rExtra = (cond, ...c) => c.length ? `<span class="rec-extra hidden" data-show="${cond}">${c.join('')}</span>` : '';
/** แถวที่ขึ้นต้นด้วยช่องติ๊ก — ช่องย่อยของแถวขึ้นมาเมื่อติ๊ก */
const rCRow = (key, label, ...c) => `<div class="rec-row" data-lead="${key}">${rCk(key, label, 'lead')}${rExtra(key, ...c)}</div>`;
/** แถว None / Yes — ช่องรายละเอียดขึ้นมาเมื่อเลือก Yes */
const rNYRow = (key, label, ...c) => `<div class="rec-row" data-ny="${key}"><span class="lb">${label}</span>${rNY(key)}${rExtra(key + '=yes', ...c)}</div>`;
/** กลุ่มช่องที่ต้องอยู่ด้วยกัน: จอแคบขึ้นบรรทัดใหม่พร้อมกันทั้งกลุ่ม */
const rGrp = inner => `<span class="rec-grp">${inner}</span>`;
const rSub = s => `<div class="rec-sub">${s}</div>`;
const rCard = (n, title, body) => `<section class="rec-card" id="recPart${n}"><h3><span class="n">${n}</span>${title}</h3><div class="rec-grid">${body}</div></section>`;
/**
 * รายการแบบ "เลือกจากดรอปดาวน์ก่อน แล้วช่องกรอกของรายการนั้นจึงขึ้นมา" (ผลทดสอบ, Special test, Intervention)
 * items: [{ id, label, group, html, wide, lead, exs, block }] — lead = ช่องติ๊ก (ซ่อน) ที่ต้องเป็น Y เมื่อรายการถูกเลือก
 */
function rPick(id, placeholder, items) {
  return `<div class="rec-pick" data-pick="${id}" data-ph="${recAttr_(placeholder)}">
    <div class="rec-pick-bar"><select class="rec-pick-add" aria-label="${recAttr_(placeholder)}"></select></div>
    <div class="rec-pick-items rec-grid">${items.map(it => `
      <div class="${it.block ? 'rec-pick-block' : 'rec-row'} rec-pick-item hidden${it.wide || it.block ? ' wide' : ''}" data-item="${recAttr_(it.id)}" data-label="${recAttr_(it.label)}" data-group="${recAttr_(it.group || '')}"${it.lead ? ` data-leadk="${it.lead}"` : ''}${it.exs ? ' data-exs="1"' : ''}>
        ${it.lead ? `<input type="checkbox" data-k="${it.lead}" class="rec-lead-hidden" tabindex="-1" aria-hidden="true">` : ''}${it.html}
        <button type="button" class="rec-pick-x" title="เอารายการนี้ออก" aria-label="เอารายการนี้ออก: ${recAttr_(it.label)}">✕</button>
      </div>`).join('')}</div>
  </div>`;
}
const rName = s => `<span class="lb pick-name">${s}</span>`;

/* ---------------- แบบฟอร์ม 5 ชุด ---------------- */

function recPart1_() {
  return rCard(1, 'Personal Data', [
    rWide(`<div class="rec-row rec-consent" id="recConsentRow"><span class="lb">การยินยอม</span>${rPair('p1_consent', [['signed', 'ลงนามในใบยินยอมแล้ว'], ['verbal', 'ยินยอมด้วยวาจา']])}${rExtra('p1_consent', rT('p1_consent_by', 'ผู้ให้ความยินยอม (กรอกเมื่อไม่ใช่คนไข้เอง เช่น ญาติ)', 'x'))}<a class="secondary rec-mini" id="recConsentPrint" href="consent.html" target="_blank" rel="noopener">พิมพ์ใบยินยอม</a></div>`),
    rWide(rRow('Chief complaint', rT('p1_cc', 'อาการสำคัญ', 'x'))),
    rWide(rRow('Present history', rTA('p1_ph', 'ประวัติปัจจุบัน'))),
    rSub('Past history'),
    rWide(rRow('U/D', rDD('p1_ud1', 'ud', 'โรคประจำตัว 1'), rDD('p1_ud2', 'ud', 'โรคประจำตัว 2'), rDD('p1_ud3', 'ud', 'โรคประจำตัว 3'), rT('p1_ud_note', 'อื่น ๆ / รายละเอียด', 'x'))),
    rRow('Accident', rDD('p1_acc', 'yesNo', 'Yes / No'), rExtra('p1_acc!=No', rT('p1_acc_note', 'รายละเอียด', 'x'))),
    rNYRow('p1_fall', 'Falling history', rT('p1_fall_note', 'รายละเอียด', 'x')),
    rSub('Precaution / Contraindication / Flags'),
    rNYRow('p1_prec', 'Precaution', rT('p1_prec_note', 'รายละเอียด', 'x')),
    rNYRow('p1_contra', 'Contraindication', rDD('p1_contra1', 'contraindication', 'ข้อห้าม', 'l')),
    rNYRow('p1_red', 'Red flag', rDD('p1_red1', 'redFlag', 'Red flag 1'), rDD('p1_red2', 'redFlag', 'Red flag 2')),
    rNYRow('p1_orange', 'Orange flag', rDD('p1_orange1', 'orangeFlag', 'Orange flag', 'l')),
    rNYRow('p1_yellow', 'Yellow flag', rDD('p1_yellow1', 'yellowFlag', 'Yellow flag 1'), rDD('p1_yellow2', 'yellowFlag', 'Yellow flag 2')),
    rSub('Diagnosis'),
    rWide(rRow('Medical diagnosis', rDD('p1_mdx1', 'medicalDx', 'การวินิจฉัย 1'), rDD('p1_mdx2', 'medicalDx', 'การวินิจฉัย 2'), rDD('p1_mdx3', 'medicalDx', 'การวินิจฉัย 3'), rDD('p1_mdx4', 'medicalDx', 'การวินิจฉัย 4'))),
    rRow('PT diagnosis', rDD('p1_ptdx', 'ptDx', 'Physical therapy diagnosis', 'l'))
  ].join(''));
}

/* ---------------- แบบประเมินแบบติ๊กทีละข้อ: EQ-5D-5L และ Barthel ADL ---------------- */

// EQ-5D-5L: 5 มิติ มิติละ 5 ระดับ (1 = ไม่มีปัญหา ... 5 = มากที่สุด/ทำไม่ได้)
// คะแนนอรรถประโยชน์ = 1 - ผลรวมค่าสัมประสิทธิ์ของแต่ละมิติ (ค่าสัมประสิทธิ์ฉบับภาษาไทย: Pattanaphesaj J., Mahidol University; 2014)
// ที่นี่เป็นช่องบันทึก "ระดับ" ที่คนไข้ตอบ ไม่ใช่ตัวแบบสอบถาม — ถ้อยคำของแบบสอบถามเป็นลิขสิทธิ์ของ EuroQol Group
const REC_EQ5D = [
  ['mo', 'การเคลื่อนไหว', [0, 0.056, 0.114, 0.231, 0.307]],
  ['sc', 'การดูแลตนเอง', [0, 0.033, 0.108, 0.225, 0.254]],
  ['ua', 'กิจกรรมที่ทำเป็นประจำ', [0, 0.043, 0.075, 0.165, 0.207]],
  ['pd', 'อาการเจ็บปวด/ไม่สบายตัว', [0, 0.040, 0.068, 0.233, 0.266]],
  ['ad', 'ความวิตกกังวล/ซึมเศร้า', [0, 0.032, 0.097, 0.202, 0.249]]
];
const REC_EQ5D_LEVELS = ['ไม่มีปัญหา', 'เล็กน้อย', 'ปานกลาง', 'มาก', 'มากที่สุด'];
// Barthel ADL index (แบบประเมินคัดกรอง 10 ข้อ รวม 0-20 คะแนน): ลำดับตัวเลือก = คะแนน 0, 1, 2, ...
const REC_BARTHEL = [
  ['Feeding', 'รับประทานอาหาร', ['ตักเข้าปากเองไม่ได้ ต้องมีคนป้อน', 'ตักเองได้แต่ต้องมีคนช่วยเตรียม', 'ตักและช่วยตัวเองได้ปกติ']],
  ['Grooming', 'ล้างหน้า หวีผม แปรงฟัน โกนหนวด', ['ต้องการความช่วยเหลือ', 'ทำเองได้']],
  ['Transfer', 'ลุกนั่งจากที่นอน / เตียงไปเก้าอี้', ['นั่งไม่ได้ หรือต้องใช้ 2 คนยก', 'ต้องช่วยอย่างมากจึงนั่งได้', 'ต้องช่วยบ้าง หรือต้องมีคนดูแล', 'ทำได้เอง']],
  ['Toilet use', 'ใช้ห้องน้ำ', ['ช่วยตัวเองไม่ได้', 'ทำเองได้บ้าง ต้องช่วยบางอย่าง', 'ช่วยตัวเองได้ดี']],
  ['Mobility', 'เคลื่อนที่ภายในห้องหรือบ้าน', ['เคลื่อนที่ไปไหนไม่ได้', 'ใช้รถเข็นเองได้', 'เดินโดยมีคนช่วยหรือดูแล', 'เดินหรือเคลื่อนที่ได้เอง']],
  ['Dressing', 'สวมใส่เสื้อผ้า', ['ต้องมีคนสวมใส่ให้', 'ช่วยตัวเองได้ราวครึ่งหนึ่ง', 'ช่วยตัวเองได้ดี']],
  ['Stairs', 'ขึ้นลงบันได 1 ชั้น', ['ทำไม่ได้', 'ต้องการคนช่วย', 'ขึ้นลงได้เอง']],
  ['Bathing', 'อาบน้ำ', ['ต้องมีคนช่วยหรือทำให้', 'อาบน้ำเองได้']],
  ['Bowels', 'กลั้นอุจจาระ (1 สัปดาห์ที่ผ่านมา)', ['กลั้นไม่ได้ หรือต้องสวนเสมอ', 'กลั้นไม่ได้บางครั้ง', 'กลั้นได้ปกติ']],
  ['Bladder', 'กลั้นปัสสาวะ (1 สัปดาห์ที่ผ่านมา)', ['กลั้นไม่ได้ หรือใส่สายสวนที่ดูแลเองไม่ได้', 'กลั้นไม่ได้บางครั้ง', 'กลั้นได้ปกติ']]
];
function recBarthelGroup_(total) {
  return total >= 12 ? 'กลุ่มติดสังคม' : (total >= 5 ? 'กลุ่มติดบ้าน' : 'กลุ่มติดเตียง');
}
/** ตัวเลือกแบบปุ่ม เลือกได้ข้อเดียว กดซ้ำเพื่อยกเลิก — เก็บค่าเป็นตัวเลขในช่อง key (ใช้กลไกเดียวกับ NRS) */
const rOpts = (key, label, items) => `<span class="rec-opts" data-nrs="${key}" role="group" aria-label="${recAttr_(label)}">${items.map(it => `<button type="button" data-v="${it[0]}"><b>${it[0]}</b> ${esc_(it[1])}</button>`).join('')}</span>`;

/** บล็อกแบบประเมินติ๊กทีละข้อ ในรูปของรายการที่เลือกจากดรอปดาวน์ Performance test */
function recScoreItems_() {
  const tests = (REC.setup && REC.setup.tests) || [];
  const groupOf = (key, dflt) => { const t = tests.find(x => x.key === key); return t ? t.group : dflt; };
  return [
    { id: 'eq5d', label: 'EQ-5D-5L', group: groupOf('eq5d', 'QoL'), block: true, html: `
      <details class="rec-details" id="recEq5d" open>
        <summary><b>EQ-5D-5L</b><span class="rec-details-sum" id="recEq5dSum"></span></summary>
        <div class="rec-grid">
        ${REC_EQ5D.map(d => rWide(rRow(esc_(d[1]), rOpts('pt_eq5d_' + d[0], d[1], REC_EQ5D_LEVELS.map((t, i) => [i + 1, t]))))).join('')}
        ${rRow('สุขภาพวันนี้ (VAS)', `<input type="number" data-k="pt_eq5d_vas" class="s" min="0" max="100" step="1" inputmode="numeric" aria-label="สุขภาพวันนี้ VAS 0 ถึง 100">`, rTx('0 = แย่ที่สุด · 100 = ดีที่สุด'))}
        ${rRow('คะแนนอรรถประโยชน์', `<input type="number" data-k="pt_eq5d" class="s" min="-1" max="1" step="0.001" inputmode="decimal" aria-label="คะแนนอรรถประโยชน์ EQ-5D">`, rTx('คำนวณให้เองเมื่อติ๊กครบ 5 มิติ'))}
        </div>
      </details>` },
    { id: 'barthel', label: 'Barthel ADL', group: groupOf('barthel', 'Functional Questionnaire test'), block: true, html: `
      <details class="rec-details" id="recBarthel" open>
        <summary><b>Barthel ADL</b><span class="rec-details-sum" id="recBarthelSum"></span></summary>
        <div class="rec-grid">
        ${REC_BARTHEL.map((it, i) => `<div class="rec-row rec-barthel"><span class="lb">${i + 1}. ${esc_(it[0])}<small>${esc_(it[1])}</small></span>${rOpts('pt_barthel_' + (i + 1), it[0], it[2].map((t, v) => [v, t]))}</div>`).join('')}
        </div>
        <input type="hidden" data-k="pt_barthel">
      </details>` }
  ];
}

function recPicked_(key) {
  const on = recBody_().querySelector(`[data-nrs="${key}"] button.on`);
  return on ? Number(on.dataset.v) : null;
}
/** เติมคะแนนรวมลงช่องของมัน — ตอบไม่ครบ: ล้างเฉพาะค่าที่ระบบเคยเติม (ค่าที่ผู้ใช้พิมพ์เองไม่แตะ) */
function recSetScore_(key, value) {
  const el = recBody_().querySelector(`[data-k="${key}"]`);
  if (!el) return;
  if (value !== null) { el.value = String(value); el.dataset.auto = '1'; }
  else if (el.dataset.auto === '1' || el.type === 'hidden') { el.value = ''; delete el.dataset.auto; }
}
function recBarthelTotal_() {
  const picks = REC_BARTHEL.map((it, i) => recPicked_('pt_barthel_' + (i + 1)));
  return picks.every(v => v !== null) ? picks.reduce((s, v) => s + v, 0) : null;
}
/** คำนวณคะแนนของ EQ-5D-5L และ Barthel ADL จากข้อที่ติ๊ก แล้วแสดงผลที่หัวบล็อก */
function recScores_() {
  const lv = REC_EQ5D.map(d => recPicked_('pt_eq5d_' + d[0]));
  const eqDone = lv.filter(v => v !== null).length;
  const eqSum = document.getElementById('recEq5dSum');
  if (!eqSum) return;
  let util = null;
  if (eqDone === REC_EQ5D.length) {
    util = Math.round((1 - REC_EQ5D.reduce((sum, d, i) => sum + d[2][lv[i] - 1], 0)) * 1000) / 1000;
    eqSum.textContent = `สถานะสุขภาพ ${lv.join('')} · อรรถประโยชน์ ${util.toFixed(3)}`;
  } else {
    eqSum.textContent = eqDone ? `ตอบแล้ว ${eqDone} / ${REC_EQ5D.length} มิติ` : 'ยังไม่ได้ประเมิน';
  }
  eqSum.classList.toggle('done', util !== null);
  recSetScore_('pt_eq5d', util);

  const bDone = REC_BARTHEL.filter((it, i) => recPicked_('pt_barthel_' + (i + 1)) !== null).length;
  const total = recBarthelTotal_();
  const bSum = document.getElementById('recBarthelSum');
  bSum.textContent = total !== null ? `${total} / 20 คะแนน · ${recBarthelGroup_(total)}` : (bDone ? `ตอบแล้ว ${bDone} / ${REC_BARTHEL.length} ข้อ` : 'ยังไม่ได้ประเมิน');
  bSum.classList.toggle('done', total !== null);
  bSum.classList.toggle('bad', total !== null && total < 12);
  recSetScore_('pt_barthel', total);
}

/** รายการทดสอบจากชีต AssessTests ในรูปของรายการให้เลือก (EQ5D และ Barthel ใช้บล็อกติ๊กทีละข้อแทนช่องคะแนนเดี่ยว) */
function recTestItems_() {
  const tests = (REC.setup && REC.setup.tests) || [];
  const blocks = recScoreItems_();
  const used = {};
  // ตามลำดับในชีต: EQ5D และ Barthel ใช้บล็อกติ๊กทีละข้อแทนช่องคะแนนเดี่ยว (อยู่ตำแหน่งเดิมของรายการนั้น)
  const items = tests.map(t => {
    const block = blocks.find(b => b.id === t.key);
    if (block) { used[t.key] = true; return block; }
    return { id: t.key, label: t.name, group: t.group, html: `
    <span class="lb">${esc_(t.name)}</span>
    ${t.askName ? `<input type="text" data-k="pt_${t.key}_label" class="m" placeholder="ชื่อแบบสอบถาม" aria-label="ชื่อแบบสอบถาม" maxlength="80">` : ''}
    ${rNum('pt_' + t.key, t.name)}${rTx(esc_(t.unit))}
    <span class="rec-crit" data-crit="${recAttr_(t.key)}"></span>` };
  });
  blocks.forEach(b => { if (!used[b.id]) items.push(b); }); // บล็อกที่ไม่มีในชีต (เช่น Barthel) ต่อท้ายโหมดของตัวเอง
  const groups = [];
  items.forEach(it => { if (groups.indexOf(it.group) === -1) groups.push(it.group); });
  return groups.reduce((out, g) => out.concat(items.filter(it => it.group === g)), []);
}

function recPart2_() {
  const st = (id, label, ...c) => ({ id: id, label: label, lead: 'p2_st_' + id, wide: true, html: rName(label) + c.join('') });
  return rCard(2, 'Physical Examination', [
    rRow('เวลาที่ตรวจ', `<input type="time" data-k="p2_time" class="s2" aria-label="เวลาที่ตรวจ">`),
    rSub('Behavior of symptoms'),
    rRow('อาการ', rDD('p2_sym', 'symptom', 'อาการ'), rTx('of'), rDD('p2_sym_at', 'bodyPart', 'ตำแหน่ง')),
    rRow('Frequency', rDD('p2_freq', 'frequency', 'ความถี่')),
    rRow('NRS · Rest', rNrs('p2_nrs_rest', 'NRS ขณะพัก')),
    rRow('NRS · Function', rNrs('p2_nrs_func', 'NRS ขณะใช้งาน')),
    rRow('Aggravate', rT('p2_agg', 'สิ่งที่ทำให้อาการมากขึ้น', 'x')),
    rRow('Ease', rDD('p2_ease', 'ease', 'สิ่งที่ทำให้อาการลดลง')),
    rSub('Posture / Tenderness / ROM'),
    rWide(`<div class="rec-row"><span class="lb">Posture</span>${rPair('p2_post', [['normal', 'Normal'], ['incorrect', 'Incorrect', 'warn']])}${rExtra('p2_post=incorrect', rCk('p2_post_fhp', 'Forward head'), rCk('p2_post_rs', 'Round shoulder'), rCk('p2_post_ws', 'Winged scapula'), rCk('p2_post_chin', 'Chin out'), rCk('p2_post_kyphosis', 'Thoracic kyphosis'))}</div>`),
    rWide(rNYRow('p2_tender', 'Tenderness', rDD('p2_tender_side', 'side', 'ข้าง', 's'), rDD('p2_tender_at', 'bodyPart', 'ตำแหน่ง'), rDD('p2_tender_muscle', 'muscle', 'กล้ามเนื้อ/โครงสร้าง'))),
    rWide(`<div class="rec-row"><span class="lb">ROM</span>${rPair('p2_rom', [['full', 'Full all direction'], ['limit', 'Limit at', 'warn']])}${rExtra('p2_rom=limit', rDD('p2_rom_side', 'side', 'ข้าง', 's'), rDD('p2_rom_joint', 'joint', 'ข้อ'), rDD('p2_rom_dir', 'direction', 'ทิศทาง'))}</div>`),
    rSub('Special test'),
    rPick('st', 'เลือก Special test ที่ตรวจ', [
      st('upper', 'Shoulder / upper', rDD('p2_st_upper_test', 'specialTestUpper', 'ชื่อการทดสอบ', 'l'), rDD('p2_st_upper_res', 'testResult', 'ผล', 's')),
      st('lower', 'Lumbar / lower', rDD('p2_st_lower_test', 'specialTestLower', 'ชื่อการทดสอบ', 'l'), rDD('p2_st_lower_res', 'testResult', 'ผล', 's')),
      st('other', 'อื่น ๆ', rT('p2_st_other_note', 'ชื่อการทดสอบและผล', 'x'))
    ]),
    rSub('Performance test'),
    rPick('pt', 'เลือกรายการที่จะตรวจ', recTestItems_())
  ].join(''));
}

function recPart3_() {
  return rCard(3, 'Problem list (localize)', [
    rCRow('p3_pain', 'Pain at', rDD('p3_pain_side', 'side', 'ข้าง', 's'), rDD('p3_pain_at', 'bodyPart', 'ตำแหน่ง'), rDD('p3_pain_muscle', 'muscle', 'ส่วน/กล้ามเนื้อ')),
    rCRow('p3_rom', 'ROM limited', rDD('p3_rom_joint', 'joint', 'ข้อ'), rDD('p3_rom_dir', 'direction', 'ทิศทาง')),
    rCRow('p3_imb', 'Muscle imbalance', rTx('of'), rDD('p3_imb_muscle', 'muscle', 'กล้ามเนื้อ/ส่วน')),
    rCRow('p3_numb', 'Numbness', rDD('p3_numb_side', 'side', 'ข้าง', 's'), rDD('p3_numb_at', 'bodyPart', 'ตำแหน่ง')),
    rCRow('p3_amb', 'Poor ambulation'),
    rCRow('p3_hcm', 'Healthcare management'),
    rCRow('p3_other', 'Others', rT('p3_other_note', 'ระบุ', 'x')),
    rWide(`<div class="rec-row" data-lead="p3_decPerf">${rCk('p3_decPerf', 'Decrease performance', 'lead')}${rExtra('p3_decPerf',
      `<textarea data-k="p3_decPerf_detail" class="x" rows="2" placeholder="ระบบเติมรายการทดสอบที่ต่ำกว่าเกณฑ์ให้เอง แก้ไขได้" aria-label="รายละเอียด Decrease performance" maxlength="1000"></textarea>`,
      `<button type="button" class="secondary rec-mini" id="recDecRefill" title="เติมใหม่จากผลทดสอบในชุดที่ 2">↻ ดึงจากผลทดสอบ</button>`)}</div>`)
  ].join(''));
}

function recPart4_() {
  return rCard(4, 'Plan of treatment &amp; Goal', [
    rSub('Plan of treatment'),
    rWide(`<div class="rec-row">${[['ex', 'Exercise'], ['mod', 'Modality'], ['hp', 'Health promotion'], ['nerve', 'Nerve mobilization'], ['amb', 'Ambulation/transfer training'], ['bal', 'Balance training'], ['home', 'Home program']].map(x => rCk('p4_plan_' + x[0], x[1])).join('')}</div>`),
    rCRow('p4_plan_other', 'อื่น ๆ', rT('p4_plan_other_note', 'ระบุ', 'x')),
    rSub('Short term goal'),
    rCRow('p4_stg_pain', 'Relieve pain within', rDD('p4_stg_pain_n', 'count', 'จำนวน', 's'), rTx('visit')),
    rCRow('p4_stg_follow', 'ปฏิบัติตามที่นักกายภาพสอนได้อย่างถูกต้อง ภายใน', rDD('p4_stg_follow_n', 'count', 'จำนวน', 's'), rTx('visit')),
    rCRow('p4_stg_other', 'อื่น ๆ', rT('p4_stg_other_note', 'ระบุ', 'x')),
    rSub('Long term goal'),
    rCRow('p4_ltg_perf', 'Increase physical performance'),
    rCRow('p4_ltg_qol', 'Increase QOL'),
    rCRow('p4_ltg_rtf', 'Return to function', rDD('p4_ltg_rtf_what', 'functionGoal', 'กิจกรรม/หน้าที่'), rDD('p4_ltg_rtf_n', 'count', 'จำนวน', 's'), rDD('p4_ltg_rtf_unit', 'timeUnit', 'หน่วยเวลา', 's')),
    rCRow('p4_ltg_hcm', 'Improve skills for healthcare management', rDD('p4_ltg_hcm_n', 'count', 'จำนวน', 's'), rDD('p4_ltg_hcm_unit', 'timeUnit', 'หน่วยเวลา', 's'))
  ].join(''));
}

const REC_MODALITIES = [['us', 'US', 1], ['usc', 'US Combine', 1], ['es', 'ES', 1], ['pms', 'PMS', 1], ['ctx', 'C-Traction', 1], ['ltx', 'L-Traction', 1], ['hot', 'Hot/Cool', 1],
  ['swr', 'Shock wave Radial'], ['swf', 'Shock wave Focus'], ['laser', 'LASER'], ['swd', 'SWD'], ['nerve', 'Nerve mobilization'], ['mob', 'Mobilization', 2], ['manual', 'Manual technique']];
const REC_EXERCISES = [['stretch', 'Stretching exs.'], ['strength', 'Strengthening exs.'], ['iso', 'Isometric exs.'], ['core', 'Core stabilization exs.'], ['cardio', 'Cardiovascular endurance']];

function recPart5_() {
  const mod = m => {
    const k = 'p5_' + m[0];
    let extra = '';
    if (m[2] === 1) extra = rGrp(rDD(k + '_a', 'modParam1', 'ค่า 1', 's') + rDD(k + '_b', 'modParam2', 'ค่า 2', 's') + rTx('Intensity/parameter') + rDD(k + '_mode', 'modMode', 'โหมด/ค่า', 's'));
    if (m[2] === 2) extra = rGrp(rDD(k + '_tech', 'mobTechnique', 'เทคนิค', 's') + rDD(k + '_grade', 'mobGrade', 'Grade', 's') + rDD(k + '_dir', 'direction', 'ทิศทาง', 's'));
    return { id: m[0], label: m[1], lead: k, wide: true,
      html: rName(m[1]) + rTx('AT') + rDD(k + '_side', 'side', 'ข้าง', 's') + rDD(k + '_at', 'bodyPart', 'ตำแหน่ง') + rTx('OF') + rDD(k + '_of', 'muscle', 'ส่วน/กล้ามเนื้อ') + extra };
  };
  const exs = e => {
    const k = 'p5_ex_' + e[0];
    return { id: 'ex_' + e[0], label: e[1], group: 'Exercise', lead: k, wide: true, exs: true,
      html: rName(e[1]) + rTx('OF') + rDD(k + '_side', 'side', 'ข้าง', 's') + rDD(k + '_part', 'muscle', 'ส่วน/กล้ามเนื้อ') + rDD(k + '_detail', 'exDetail', 'รายละเอียด', 's') +
        rGrp(rDD(k + '_reps', 'reps', 'ครั้ง', 's') + rTx('ครั้ง/sets') + rDD(k + '_sets', 'setsPerDay', 'sets', 's') + rTx('sets/days') + rDD(k + '_days', 'daysPerWeek', 'วัน', 's') + rTx('days/weeks')) };
  };
  const training = [
    { id: 'bal', label: 'Balance training', group: 'Training', lead: 'p5_bal', html: rName('Balance training') },
    { id: 'amb', label: 'Ambulation training', group: 'Training', lead: 'p5_amb', wide: true,
      html: rName('Ambulation training') + rDD('p5_amb_pattern', 'gaitPattern', 'รูปแบบการเดิน') + rTx('with') + rDD('p5_amb_aid', 'gaitAid', 'อุปกรณ์ช่วยเดิน') },
    { id: 'other', label: 'อื่น ๆ', group: 'อื่น ๆ', lead: 'p5_other', wide: true, html: rName('อื่น ๆ') + rT('p5_other_note', 'ระบุ', 'x') }
  ];
  return rCard(5, 'Intervention', [
    rSub('Modality / Manual'),
    rPick('mod', 'เพิ่ม Modality / Manual', REC_MODALITIES.map(mod)),
    rSub('Exercise / Training'),
    rPick('ex', 'เพิ่ม Exercise / Training', REC_EXERCISES.map(exs).concat(training)),
    rSub('Behavior'),
    rCRow('p5_behav', 'ปรับพฤติกรรม', rTx('all times')),
    rCRow('p5_pa', 'Increase PA', rDD('p5_pa_min', 'paMinutes', 'นาที', 's'), rTx('นาที/วัน'), rDD('p5_pa_days', 'paDays', 'วัน', 's'), rTx('วัน/สัปดาห์'))
  ].join(''));
}

/* ---------------- อ่าน/เติมค่าในแบบฟอร์ม ---------------- */

function recBody_() { return document.getElementById('recordBody'); }

/** เพิ่มตัวเลือกให้ดรอปดาวน์ทุกช่องที่ใช้รายการเดียวกัน (ค่าที่พิมพ์เองใช้ต่อในแถวอื่นได้ทันที) */
function recAddOption_(list, value, isNew) {
  if (!value) return;
  const opts = REC.setup.options[list] || (REC.setup.options[list] = []);
  if (opts.indexOf(value) === -1) opts.push(value);
  recBody_().querySelectorAll(`select[data-list="${list}"]`).forEach(sel => {
    if (Array.from(sel.options).some(o => o.value === value)) return;
    const o = document.createElement('option');
    o.value = value; o.textContent = value;
    if (isNew) o.dataset.isNew = '1';
    sel.insertBefore(o, sel.querySelector(`option[value="${REC_OTHER}"]`));
  });
}

/** ขยายความสูงกล่องข้อความให้พอดีเนื้อหา (ไม่ต้องเลื่อนอ่านในกล่องเล็ก) */
function recGrow_(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, 320) + 'px';
}

function recSetField_(el, value) {
  const v = value === undefined || value === null ? '' : String(value);
  if (el.type === 'checkbox') { el.checked = v === 'Y' || v === 'true'; return; }
  if (el.tagName === 'SELECT') {
    if (v && !Array.from(el.options).some(o => o.value === v)) recAddOption_(el.dataset.list, v, false);
    el.value = v;
    el.dataset.prev = v;
    return;
  }
  el.value = v;
  recGrow_(el);
}

function recFill_(data) {
  const body = recBody_();
  body.querySelectorAll('[data-k]').forEach(el => recSetField_(el, data[el.dataset.k]));
  body.querySelectorAll('[data-pair]').forEach(el => { el.checked = String(data[el.dataset.pair] || '') === el.value; });
  body.querySelectorAll('[data-nrs]').forEach(g => {
    const v = data[g.dataset.nrs];
    g.querySelectorAll('button').forEach(b => b.classList.toggle('on', v !== undefined && v !== '' && String(v) === b.dataset.v));
  });
}

/** ช่องที่อยู่ในส่วนที่ซ่อนอยู่ (ยังไม่ได้เลือกใช้) ไม่ถูกบันทึก */
function recHiddenField_(el) {
  return !!el.closest('.rec-extra.hidden, .rec-pick-item.hidden, #recAgeTypedWrap.hidden');
}
function recCollect_() {
  const body = recBody_();
  const data = {};
  body.querySelectorAll('[data-k]').forEach(el => {
    if (recHiddenField_(el)) return;
    const k = el.dataset.k;
    if (el.type === 'checkbox') { if (el.checked) data[k] = true; return; }
    const v = (el.value || '').trim();
    if (v && v !== REC_OTHER) data[k] = v;
  });
  body.querySelectorAll('[data-pair]').forEach(el => { if (el.checked && !recHiddenField_(el)) data[el.dataset.pair] = el.value; });
  body.querySelectorAll('[data-nrs]').forEach(g => {
    const on = g.querySelector('button.on');
    if (on && !recHiddenField_(g)) data[g.dataset.nrs] = on.dataset.v;
  });
  return data;
}

/** ค่าที่ผู้ใช้พิมพ์เองในรอบนี้และยังถูกเลือกอยู่ — ส่งให้หลังบ้านจำเข้ารายการตัวเลือก */
function recLearn_() {
  const learn = {};
  recBody_().querySelectorAll('select[data-list]').forEach(sel => {
    const o = sel.selectedOptions[0];
    if (!o || !o.dataset.isNew || recHiddenField_(sel)) return;
    const list = sel.dataset.list;
    if (!learn[list]) learn[list] = [];
    if (learn[list].indexOf(o.value) === -1) learn[list].push(o.value);
  });
  return learn;
}

/* ---------------- อายุ เพศ และเกณฑ์ของผลทดสอบ ---------------- */

/** วันเกิดจากช่อง วัน/เดือน/ปี พ.ศ. → 'yyyy-MM-dd' · '' = ไม่ได้กรอก · null = กรอกไม่ครบหรือไม่ถูกต้อง */
function recBirthDate_() {
  const d = document.getElementById('recBirthDay').value.trim();
  const m = document.getElementById('recBirthMonth').value;
  const y = document.getElementById('recBirthYear').value.trim();
  if (!d && !m && !y) return '';
  const dd = Number(d), mm = Number(m), be = Number(y);
  if (!dd || !mm || !be || be < 2400 || be > 2700) return null;
  const iso = `${be - 543}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00Z');
  if (isNaN(dt) || dt.toISOString().slice(0, 10) !== iso || iso > todayYmd_()) return null;
  return iso;
}
function recAgeAt_(birth, at) {
  if (!birth || !at) return null;
  let age = Number(at.slice(0, 4)) - Number(birth.slice(0, 4));
  if (at.slice(5) < birth.slice(5)) age--;
  return age >= 0 && age < 130 ? age : null;
}
/** อายุ ณ วันที่ประเมิน: จากวันเกิดถ้ากรอกครบ ไม่งั้นใช้อายุที่พิมพ์เอง */
function recAge_() {
  const birth = recBirthDate_();
  const date = document.getElementById('recDate').value;
  if (birth) return recAgeAt_(birth, date);
  const typed = document.getElementById('recAgeTyped').value.trim();
  const n = Number(typed);
  return typed !== '' && isFinite(n) && n >= 0 && n < 130 ? Math.floor(n) : null;
}
const recSex_ = () => document.getElementById('recSex').value;

/**
 * เกณฑ์ของรายการทดสอบสำหรับคนไข้คนนี้ — คืน null เมื่อรายการนั้นยังไม่มีเกณฑ์
 * อายุอยู่ในตารางค่าปกติและรู้เพศ: ใช้ตารางตามอายุ/เพศ · กรณีอื่น: ใช้เกณฑ์ค่าเดียวของรายการ (riskBelow / riskAbove)
 */
function recCriterion_(test, age, sex) {
  const fmt = n => String(Math.round(n * 100) / 100);
  if (age !== null && sex) {
    const norm = ((REC.setup && REC.setup.norms) || []).find(n => n.testKey === test.key && n.sex === sex && age >= n.ageFrom && age <= n.ageTo);
    if (norm) {
      const nums = [norm.normalLow, norm.normalHigh].filter(v => v !== null && v !== undefined);
      const basis = `${sex === 'M' ? 'ชาย' : 'หญิง'} ${norm.ageFrom}-${norm.ageTo} ปี`;
      if (test.better === 'lower') { const max = Math.max.apply(null, nums); return { text: 'ไม่เกิน ' + fmt(max), basis: basis, below: v => v > max }; }
      const min = Math.min.apply(null, nums);
      return { text: 'ตั้งแต่ ' + fmt(min), basis: basis, below: v => v < min };
    }
  }
  if (test.riskBelow !== null && test.riskBelow !== undefined) return { text: 'ตั้งแต่ ' + fmt(test.riskBelow), basis: '', below: v => v < test.riskBelow };
  if (test.riskAbove !== null && test.riskAbove !== undefined) return { text: 'ไม่เกิน ' + fmt(test.riskAbove), basis: '', below: v => v > test.riskAbove };
  return null;
}

/** อัปเดตป้ายเกณฑ์ข้างผลทดสอบแต่ละรายการ และคืนข้อความของรายการที่ต่ำกว่าเกณฑ์ (1 บรรทัดต่อรายการ) */
function recEvaluateTests_() {
  const body = recBody_();
  const age = recAge_(), sex = recSex_();
  const lines = [];
  ((REC.setup && REC.setup.tests) || []).forEach(t => {
    const input = body.querySelector(`[data-k="pt_${t.key}"]`);
    const tag = body.querySelector(`[data-crit="${t.key}"]`);
    if (!input || !tag) return;
    const crit = recCriterion_(t, age, sex);
    const raw = input.value.trim();
    const v = raw === '' ? null : Number(raw);
    const critText = crit ? `เกณฑ์ ${crit.text} ${t.unit}${crit.basis ? ' (' + crit.basis + ')' : ''}` : '';
    tag.className = 'rec-crit';
    if (!crit) { tag.textContent = v !== null ? 'ยังไม่มีเกณฑ์' : ''; return; }
    if (v === null || !isFinite(v)) { tag.textContent = critText; return; }
    if (crit.below(v)) {
      tag.classList.add('bad');
      tag.textContent = `ต่ำกว่าเกณฑ์ · ${critText}${t.interpret ? ' · ' + t.interpret : ''}`;
      lines.push(`${t.name} ${raw} ${t.unit} (${critText})${t.interpret ? ': ' + t.interpret : ''}`);
    } else {
      tag.classList.add('good');
      tag.textContent = `ผ่านเกณฑ์ · ${critText}`;
    }
  });
  // Barthel ADL ต่ำกว่า 12 คะแนน (กลุ่มติดบ้าน/ติดเตียง) นับเป็นสมรรถภาพลดลงด้วย
  const barthel = recBarthelTotal_();
  if (barthel !== null && barthel < 12) lines.push(`Barthel ADL ${barthel}/20 คะแนน: ${recBarthelGroup_(barthel)}`);
  return lines.join('\n');
}

/**
 * Decrease performance (ชุดที่ 3): เติมรายการที่ต่ำกว่าเกณฑ์ให้เอง
 * ถ้าผู้ใช้แก้ข้อความเองแล้วจะไม่เขียนทับ จนกว่าจะกด "ดึงจากผลทดสอบ" (force)
 */
function recSyncDecPerf_(force) {
  const body = recBody_();
  const text = recEvaluateTests_();
  const detail = body.querySelector('[data-k="p3_decPerf_detail"]');
  const box = body.querySelector('[data-k="p3_decPerf"]');
  if (!detail || !box) return;
  const untouched = detail.value.trim() === '' || detail.value.trim() === REC.autoDec.trim();
  if (force || untouched) {
    const hadAuto = REC.autoDec.trim() !== '' && detail.value.trim() === REC.autoDec.trim();
    detail.value = text;
    if (text) box.checked = true;
    else if (hadAuto || force) box.checked = false;
    recApplyShow_();
    recGrow_(detail);
  }
  REC.autoDec = text;
}

function recUpdateAge_() {
  const birth = recBirthDate_();
  const out = document.getElementById('recAgeAuto');
  const typed = document.getElementById('recAgeTypedWrap');
  const err = document.getElementById('recBirthError');
  err.textContent = birth === null ? 'วันเกิดไม่ถูกต้องหรือกรอกไม่ครบ (วัน เดือน ปี พ.ศ.)' : '';
  if (birth) {
    const age = recAgeAt_(birth, document.getElementById('recDate').value);
    out.textContent = age !== null ? `${age} ปี` : '-';
    out.classList.remove('hidden'); typed.classList.add('hidden');
  } else {
    out.classList.add('hidden'); typed.classList.remove('hidden');
  }
}

/* ---------------- เปิดแบบฟอร์ม ---------------- */

function recStatusLabel_(status) {
  return status === 'final' ? '<span class="badge attended-tag">บันทึกแล้ว</span>' : '<span class="badge special-tag">ฉบับร่าง</span>';
}

/**
 * เปิดแบบฟอร์ม — opts: { ptn, id } แก้ไขชุดเดิม หรือ { ptn, date } เปิด session ใหม่ (ยังไม่บันทึกจนกว่าจะกดปุ่ม)
 */
async function openRecordForm_(opts) {
  if (!recordLeaveGuard_('record')) return;
  REC.dirty = false;
  showView_('record');
  const body = recBody_();
  body.innerHTML = '<p class="panel-hint">กำลังเปิดเวชระเบียน...</p>';
  const calls = [api('getRecordSetup', {})];
  calls.push(opts.id ? api('getRecord', { id: opts.id }) : api('getPatientRecords', { ptn: opts.ptn }));
  const [su, rr] = await Promise.all(calls);
  const fail = !su.ok ? su.error : (!rr.ok ? rr.error : '');
  if (fail) {
    body.innerHTML = `<p class="error-text">เปิดเวชระเบียนไม่สำเร็จ: ${esc_(fail)}</p><button type="button" class="secondary" id="recBackBtn">กลับ</button>`;
    document.getElementById('recBackBtn').addEventListener('click', () => showView_('patients'));
    return;
  }
  REC.setup = su.data;
  REC.patient = rr.data.patient;
  const today = rr.data.today || todayYmd_();
  let data = {};
  if (opts.id) {
    const r = rr.data.record;
    REC.meta = { id: r.id, session: r.session, status: r.status, date: r.date, createdBy: r.createdBy, updatedBy: r.updatedBy, updatedAt: r.updatedAt };
    data = r.data || {};
  } else {
    const nextSession = (rr.data.records || []).reduce((m, r) => Math.max(m, r.session || 0), 0) + 1;
    const date = opts.date && opts.date <= today ? opts.date : today;
    REC.meta = { id: '', session: nextSession, status: 'new', date: date };
    const now = new Date();
    data = { p2_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` };
  }
  if (!REC.patient) { body.innerHTML = '<p class="error-text">ไม่พบข้อมูลคนไข้ของเวชระเบียนนี้ในทะเบียน</p>'; return; }
  recRender_(data, today);
}

function recRender_(data, today) {
  const p = REC.patient, m = REC.meta;
  const b = /^\d{4}-\d{2}-\d{2}$/.test(p.birthDate || '') ? p.birthDate : '';
  const body = recBody_();
  body.innerHTML = `
    <div class="rec-head">
      <div class="rec-head-top">
        <button type="button" class="secondary rec-mini" id="recBackBtn">‹ กลับหน้าคนไข้</button>
        <h2>เวชระเบียน · ประเมินครั้งแรก</h2>
        <span id="recStatus">${m.id ? recStatusLabel_(m.status) : '<span class="badge busy">ยังไม่ได้บันทึก</span>'}</span>
      </div>
      <div class="rec-head-info">
        <span class="kv">PTN <b>${esc_(p.ptn)}</b></span>
        <span class="kv">ชื่อ <b>${esc_(p.firstName)} ${esc_(p.lastName)}</b></span>
        <span class="kv">Session <b>ที่ ${esc_(m.session)}</b></span>
        ${m.updatedBy || m.createdBy ? `<span class="kv">บันทึกล่าสุดโดย <b>${esc_(m.updatedBy || m.createdBy)}</b></span>` : ''}
      </div>
      <div class="rec-head-form">
        <label>วันที่ประเมิน<input type="date" id="recDate" value="${recAttr_(m.date)}" max="${recAttr_(today)}"></label>
        <label>เพศ<select id="recSex"><option value="">ไม่ระบุ</option><option value="M">ชาย</option><option value="F">หญิง</option></select></label>
        <label>วันเกิด (วัน / เดือน / ปี พ.ศ.)
          <span class="rec-birth">
            <input type="number" id="recBirthDay" min="1" max="31" placeholder="วัน" inputmode="numeric" aria-label="วันเกิด: วันที่" value="${b ? Number(b.slice(8, 10)) : ''}">
            <select id="recBirthMonth" aria-label="วันเกิด: เดือน"><option value="">เดือน</option>${REC_MONTHS.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('')}</select>
            <input type="number" id="recBirthYear" min="2400" max="2700" placeholder="ปี พ.ศ." inputmode="numeric" aria-label="วันเกิด: ปี พ.ศ." value="${b ? Number(b.slice(0, 4)) + 543 : ''}">
          </span>
        </label>
        <label>อายุ
          <span class="rec-age"><b id="recAgeAuto" class="hidden"></b>
            <span id="recAgeTypedWrap"><input type="number" id="recAgeTyped" data-k="p1_age" min="0" max="129" placeholder="ปี" inputmode="numeric" aria-label="อายุ (ปี)"></span></span>
        </label>
      </div>
      <p class="error-text" id="recBirthError"></p>
    </div>
    <nav class="rec-steps" aria-label="ไปยังชุด">
      ${['Personal Data', 'Physical Examination', 'Problem list', 'Plan & Goal', 'Intervention'].map((s, i) => `<button type="button" data-part="${i + 1}"><span class="n">${i + 1}</span>${s}</button>`).join('')}
    </nav>
    ${recPart1_()}${recPart2_()}${recPart3_()}${recPart4_()}${recPart5_()}
    <div class="rec-foot">
      <span class="tx" id="recDirty"></span>
      <p class="error-text" id="recError"></p>
      <span class="rec-foot-btns">
        ${m.status !== 'final' ? '<button type="button" class="secondary" id="recSaveDraftBtn">บันทึกร่าง</button>' : ''}
        <button type="button" class="primary" id="recSaveFinalBtn">${m.status === 'final' ? 'บันทึกการแก้ไข' : 'บันทึกเวชระเบียน'}</button>
      </span>
    </div>`;
  document.getElementById('recSex').value = p.sex === 'M' || p.sex === 'F' ? p.sex : '';
  if (b) document.getElementById('recBirthMonth').value = String(Number(b.slice(5, 7)));
  document.getElementById('recConsentPrint').href = 'consent.html#' + ['name=' + encodeURIComponent(`${p.firstName} ${p.lastName}`), 'ptn=' + encodeURIComponent(p.ptn), 'date=' + encodeURIComponent(m.date)].join('&');
  recFill_(data);
  recPickInit_();
  recApplyShow_();
  recScores_();
  recUpdateAge_();
  // ข้อความ Decrease performance ที่บันทึกไว้: ถ้าตรงกับที่ระบบคำนวณได้ตอนนี้ ถือว่ายังเป็นของระบบ (อัปเดตตามผลทดสอบต่อได้)
  REC.autoDec = '';
  const saved = (data.p3_decPerf_detail || '').trim();
  const nowText = recEvaluateTests_();
  REC.autoDec = saved === nowText.trim() ? nowText : (saved ? '\u0000' : '');
  recWire_();
  recSetDirty_(false);
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
  window.scrollTo(0, 0);
}

function recSetDirty_(dirty) {
  REC.dirty = dirty;
  const el = document.getElementById('recDirty');
  if (el) el.textContent = dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : (REC.meta && REC.meta.id ? 'บันทึกแล้ว' : 'ยังไม่ได้บันทึก');
}

function recWire_() {
  const body = recBody_();
  document.getElementById('recBackBtn').addEventListener('click', () => recBackToPatient_());
  body.querySelectorAll('.rec-steps button').forEach(btn => btn.addEventListener('click', () => {
    document.getElementById('recPart' + btn.dataset.part).scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));

  // ดรอปดาวน์: เลือก "พิมพ์เอง…" แล้วถามค่า เพิ่มเป็นตัวเลือกให้ทุกช่องที่ใช้รายการเดียวกัน
  body.addEventListener('change', e => {
    const el = e.target;
    if (el.classList.contains('rec-pick-add')) { if (el.value) recPickAdd_(el.closest('.rec-pick'), el.value); return; }
    if (el.tagName === 'SELECT' && el.dataset.list) {
      if (el.value === REC_OTHER) {
        const typed = (window.prompt(`พิมพ์ค่าที่ต้องการ (${el.options[0].textContent})`) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (typed) { recAddOption_(el.dataset.list, typed, true); el.value = typed; }
        else el.value = el.dataset.prev || '';
      }
      el.dataset.prev = el.value;
    }
    // ตัวเลือกแบบเลือกได้อย่างเดียว: ติ๊กอันหนึ่ง อีกอันหลุด
    if (el.dataset && el.dataset.pair && el.checked) {
      body.querySelectorAll(`[data-pair="${el.dataset.pair}"]`).forEach(o => { if (o !== el) o.checked = false; });
    }
    recApplyShow_();
    recSetDirty_(true);
    document.getElementById('recError').textContent = '';
    if (el.id === 'recSex' || el.id === 'recBirthMonth' || el.id === 'recDate') { recUpdateAge_(); recSyncDecPerf_(false); }
  });
  body.addEventListener('input', e => {
    const el = e.target;
    recSetDirty_(true);
    recGrow_(el);
    document.getElementById('recError').textContent = '';
    if (el.id === 'recBirthDay' || el.id === 'recBirthYear' || el.id === 'recAgeTyped') { recUpdateAge_(); recSyncDecPerf_(false); }
    else if (el.dataset && /^pt_/.test(el.dataset.k || '') && !/_label$/.test(el.dataset.k)) recSyncDecPerf_(false);
  });
  body.querySelectorAll('[data-nrs]').forEach(g => g.addEventListener('click', e => {
    const btn = e.target.closest('button[data-v]');
    if (!btn) return;
    const was = btn.classList.contains('on');
    g.querySelectorAll('button').forEach(b => b.classList.remove('on'));
    if (!was) btn.classList.add('on'); // กดซ้ำที่เลขเดิม = ล้างค่า
    recSetDirty_(true);
    document.getElementById('recError').textContent = '';
    if (g.classList.contains('rec-opts')) { recScores_(); recSyncDecPerf_(false); }
  }));
  body.addEventListener('click', e => {
    const x = e.target.closest('.rec-pick-x');
    if (x) recPickRemove_(x.closest('.rec-pick-item'));
  });
  recSpy_();
  document.getElementById('recDecRefill').addEventListener('click', () => { recSyncDecPerf_(true); recSetDirty_(true); });
  document.getElementById('recSaveDraftBtn')?.addEventListener('click', () => recSave_('draft'));
  document.getElementById('recSaveFinalBtn').addEventListener('click', () => recSave_('final'));
}

/** แถบชุด 1-5: เน้นสีชุดที่กำลังอยู่บนจอ */
function recSpy_() {
  const body = recBody_();
  const steps = body && body.querySelector('.rec-steps');
  if (!steps) return;
  const bar = steps.getBoundingClientRect().bottom + 12;
  let current = 1;
  for (let i = 1; i <= 5; i++) {
    const card = document.getElementById('recPart' + i);
    if (card && card.getBoundingClientRect().top <= bar) current = i;
  }
  // แบบฟอร์มสั้น ชุดท้าย ๆ เลื่อนขึ้นไม่ถึงขอบบน: เลื่อนสุดหน้าแล้วถือว่าอยู่ชุดสุดท้าย
  const el = document.scrollingElement || document.documentElement;
  const content = document.querySelector('.content');
  const atBottom = (el.scrollTop > 0 && el.scrollTop + window.innerHeight >= el.scrollHeight - 4) ||
    (content && content.scrollTop > 0 && content.scrollTop + content.clientHeight >= content.scrollHeight - 4);
  if (atBottom) current = 5;
  steps.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.part) === current));
}
let _recSpyQueued_ = false;
function recSpySoon_() {
  if (_recSpyQueued_) return;
  _recSpyQueued_ = true;
  requestAnimationFrame(() => { _recSpyQueued_ = false; if (!document.getElementById('recordView').classList.contains('hidden')) recSpy_(); });
}
window.addEventListener('scroll', recSpySoon_, { passive: true });
document.querySelector('.content')?.addEventListener('scroll', recSpySoon_, { passive: true });

/* ---------------- ซ่อนไว้จนกว่าจะใช้ ---------------- */

/** ค่าปัจจุบันของช่อง (ช่องติ๊ก = 'Y' หรือ '') */
function recValueOf_(key) {
  const body = recBody_();
  const pair = body.querySelector(`[data-pair="${key}"]:checked`);
  if (pair) return pair.value;
  const el = body.querySelector(`[data-k="${key}"]`);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked ? 'Y' : '';
  return el.value === REC_OTHER ? '' : (el.value || '').trim();
}
/** แสดง/ซ่อนส่วนย่อยตามเงื่อนไขใน data-show */
function recApplyShow_() {
  recBody_().querySelectorAll('[data-show]').forEach(el => {
    const m = /^([A-Za-z0-9_]+)(!=|=)?(.*)$/.exec(el.dataset.show);
    const v = recValueOf_(m[1]);
    const show = !m[2] ? v !== '' : (m[2] === '=' ? v === m[3] : (v !== '' && v !== m[3]));
    el.classList.toggle('hidden', !show);
  });
}

function recItemHasData_(item) {
  return Array.from(item.querySelectorAll('[data-k]')).some(el => el.type === 'checkbox' ? el.checked : (el.value || '').trim() !== '') ||
    !!item.querySelector('[data-nrs] button.on') || !!item.querySelector('[data-pair]:checked');
}
/** ดรอปดาวน์ของรายการให้เลือก: เหลือเฉพาะรายการที่ยังไม่ได้เลือก (จัดกลุ่มตามโหมดใหญ่) */
function recPickRefresh_(pick) {
  const sel = pick.querySelector('.rec-pick-add');
  const hidden = Array.from(pick.querySelectorAll('.rec-pick-item.hidden'));
  const groups = [];
  hidden.forEach(it => { if (groups.indexOf(it.dataset.group) === -1) groups.push(it.dataset.group); });
  const opt = it => `<option value="${recAttr_(it.dataset.item)}">${esc_(it.dataset.label)}</option>`;
  sel.innerHTML = `<option value="">＋ ${esc_(pick.dataset.ph)}</option>` + groups.map(g => {
    const inner = hidden.filter(it => it.dataset.group === g).map(opt).join('');
    return g ? `<optgroup label="${recAttr_(g)}">${inner}</optgroup>` : inner;
  }).join('');
  sel.value = '';
  pick.querySelector('.rec-pick-bar').classList.toggle('hidden', hidden.length === 0);
}
/** ตอนเปิดแบบฟอร์ม: รายการที่มีข้อมูลบันทึกไว้แสดงเลย ที่เหลือซ่อนอยู่ในดรอปดาวน์ */
function recPickInit_() {
  recBody_().querySelectorAll('.rec-pick').forEach(pick => {
    pick.querySelectorAll('.rec-pick-item').forEach(item => {
      const has = recItemHasData_(item);
      item.classList.toggle('hidden', !has);
      if (has && item.dataset.leadk) item.querySelector(`[data-k="${item.dataset.leadk}"]`).checked = true;
    });
    recPickRefresh_(pick);
  });
}
function recPickAdd_(pick, id) {
  const item = Array.from(pick.querySelectorAll('.rec-pick-item')).find(it => it.dataset.item === id);
  if (!item) return;
  item.classList.remove('hidden');
  if (item.dataset.leadk) item.querySelector(`[data-k="${item.dataset.leadk}"]`).checked = true;
  if (item.dataset.exs) {
    // เพิ่มแถวการออกกำลังกาย: เติมค่าตั้งต้น ครั้ง/sets/วัน (ตัวเลือกแรกของแต่ละรายการ)
    [['_reps', 'reps'], ['_sets', 'setsPerDay'], ['_days', 'daysPerWeek']].forEach(x => {
      const sel = item.querySelector(`[data-k="${item.dataset.leadk}${x[0]}"]`);
      const first = (REC.setup.options[x[1]] || [])[0];
      if (sel && !sel.value && first) { sel.value = first; sel.dataset.prev = first; }
    });
  }
  const details = item.querySelector('details');
  if (details) details.open = true;
  recPickRefresh_(pick);
  recApplyShow_();
  recScores_();
  recSetDirty_(true);
  const first = item.querySelector('input:not([type=checkbox]):not([type=hidden]), select, textarea, .rec-opts button');
  if (first) first.focus();
}
/** เอารายการออก: ล้างค่าที่กรอกในรายการนั้นทั้งหมดแล้วซ่อนกลับเข้าดรอปดาวน์ */
function recPickRemove_(item) {
  if (!item) return;
  item.querySelectorAll('[data-k]').forEach(el => {
    if (el.type === 'checkbox') el.checked = false; else { el.value = ''; delete el.dataset.auto; if (el.tagName === 'SELECT') el.dataset.prev = ''; }
  });
  item.querySelectorAll('[data-pair]').forEach(el => { el.checked = false; });
  item.querySelectorAll('[data-nrs] button.on').forEach(b => b.classList.remove('on'));
  item.classList.add('hidden');
  const pick = item.closest('.rec-pick');
  recPickRefresh_(pick);
  recScores_();
  recSyncDecPerf_(false);
  recSetDirty_(true);
  pick.querySelector('.rec-pick-add').focus();
}

/* ---------------- บันทึก ---------------- */

async function recSave_(status) {
  if (REC.saving) return;
  const errEl = document.getElementById('recError');
  errEl.textContent = '';
  const birth = recBirthDate_();
  if (birth === null) { errEl.textContent = 'วันเกิดไม่ถูกต้องหรือกรอกไม่ครบ — แก้ไขหรือลบออกก่อนบันทึก'; document.getElementById('recBirthDay').focus(); return; }
  const date = document.getElementById('recDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errEl.textContent = 'เลือกวันที่ประเมินก่อนบันทึก'; return; }
  const data = recCollect_();
  if (birth) delete data.p1_age; // มีวันเกิดแล้ว ไม่ต้องเก็บอายุที่พิมพ์เอง (คำนวณได้เสมอ)
  if (data.pt_eq5d_vas !== undefined && !(Number(data.pt_eq5d_vas) >= 0 && Number(data.pt_eq5d_vas) <= 100)) {
    errEl.textContent = 'EQ-5D-5L: สุขภาพวันนี้ (VAS) ต้องเป็นเลข 0-100';
    document.getElementById('recEq5d').open = true;
    recBody_().querySelector('[data-k="pt_eq5d_vas"]').focus();
    return;
  }
  if (status === 'final' && !data.p1_consent) {
    errEl.textContent = 'บันทึกการยินยอมของคนไข้ก่อนบันทึกเวชระเบียน (หรือกด บันทึกร่าง ไว้ก่อน)';
    document.getElementById('recConsentRow').scrollIntoView({ block: 'center' });
    recBody_().querySelector('[data-pair="p1_consent"]').focus();
    return;
  }
  if (status === 'final' && !data.p1_cc) {
    errEl.textContent = 'กรอก Chief complaint ก่อนบันทึกเวชระเบียน (หรือกด บันทึกร่าง ไว้ก่อน)';
    recBody_().querySelector('[data-k="p1_cc"]').focus();
    return;
  }
  REC.saving = true;
  const btns = recBody_().querySelectorAll('.rec-foot button');
  btns.forEach(b => { b.disabled = true; });
  const res = await api('saveRecord', { id: REC.meta.id || undefined, ptn: REC.patient.ptn, date: date, status: status, data: data,
    patient: { sex: recSex_(), birthDate: birth }, learn: recLearn_() });
  REC.saving = false;
  btns.forEach(b => { b.disabled = false; });
  if (!res.ok) { errEl.textContent = 'บันทึกไม่สำเร็จ: ' + res.error; return; }
  REC.meta.id = res.data.id;
  REC.meta.session = res.data.session;
  REC.meta.status = res.data.status;
  REC.patient.sex = recSex_(); REC.patient.birthDate = birth;
  recBody_().querySelectorAll('option[data-is-new]').forEach(o => { delete o.dataset.isNew; });
  recSetDirty_(false);
  if (res.data.status === 'final') {
    toast('บันทึกเวชระเบียนแล้ว');
    recBackToPatient_();
  } else {
    toast('บันทึกร่างแล้ว');
    document.getElementById('recStatus').innerHTML = recStatusLabel_('draft');
  }
}

/** กลับหน้าคนไข้ของเวชระเบียนที่เปิดอยู่ */
function recBackToPatient_() {
  if (!recordLeaveGuard_('patients')) return;
  REC.dirty = false;
  const p = REC.patient;
  showView_('patients');
  if (p) loadPatientProfile_(p);
}

/** ถามก่อนออกจากแบบฟอร์มเมื่อมีการแก้ไขที่ยังไม่ได้บันทึก — คืน false = ผู้ใช้ขออยู่ต่อ (app.js เรียกก่อนเปลี่ยนหน้า) */
function recordLeaveGuard_(nextView) {
  const open = !document.getElementById('recordView').classList.contains('hidden');
  if (!open || !REC.dirty) return true;
  if (window.confirm('มีการแก้ไขเวชระเบียนที่ยังไม่ได้บันทึก ออกจากหน้านี้โดยไม่บันทึกหรือไม่')) { REC.dirty = false; return true; }
  return false;
}
window.addEventListener('beforeunload', e => {
  if (REC.dirty && !document.getElementById('recordView').classList.contains('hidden')) { e.preventDefault(); e.returnValue = ''; }
});
/** ออกจากระบบ: ไม่ทิ้งข้อมูลเวชระเบียนค้างบนจอ */
function recordReset_() {
  REC.dirty = false; REC.patient = null; REC.meta = null; REC.setup = null; REC.autoDec = '';
  const body = recBody_();
  if (body) body.innerHTML = '';
  _recRecentReq_++;
  const recent = document.getElementById('recordsRecent');
  if (recent) recent.innerHTML = '';
  const search = document.getElementById('recordSearchInput');
  if (search) search.value = '';
}

/* ---------------- รายการเวชระเบียนในหน้าคนไข้ ---------------- */

let _recListReq_ = 0;
async function loadPatientRecords_(ptn) {
  const box = document.getElementById('patientRecords');
  if (!box) return;
  const req = ++_recListReq_;
  box.innerHTML = '<h3>เวชระเบียน</h3><p class="dash-sub">กำลังโหลด...</p>';
  const res = await api('getPatientRecords', { ptn: ptn });
  if (req !== _recListReq_ || !document.body.contains(box)) return;
  if (!res.ok) { box.innerHTML = `<h3>เวชระเบียน</h3><p class="error-text">โหลดเวชระเบียนไม่สำเร็จ: ${esc_(res.error)}</p>`; return; }
  const recs = res.data.records || [];
  const rows = recs.map(r => `
    <tr data-id="${recAttr_(r.id)}">
      <td>Session ${esc_(r.session)}</td><td>${esc_(fmtThaiDate_(r.date))}</td><td>${recStatusLabel_(r.status)}</td>
      <td>${esc_(r.chiefComplaint || '-')}</td><td>${esc_([r.medicalDx, r.ptDx].filter(Boolean).join(' · ') || '-')}</td>
      <td class="rec-actions"><button type="button" class="secondary rec-mini" data-open="${recAttr_(r.id)}">เปิด</button>${r.status !== 'final' ? `<button type="button" class="secondary rec-mini rec-del" data-del="${recAttr_(r.id)}">ลบร่าง</button>` : ''}</td>
    </tr>`).join('');
  box.innerHTML = `
    <h3>เวชระเบียน <button type="button" class="secondary rec-mini" id="recNewBtn">+ เปิด session ใหม่ (ประเมินครั้งแรก)</button></h3>
    <p class="dash-sub">คนไข้ 1 คนใช้ PTN เดิม มาด้วยอาการใหม่ให้เปิด session ใหม่</p>
    ${rows ? `<div class="table-scroll"><table class="mini-table rec-table">
      <thead><tr><th>Session</th><th>วันที่ประเมิน</th><th>สถานะ</th><th>Chief complaint</th><th>Diagnosis</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<div class="dash-empty">ยังไม่มีเวชระเบียน</div>'}`;
  document.getElementById('recNewBtn').addEventListener('click', () => {
    const drafts = recs.filter(r => r.status !== 'final').length;
    if (drafts && !window.confirm('คนไข้คนนี้มีฉบับร่างค้างอยู่ จะเปิด session ใหม่อีกชุดหรือไม่ (ถ้าจะกรอกต่อ ให้กด เปิด ที่ฉบับร่างเดิม)')) return;
    openRecordForm_({ ptn: ptn });
  });
  box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openRecordForm_({ ptn: ptn, id: b.dataset.open })));
  box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!window.confirm('ลบฉบับร่างนี้ใช่ไหม ลบแล้วกู้คืนไม่ได้')) return;
    b.disabled = true;
    const del = await api('deleteRecord', { id: b.dataset.del });
    if (!del.ok) { toast('ลบไม่สำเร็จ: ' + del.error); b.disabled = false; return; }
    toast('ลบฉบับร่างแล้ว');
    loadPatientRecords_(ptn);
  }));
}

/** ไปหน้าคนไข้ของคนที่เลือก แล้วเลื่อนมาที่กล่องเวชระเบียน */
async function recOpenPatient_(p) {
  const box = document.getElementById('recordSearchResults');
  if (box) { box.innerHTML = ''; box.classList.add('hidden'); }
  showView_('patients');
  await loadPatientProfile_(p);
  document.getElementById('patientRecords')?.scrollIntoView({ block: 'start' });
}

/* ---------------- เมนูเวชระเบียน: ค้นหาคนไข้ + รายการที่บันทึกล่าสุด ---------------- */

document.getElementById('recordSearchInput')?.addEventListener('input', e => {
  const matches = findPatientMatches_(e.target.value, '', 12);
  renderPatientSuggest_(matches, { boxId: 'recordSearchResults', head: 'กดเลือกเพื่อเปิดเวชระเบียน', onPick: recOpenPatient_ });
  const hint = document.getElementById('recordSearchHint');
  if (hint) {
    const q = e.target.value.trim();
    hint.textContent = !state.patientsLoaded ? 'กำลังโหลดทะเบียนคนไข้...' : (q.length >= 2 && !matches.length ? 'ไม่พบคนไข้ที่ตรงกับคำค้น (คนไข้ใหม่ให้ลงนัดก่อน ระบบจึงจะออก PTN)' : '');
  }
});

let _recRecentReq_ = 0;
async function loadRecentRecords_() {
  const box = document.getElementById('recordsRecent');
  if (!box) return;
  const req = ++_recRecentReq_;
  if (!box.innerHTML) box.innerHTML = '<p class="panel-hint" style="margin-top:16px;">กำลังโหลด...</p>';
  const res = await api('getRecentRecords', {});
  if (req !== _recRecentReq_) return;
  if (!res.ok) { box.innerHTML = `<p class="error-text" style="margin-top:16px;">โหลดรายการเวชระเบียนไม่สำเร็จ: ${esc_(res.error)}</p>`; return; }
  const recs = res.data.records || [];
  const rows = recs.map((r, i) => `
    <tr>
      <td>${esc_(fmtThaiDate_(r.date))}</td>
      <td><button type="button" class="rec-link" data-patient="${i}">${esc_((r.firstName + ' ' + r.lastName).trim() || r.ptn)}</button><small class="rec-ptn">${esc_(r.ptn)}</small></td>
      <td>Session ${esc_(r.session)}</td><td>${recStatusLabel_(r.status)}</td><td>${esc_(r.chiefComplaint || '-')}</td>
      <td class="rec-actions"><button type="button" class="secondary rec-mini" data-open="${i}">เปิด</button></td>
    </tr>`).join('');
  box.innerHTML = `
    <div class="dash-panel" style="margin-top:16px;">
      <h3>บันทึกล่าสุด</h3>
      <p class="dash-sub">${res.data.total ? `ทั้งหมด ${res.data.total} ชุด${res.data.drafts ? ` · ฉบับร่างค้างอยู่ ${res.data.drafts} ชุด` : ''}${res.data.total > recs.length ? ` · แสดง ${recs.length} ชุดล่าสุด` : ''}` : 'เปิดเวชระเบียนใหม่ได้โดยค้นหาคนไข้ด้านบน หรือกดปุ่มเวชระเบียนในรายละเอียดนัด'}</p>
      ${rows ? `<div class="table-scroll"><table class="mini-table rec-table">
        <thead><tr><th>วันที่ประเมิน</th><th>คนไข้</th><th>Session</th><th>สถานะ</th><th>Chief complaint</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<div class="dash-empty">ยังไม่มีเวชระเบียน</div>'}
    </div>`;
  box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { const r = recs[Number(b.dataset.open)]; openRecordForm_({ ptn: r.ptn, id: r.id }); }));
  box.querySelectorAll('[data-patient]').forEach(b => b.addEventListener('click', () => { const r = recs[Number(b.dataset.patient)]; recOpenPatient_({ ptn: r.ptn, firstName: r.firstName, lastName: r.lastName }); }));
}

/**
 * ปุ่ม "เวชระเบียน" ในรายละเอียดนัด: คนไข้ที่ยังไม่มีเวชระเบียนเปิดแบบฟอร์มใหม่เลย (วันที่ = วันนัด)
 * ถ้ามีแล้วไปหน้าคนไข้ให้เลือกเปิดชุดเดิมหรือเปิด session ใหม่
 */
async function openRecordsFromAppt_(appt, date) {
  if (!appt || !appt.ptn) { toast('นัดนี้ยังไม่มี PTN'); return; }
  const res = await api('getPatientRecords', { ptn: appt.ptn });
  if (!res.ok) { toast('เปิดเวชระเบียนไม่สำเร็จ: ' + res.error); return; }
  if (!(res.data.records || []).length) { openRecordForm_({ ptn: appt.ptn, date: date }); return; }
  showView_('patients');
  await loadPatientProfile_(res.data.patient);
  document.getElementById('patientRecords')?.scrollIntoView({ block: 'start' });
}
