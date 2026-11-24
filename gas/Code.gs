/**
 * 彰基教學部深耕計畫｜課程現場簽到・簽退・滿意度（Google Apps Script 後端）
 * ------------------------------------------------------------------
 * 放在一份「不公開」的 Google 試算表裡（擴充功能 → Apps Script）。
 * 網站的 /checkin/、/checkout/、/feedback/、/attend/admin.html 會呼叫這裡。
 *
 * 每次辦活動：只要到「活動設定」分頁，把該場的「啟用」勾起來（其他場取消），
 * 三個縮網址不用改。
 *
 * 管理頁密碼：專案設定（齒輪）→ 指令碼屬性 → 新增 ADMIN_KEY。
 * 修改本程式後：部署 → 管理部署作業 → 編輯（鉛筆）→ 版本「新版本」→ 部署（網址不變）。
 */

var TZ = 'Asia/Taipei';
var FEEDBACK_DAYS = 7;            // 課程結束後幾天內仍可填問卷
var DEFAULT_ORGS = ['彰化基督教醫院', '部立南投醫院', '南投基督教醫院', '埔里基督教醫院', '其他'];
var DEFAULT_TITLES = ['醫師', '護理', '藥事', '醫事放射', '醫事檢驗', '物理治療', '職能治療', '呼吸治療',
  '營養', '臨床心理', '語言治療', '聽力', '牙醫', '中醫', '社工', '行政', '其他'];

var SH = { EVENT: '活動設定', Q: '問卷題目', ATT: '簽到紀錄', FB: '滿意度' };
var EVENT_HEAD = ['啟用', '活動代號', '課程名稱', '日期', '開始', '結束', '地點', '講師',
  '簽到開放', '簽到截止', '簽退開放', '簽退截止', '報名表連結', '現場代碼', '機構選項', '測試模式', '備註'];
var Q_HEAD = ['啟用', '題號', '題目', '類型', '選項', '必填', '適用活動'];
var ATT_HEAD = ['活動代號', '課程名稱', '姓名', '服務機構', '職類', '單位科別', '員工編號',
  '簽到時間', '簽退時間', '問卷完成', '裝置'];

/* ========================= 入口 ========================= */
function doPost(e) {
  var p = (e && e.parameter) || {};
  try {
    switch (p.action) {
      case 'event': return json_(eventInfo_());
      case 'checkin': return json_(checkin_(p));
      case 'checkout': return json_(checkout_(p));
      case 'feedback': return json_(feedback_(p));
      case 'admin': return json_(admin_(p));
      default: return json_({ ok: false, error: '未知的動作' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: '系統忙碌中，請稍後再試' });
  }
}

// 用瀏覽器直接開部署網址時，確認服務正常
function doGet() {
  return json_({ ok: true, service: 'CCH shengeng attendance' });
}

/* ========================= 活動 ========================= */
function activeEvent_() {
  var rows = table_(SH.EVENT);
  var on = rows.filter(function (r) { return yes_(r['啟用']); });
  if (!on.length) return null;
  var today = fmtDate_(new Date());
  // 同時啟用多場：優先今天，其次最接近今天的
  on.sort(function (a, b) {
    var da = dateStr_(a['日期']), db = dateStr_(b['日期']);
    if (da === today) return -1;
    if (db === today) return 1;
    return Math.abs(dayDiff_(da, today)) - Math.abs(dayDiff_(db, today));
  });
  return normEvent_(on[0]);
}

function normEvent_(r) {
  var ev = {
    id: str_(r['活動代號']) || (dateStr_(r['日期']) + ' ' + str_(r['課程名稱'])),
    title: str_(r['課程名稱']),
    date: dateStr_(r['日期']),
    start: hm_(r['開始']), end: hm_(r['結束']),
    place: str_(r['地點']), speaker: str_(r['講師']),
    regUrl: str_(r['報名表連結']),
    code: str_(r['現場代碼']),
    test: yes_(r['測試模式']),
    note: str_(r['備註']),
    orgs: str_(r['機構選項']) ? str_(r['機構選項']).split(/[,，、\n]/).map(trim_).filter(String) : DEFAULT_ORGS,
    titles: DEFAULT_TITLES
  };
  var s = mins_(ev.start), en = mins_(ev.end);
  ev.win = {
    checkin: [mins_(hm_(r['簽到開放'])), mins_(hm_(r['簽到截止']))],
    checkout: [mins_(hm_(r['簽退開放'])), mins_(hm_(r['簽退截止']))]
  };
  if (ev.win.checkin[0] === null && s !== null) ev.win.checkin[0] = s - 60;
  if (ev.win.checkin[1] === null) ev.win.checkin[1] = en !== null ? en : 24 * 60 - 1;
  if (ev.win.checkout[0] === null) ev.win.checkout[0] = en !== null ? en - 30 : (s !== null ? s : 0);
  if (ev.win.checkout[1] === null) ev.win.checkout[1] = en !== null ? Math.min(en + 120, 24 * 60 - 1) : 24 * 60 - 1;
  return ev;
}

/** 檢查現在是否在開放時間內。回傳 null 表示可以，否則回傳原因。 */
function windowError_(ev, kind) {
  if (ev.test || !ev.date) return null;
  var now = new Date(), today = fmtDate_(now), m = now2mins_(now);
  if (kind === 'feedback') {
    var d = dayDiff_(ev.date, today);
    if (d < 0 || (d === 0 && ev.win.checkin[0] !== null && m < ev.win.checkin[0])) return '課程尚未開始，還不能填寫問卷';
    if (d > FEEDBACK_DAYS) return '問卷已截止（課程結束後 ' + FEEDBACK_DAYS + ' 天內可填寫）';
    return null;
  }
  var w = ev.win[kind], label = kind === 'checkin' ? '簽到' : '簽退';
  if (today !== ev.date) return dayDiff_(ev.date, today) < 0 ? '本課程於 ' + ev.date + ' 舉行，當天才開放' + label : label + '已截止';
  if (w[0] !== null && m < w[0]) return label + '尚未開放，' + m2hm_(w[0]) + ' 起可' + label;
  if (w[1] !== null && m > w[1]) return label + '已截止（' + m2hm_(w[1]) + '）';
  return null;
}

function codeError_(ev, p) {
  if (!ev.code) return null;
  return norm_(p.code) === norm_(ev.code) ? null : '現場代碼不正確';
}

function publicEvent_(ev) {
  return {
    id: ev.id, title: ev.title, date: ev.date, start: ev.start, end: ev.end, place: ev.place,
    speaker: ev.speaker, regUrl: ev.regUrl, note: ev.note, needCode: !!ev.code, test: ev.test,
    orgs: ev.orgs, titles: ev.titles,
    windows: {
      checkin: [m2hm_(ev.win.checkin[0]), m2hm_(ev.win.checkin[1])],
      checkout: [m2hm_(ev.win.checkout[0]), m2hm_(ev.win.checkout[1])]
    },
    open: { checkin: !windowError_(ev, 'checkin'), checkout: !windowError_(ev, 'checkout'), feedback: !windowError_(ev, 'feedback') },
    msg: { checkin: windowError_(ev, 'checkin'), checkout: windowError_(ev, 'checkout'), feedback: windowError_(ev, 'feedback') }
  };
}

function eventInfo_() {
  var ev = activeEvent_();
  if (!ev) return { ok: false, error: '目前沒有開放中的活動' };
  return { ok: true, event: publicEvent_(ev), questions: questions_(ev.id) };
}

function questions_(eventId) {
  return table_(SH.Q).filter(function (q) {
    if (!yes_(q['啟用']) || !str_(q['題目'])) return false;
    var scope = str_(q['適用活動']);
    return !scope || scope.split(/[,，、]/).map(trim_).indexOf(eventId) >= 0;
  }).sort(function (a, b) { return (Number(a['題號']) || 0) - (Number(b['題號']) || 0); })
    .map(function (q) {
      return {
        id: 'q' + (str_(q['題號']) || str_(q['題目'])), text: str_(q['題目']),
        type: str_(q['類型']) || '量表',
        options: str_(q['選項']) ? str_(q['選項']).split(/[,，、\n]/).map(trim_).filter(String) : [],
        required: q['必填'] === '' || q['必填'] === undefined ? true : yes_(q['必填'])
      };
    });
}

/* ========================= 簽到 ========================= */
function checkin_(p) {
  var ev = activeEvent_();
  if (!ev) return { ok: false, error: '目前沒有開放中的活動' };
  var f = {
    name: clean_(p.name, 30), org: clean_(p.org, 60), title: clean_(p.title, 30),
    dept: clean_(p.dept, 40), empno: clean_(p.empno, 20)
  };
  if (!f.name) return { ok: false, error: '請填寫姓名' };
  if (!f.org) return { ok: false, error: '請選擇服務機構' };
  if (!f.title) return { ok: false, error: '請選擇職類' };
  var err = codeError_(ev, p) || windowError_(ev, 'checkin');
  if (err) return { ok: false, error: err, needCode: err === '現場代碼不正確' };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var found = findAttendee_(ev.id, f.name, f.org);
    if (found) {
      return { ok: true, already: true, time: timeStr_(found.row['簽到時間']), name: f.name };
    }
    var sh = sheet_(SH.ATT, ATT_HEAD);
    var now = new Date();
    sh.appendRow([ev.id, ev.title, safe_(f.name), safe_(f.org), safe_(f.title), safe_(f.dept), safe_(f.empno),
      now, '', '', clean_(p.ua, 60)]);
    return { ok: true, time: fmtTime_(now), name: f.name };
  } finally {
    lock.releaseLock();
  }
}

/* ========================= 簽退 ========================= */
function checkout_(p) {
  var ev = activeEvent_();
  if (!ev) return { ok: false, error: '目前沒有開放中的活動' };
  var name = clean_(p.name, 30), org = clean_(p.org, 60);
  if (!name || !org) return { ok: false, error: '請填寫姓名與服務機構' };
  var err = codeError_(ev, p) || windowError_(ev, 'checkout');
  if (err) return { ok: false, error: err, needCode: err === '現場代碼不正確' };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var found = findAttendee_(ev.id, name, org);
    if (!found) return { ok: false, error: '查無簽到紀錄。請確認姓名與服務機構和簽到時相同，或洽現場工作人員。' };
    var done = filled_(found.row['問卷完成']);
    if (filled_(found.row['簽退時間'])) {
      return { ok: true, already: true, time: timeStr_(found.row['簽退時間']), feedbackDone: done };
    }
    var now = new Date();
    found.sheet.getRange(found.index, found.col['簽退時間'] + 1).setValue(now);
    return { ok: true, time: fmtTime_(now), feedbackDone: done };
  } finally {
    lock.releaseLock();
  }
}

/* ========================= 滿意度 ========================= */
function feedback_(p) {
  var ev = activeEvent_();
  if (!ev) return { ok: false, error: '目前沒有開放中的活動' };
  var name = clean_(p.name, 30), org = clean_(p.org, 60);
  if (!name || !org) return { ok: false, error: '請填寫姓名與服務機構' };
  var err = windowError_(ev, 'feedback');
  if (err) return { ok: false, error: err };

  var qs = questions_(ev.id), ans = {};
  try { ans = JSON.parse(p.answers || '{}'); } catch (e2) { return { ok: false, error: '問卷資料格式錯誤' }; }
  for (var i = 0; i < qs.length; i++) {
    var q = qs[i], v = ans[q.id];
    if (Object.prototype.toString.call(v) === '[object Array]') v = v.join('、');
    v = clean_(v, 1000);
    if (q.type === '量表' && v && !/^[1-5]$/.test(v)) return { ok: false, error: '第 ' + (i + 1) + ' 題請選 1～5 分' };
    if (q.required && !v) return { ok: false, error: '請回答第 ' + (i + 1) + ' 題：' + q.text };
    ans[q.id] = v;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var found = findAttendee_(ev.id, name, org);
    if (!found) return { ok: false, error: '查無簽到紀錄。請確認姓名與服務機構和簽到時相同。' };
    if (filled_(found.row['問卷完成'])) return { ok: true, already: true };

    // 欄位依題目文字對應；遇到新題目就在最右邊加一欄
    var head = ['填寫時間', '活動代號', '課程名稱', '姓名', '服務機構', '職類'].concat(qs.map(function (q) { return q.text; }));
    var sh = sheet_(SH.FB, head.slice(0, 6));
    var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    qs.forEach(function (q) {
      if (cur.indexOf(q.text) < 0) { cur.push(q.text); sh.getRange(1, cur.length).setValue(q.text); }
    });
    var row = cur.map(function () { return ''; });
    var put = function (k, v) { var c = cur.indexOf(k); if (c >= 0) row[c] = v; };
    var now = new Date();
    put('填寫時間', now); put('活動代號', ev.id); put('課程名稱', ev.title);
    put('姓名', safe_(name)); put('服務機構', safe_(org)); put('職類', safe_(str_(found.row['職類'])));
    qs.forEach(function (q) { put(q.text, q.type === '量表' && ans[q.id] ? Number(ans[q.id]) : safe_(ans[q.id])); });
    sh.appendRow(row);
    found.sheet.getRange(found.index, found.col['問卷完成'] + 1).setValue(now);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ========================= 管理頁 ========================= */
function admin_(p) {
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key) return { ok: false, error: '尚未設定管理密碼（指令碼屬性 ADMIN_KEY）' };
  if (String(p.key || '') !== key) { Utilities.sleep(800); return { ok: false, error: '密碼錯誤', badKey: true }; }

  var events = table_(SH.EVENT).filter(function (r) { return str_(r['課程名稱']); }).map(normEvent_);
  var ev = null;
  if (p.id) ev = events.filter(function (x) { return x.id === p.id; })[0];
  var act = activeEvent_();
  if (!ev) ev = act || events[events.length - 1];
  if (!ev) return { ok: true, events: [], event: null };

  var att = table_(SH.ATT).filter(function (r) { return str_(r['活動代號']) === ev.id; }).map(function (r) {
    return {
      name: str_(r['姓名']), org: str_(r['服務機構']), title: str_(r['職類']), dept: str_(r['單位科別']),
      empno: str_(r['員工編號']), checkin: timeStr_(r['簽到時間']), checkout: timeStr_(r['簽退時間']),
      feedback: filled_(r['問卷完成'])
    };
  });
  var qs = questions_(ev.id);
  var fb = table_(SH.FB).filter(function (r) { return str_(r['活動代號']) === ev.id; });
  var stats = qs.map(function (q) {
    var vals = fb.map(function (r) { return r[q.text]; }).filter(filled_);
    if (q.type === '量表') {
      var nums = vals.map(Number).filter(function (n) { return n >= 1 && n <= 5; });
      var dist = [1, 2, 3, 4, 5].map(function (k) { return nums.filter(function (n) { return n === k; }).length; });
      var avg = nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null;
      return { text: q.text, type: q.type, n: nums.length, avg: avg, dist: dist };
    }
    return { text: q.text, type: q.type, n: vals.length, answers: vals.map(String) };
  });
  return {
    ok: true,
    events: events.map(function (x) { return { id: x.id, title: x.title, date: x.date, active: !!act && act.id === x.id }; }),
    event: publicEvent_(ev), attendees: att, stats: stats
  };
}

/* ========================= 第一次設定 ========================= */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  var ev = sheet_(SH.EVENT, EVENT_HEAD);
  if (ev.getLastRow() < 2) {
    ev.getRange('D2:L200').setNumberFormat('@');   // 日期、時間以文字儲存，避免自動轉格式
    ev.appendRow([true, '20261209-與時俱進', '與時俱進課程（請填入完整課程名稱）', '2026/12/09', '12:20', '14:00',
      '（請填入地點）', '（請填入講師）', '', '', '', '', 'https://forms.cloud.microsoft/r/MtX0F6aNRr', '', '', true,
      '測試完成後，請把「測試模式」取消勾選']);
    ev.getRange('A2:A200').insertCheckboxes();
    ev.getRange('P2:P200').insertCheckboxes();
    ev.getRange('A2').setValue(true);
    ev.getRange('P2').setValue(true);
  }
  var q = sheet_(SH.Q, Q_HEAD);
  if (q.getLastRow() < 2) {
    [
      [true, 1, '課程內容符合我的學習需求', '量表', '', true, ''],
      [true, 2, '講師表達清楚，時間掌控得宜', '量表', '', true, ''],
      [true, 3, '課程內容對我的臨床或教學工作有幫助', '量表', '', true, ''],
      [true, 4, '場地與行政安排妥適', '量表', '', true, ''],
      [true, 5, '整體而言，我對本課程感到滿意', '量表', '', true, ''],
      [true, 6, '本課程讓我收穫最多的地方', '文字', '', false, ''],
      [true, 7, '對本課程或未來課程主題的建議', '文字', '', false, '']
    ].forEach(function (r) { q.appendRow(r); });
    q.getRange('A2:A100').insertCheckboxes();
    q.getRange('F2:F100').insertCheckboxes();
    for (var i = 2; i <= 8; i++) { q.getRange(i, 1).setValue(true); q.getRange(i, 6).setValue(i <= 6); }
  }
  sheet_(SH.ATT, ATT_HEAD);
  sheet_(SH.FB, ['填寫時間', '活動代號', '課程名稱', '姓名', '服務機構', '職類']);
}

/* ========================= 工具 ========================= */
function sheet_(name, head) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function table_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues();
  var head = v[0].map(function (h) { return trim_(h); });
  return v.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = r[i]; });
    return o;
  });
}

function findAttendee_(eventId, name, org) {
  var sh = sheet_(SH.ATT, ATT_HEAD);
  if (sh.getLastRow() < 2) return null;
  var v = sh.getDataRange().getValues();
  var col = {};
  v[0].forEach(function (h, i) { col[trim_(h)] = i; });
  for (var i = v.length - 1; i >= 1; i--) {
    var r = v[i];
    if (str_(r[col['活動代號']]) === eventId && norm_(r[col['姓名']]) === norm_(name) && norm_(r[col['服務機構']]) === norm_(org)) {
      var row = {};
      Object.keys(col).forEach(function (k) { row[k] = r[col[k]]; });
      return { sheet: sh, index: i + 1, col: col, row: row };
    }
  }
  return null;
}

function str_(v) {
  if (v instanceof Date) return fmtDate_(v);
  return trim_(v);
}
function trim_(v) { return String(v === null || v === undefined ? '' : v).replace(/^[\s　]+|[\s　]+$/g, ''); }
function norm_(v) { return trim_(v).replace(/[\s　]/g, '').toLowerCase(); }
function yes_(v) { return v === true || /^(true|是|v|y|yes|1|✓|✔)$/i.test(trim_(v)); }
function filled_(v) { return v !== '' && v !== null && v !== undefined && trim_(v) !== ''; }
function clean_(v, max) { return trim_(v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max || 200); }
function safe_(v) { v = String(v === undefined ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; } // 防止試算表公式注入

function fmtDate_(d) { return Utilities.formatDate(d, TZ, 'yyyy/MM/dd'); }
function fmtTime_(d) { return Utilities.formatDate(d, TZ, 'HH:mm'); }
function timeStr_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'MM/dd HH:mm') : trim_(v); }
function now2mins_(d) { var s = fmtTime_(d).split(':'); return Number(s[0]) * 60 + Number(s[1]); }

/** 日期：可接受日期格式儲存格、2026/12/09、2026-12-09、115/12/09 */
function dateStr_(v) {
  if (v instanceof Date) return fmtDate_(v);
  var m = trim_(v).match(/^(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return '';
  var y = Number(m[1]); if (y < 1911) y += 1911;
  return y + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2);
}
/** 時間：可接受時間格式儲存格、12:20、1220 */
function hm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  var m = trim_(v).match(/^(\d{1,2})[:：]?(\d{2})$/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
function mins_(hm) { if (!hm) return null; var s = hm.split(':'); return Number(s[0]) * 60 + Number(s[1]); }
function m2hm_(m) { if (m === null || m === undefined) return ''; m = Math.max(0, m); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function dayDiff_(a, b) { // b - a，以天計
  if (!a || !b) return 0;
  var pa = a.split('/').map(Number), pb = b.split('/').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 864e5);
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
