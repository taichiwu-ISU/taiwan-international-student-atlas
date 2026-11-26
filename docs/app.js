'use strict';

const { catalog, records, $, element, button, empty, selectOptions, yearLabel, findMatches,
  loadYear, makePicker, isSpecialProgram, departmentNameKey, matchEnrollmentDepartments } = window.studentSite;
const number = new Intl.NumberFormat('zh-TW');
const collator = new Intl.Collator('zh-TW');
const pageSize = 10;
const modeButtons = document.querySelectorAll('.segments [data-mode]');
const latest = catalog.years.at(-1);
const latestNew = catalog.newcomerYears.at(-1);
const first = catalog.years[0];
const emiMatches = new Map(Object.entries(window.studentEmi ?? {}).map(([year, lists]) => [year, {
  degree: new Set(lists.degree), newcomers: new Set(lists.newcomers), referenceYear: lists.referenceYear
}]));
const degreeKindEntries = [['', '所有境外生'], ['0', '僅外籍生'], ['1', '僅僑生']];
const modes = {
  degree: {
    label: '境外學位生', identities: [0, 1, 2],
    note: '所有境外生包含外籍生、僑生（含港澳）及陸生。'
  },
  nondegree: {
    label: '非學位生', identities: catalog.identities.map((_, index) => index).slice(3),
    note: '包含華語文中心、交換、研習等類別。'
  },
  newcomers: {
    label: '境外新生', identities: [],
    note: '新生採各系所實際註冊數（欄位 E）。公開表無來源地與身分細分。'
  }
};
const programFilterLabels = { exclude: '排除可辨識專班', only: '僅可辨識專班' };
const groups = {
  schools: '學校', countries: '來源地', identities: '學生身分',
  domains: '學科領域', departments: '科系', levels: '學制'
};
const groupKeys = {
  schools: row => row[0], countries: row => row[1], domains: row => row[2],
  departments: row => row[3] >= 0 ? row[0] + ':' + row[3] : '',
  levels: row => row[4] >= 0 ? String(row[4]) : '',
  identities: row => String(row[5])
};
const state = {
  mode: 'degree', year: latest, school: '', country: '', kind: '',
  domain: '', level: '', programs: 'include', language: 'all', group: 'schools', page: 1, search: ''
};
let currentRows = [];
let tableRows = [];
const pendingYears = new Map();
let request = 0;

function schoolName(code, year = state.year) {
  return records[year]?.schoolNames[code] ?? catalog.schools[code] ?? code;
}

function modeIsNew() {
  return state.mode === 'newcomers';
}

function yearsInMode() {
  return modeIsNew() ? catalog.newcomerYears : catalog.years;
}

function emiRange() {
  const years = yearsInMode().filter(year => emiMatches.has(year));
  if (!years.length) return '';
  return years[0] + '–' + years.at(-1) + ' 學年度';
}

function missingEmiYear(year = state.year) {
  return state.language === 'emi' && !emiMatches.has(year);
}

function emiReferenceYear(year = state.year) {
  return emiMatches.get(year)?.referenceYear;
}

function emiScope() {
  if (state.language !== 'emi') return '';
  const reference = emiReferenceYear();
  return reference ? 'EMI（依 ' + reference + ' 學年度校15推估）' : 'EMI';
}

function rowsInMode(record) {
  return modeIsNew() ? record.newcomers : record.students;
}

const schoolPicker = makePicker('school-picker', 'school-label', '所有學校', code => change('school', code));
const countryPicker = makePicker('country-picker', 'country-label', '所有來源地', code => change('country', code));
const countryEntries = Object.entries(catalog.countries).sort((a, b) => collator.compare(a[1], b[1]));

function availableGroups() {
  if (modeIsNew()) return ['schools', 'domains', 'departments', 'levels'];
  if (state.mode === 'nondegree') return ['schools', 'countries', 'identities'];
  return ['schools', 'countries', 'domains', 'departments', 'levels', 'identities'];
}

function change(field, value) {
  if (state[field] === value) return;
  state[field] = value;
  state.page = 1;
  return refresh();
}

function switchMode(mode) {
  if (state.mode === mode) return;
  if (modeIsNew() || mode === 'newcomers') {
    state.country = '';
    state.level = '';
  }
  if (mode === 'nondegree') {
    state.domain = '';
    state.level = '';
    state.language = 'all';
  }
  state.mode = mode;
  state.kind = '';
  if (!availableGroups().includes(state.group)) state.group = 'schools';
  state.page = 1;
  if (!yearsInMode().includes(state.year)) state.year = latestNew;
  refresh();
}

function updateControls(record) {
  const isNew = modeIsNew();
  const isNondegree = state.mode === 'nondegree';
  const { identities, note } = modes[state.mode];
  const kindEntries = state.mode === 'degree' ? degreeKindEntries : [
    ['', '全部身分'], ...identities.map(identity => [String(identity), catalog.identities[identity]])
  ];
  selectOptions($('year'), yearsInMode().slice().reverse().map(year => [year, year + ' 學年度']), state.year);
  selectOptions($('kind'), kindEntries, state.kind);
  selectOptions($('domain'), [['', '所有領域'], ...Object.entries(catalog.domains).sort()], state.domain);
  const base = rowsInMode(record);
  const levels = [...new Set(base.filter(row => isNew || identities.includes(row[5]))
    .map(row => row[4]))].filter(index => index >= 0);
  if (state.level && !levels.includes(Number(state.level))) levels.push(Number(state.level));
  const levelEntries = levels.map(index => [String(index), catalog.levels[index]]).sort((a, b) => collator.compare(a[1], b[1]));
  selectOptions($('level'), [['', '所有學制'], ...levelEntries], state.level);
  $('programs').value = state.programs;
  $('language').value = state.language;
  $('language').disabled = isNondegree || !emiMatches.size;

  const knownSchools = isNew ? new Set(base.map(row => row[0])) : new Set(Object.keys(catalog.schools));
  if (state.school) knownSchools.add(state.school);
  knownSchools.delete('9999');
  const schools = [...knownSchools].map(code => [code, schoolName(code)]).sort((a, b) => a[0].localeCompare(b[0]));
  schoolPicker(state.school, schools);
  if (!isNew) countryPicker(state.country, rankedCountryEntries(base));
  $('country-field').hidden = isNew;
  $('kind-field').hidden = isNew;
  $('filters').dataset.mode = state.mode;
  $('domain-field').hidden = isNondegree;
  $('level-field').hidden = isNondegree;
  modeButtons.forEach(node => {
    node.setAttribute('aria-pressed', String(state.mode === node.dataset.mode));
  });
  $('filter-note').textContent = note;
  const range = emiRange();
  const reference = emiReferenceYear();
  $('language-note').textContent = isNondegree ? '非學位生資料沒有授課語言欄位。'
    : !range ? '目前無可用的全英語授課資料。'
    : missingEmiYear() ? state.year + ' 學年度尚無「校15」資料。EMI 可查詢 ' + range + '。'
    : reference ? state.year + ' 學年度 EMI 依 ' + reference + ' 學年度「校15」推估，學生人數採 ' + state.year + ' 學年度。'
    : 'EMI 僅包含教育部「校15」可比對的全英語授課班別（' + range + '）。';
}

function filterRows(rows, { country = state.country, year = state.year } = {}) {
  const { identities } = modes[state.mode];
  const programFilter = state.programs;
  const emi = state.language === 'emi';
  const eligible = emi ? emiMatches.get(year)?.[state.mode] : null;
  if (emi && !eligible) return [];
  const isNew = modeIsNew();
  return rows.filter((row, index) => {
    const [school, source, domain, department, level, identity] = row;
    if (identities.length && !identities.includes(identity)) return false;
    if (state.school && state.school !== school) return false;
    if (country && country !== source) return false;
    if (state.domain && state.domain !== domain) return false;
    if (state.level && Number(state.level) !== level) return false;
    if (programFilter !== 'include' && isSpecialProgram(row) !== (programFilter === 'only')) return false;
    if (eligible && !eligible.has(isNew ? index : [school, department, level].join(':'))) return false;
    return !state.kind || Number(state.kind) === identity;
  });
}

function sum(rows) {
  return rows.reduce((total, row) => total + row[6], 0);
}

function trendCount(year) {
  if (missingEmiYear(year)) return null;
  if (!state.school && !state.country && !state.kind && !state.domain && !state.level &&
      state.programs === 'include' && state.language === 'all') {
    const count = catalog.annualTotals?.[year]?.[state.mode];
    if (count != null) return count;
  }
  const record = records[year];
  const rows = record && rowsInMode(record);
  return rows ? sum(filterRows(rows, { year })) : null;
}

function percentage(part, total) {
  if (!total) return '—';
  const share = part / total * 100;
  return share > 0 && share < 0.1 ? '<0.1%' : share.toFixed(1) + '%';
}

function distinct(rows, key) {
  return new Set(rows.filter(row => row[6]).map(groupKeys[key]).filter(value => value && value !== '9999')).size;
}

function labelFor(group, key) {
  if (group === 'schools') return [schoolName(key), key === '9999' ? '' : key];
  if (group === 'countries') return [catalog.countries[key], ''];
  if (group === 'domains') return [catalog.domains[key], ''];
  if (group === 'levels') return [catalog.levels[key], ''];
  if (group === 'identities') return [catalog.identities[key], ''];
  const [school, department] = key.split(':');
  const [code, name] = catalog.departments[department].split('|');
  return [name, schoolName(school) + ' · ' + code];
}

function aggregate(rows, group, countIdentities = false) {
  const amounts = new Map();
  for (const row of rows) {
    const key = groupKeys[group](row);
    if (!key) continue;
    const count = row[6];
    const amount = amounts.get(key) ?? { n: 0, identityCounts: countIdentities ? [] : null };
    amount.n += count;
    if (countIdentities) {
      const identity = row[5];
      amount.identityCounts[identity] = (amount.identityCounts[identity] ?? 0) + count;
    }
    amounts.set(key, amount);
  }
  return [...amounts].map(([key, amount]) => {
    const [label, subtitle] = labelFor(group, key);
    return { key, label, subtitle, ...amount };
  }).sort((a, b) => b.n - a.n || collator.compare(a.label, b.label));
}

function rankedCountryEntries(rows) {
  const ranked = aggregate(filterRows(rows, { country: '' }), 'countries');
  const rankedCodes = new Set(ranked.map(({ key }) => key));
  return [
    ...ranked.map(({ key, label }) => [key, label]),
    ...countryEntries.filter(([code]) => !rankedCodes.has(code))
  ];
}

function addMetric(label, value, unit, foot, lead = false) {
  const node = element('article', lead ? 'metric lead' : 'metric');
  const count = element('span', 'metric-value', number.format(value));
  count.append(element('small', '', unit));
  node.append(element('span', 'metric-label', label), count, element('span', 'metric-foot', foot));
  $('metrics').append(node);
}

function renderMetrics() {
  $('metrics').replaceChildren();
  if (missingEmiYear()) {
    empty($('metrics'), '此學年度缺少全英語授課資料，無法計算 EMI 人數。');
    return;
  }
  const total = sum(currentRows);
  const previousYear = String(Number(state.year) - 1);
  const previous = yearsInMode().includes(previousYear) ? trendCount(previousYear) : null;
  const changeRate = previous ? (total - previous) / previous * 100 : null;
  const delta = changeRate == null ? state.year + ' 學年度'
    : '較上學年 ' + (changeRate > 0 ? '+' : '') + changeRate.toFixed(1) + '%';
  addMetric(modeIsNew() ? '境外新生實際註冊' : modes[state.mode].label, total, '人', delta, true);

  if (modeIsNew()) {
    addMetric('有境外新生註冊的學校', distinct(currentRows, 'schools'), '所', '依校別代碼統計');
    addMetric('有境外新生註冊的科系', distinct(currentRows, 'departments'), '個', '按各校科系統計');
    addMetric('有境外新生註冊的學科領域', distinct(currentRows, 'domains'), '類', '依學科標準分類');
    return;
  }

  addMetric('符合條件的學校', distinct(currentRows, 'schools'), '所', '依校別代碼統計');
  addMetric('來源地', distinct(currentRows, 'countries'), '個', '依國家或地區統計');
  if (state.mode === 'nondegree') {
    addMetric('非學位生類別', distinct(currentRows, 'identities'), '類', '依教育部公開分類');
  } else {
    addMetric('符合條件的科系', distinct(currentRows, 'departments'), '個', '按各校科系統計');
  }
}

function renderTrend({ loading = false, failedYears = new Set() } = {}) {
  const chart = $('trend');
  const caption = $('trend-caption');
  const focusedYear = chart.contains(document.activeElement) ? document.activeElement.dataset.year : '';
  $('trend-title').textContent = state.country
    ? catalog.countries[state.country] + '歷年人數趨勢'
    : '歷年人數趨勢';
  const values = yearsInMode().map(year => [year, trendCount(year)]);
  chart.setAttribute('aria-busy', String(loading));
  $('load-trend').hidden = !failedYears.size;
  const instructions = ['點選年份切換查詢年度'];
  if (loading) instructions.push('正在自動載入歷年資料');
  if (failedYears.size) instructions.push('部分年度資料暫時無法載入');
  if (values.some(([year]) => missingEmiYear(year))) instructions.push('部分學年度無 EMI 資料');
  const highest = Math.max(...values.map(([, n]) => n ?? 0), 1);
  const magnitude = 10 ** Math.floor(Math.log10(highest));
  const step = Math.max(1, Math.ceil(highest / magnitude) * magnitude / 4);
  const top = step * 4;
  const axis = element('div', 'axis');
  axis.setAttribute('aria-hidden', 'true');
  for (let index = 0; index <= 4; index++) {
    const tick = element('span', '', number.format(Math.round(index * step)));
    tick.style.bottom = index * 25 + '%';
    axis.append(tick);
  }
  const plot = element('div', 'plot');
  const trendNotes = [];
  for (const [year, n] of values) {
    const reference = state.language === 'emi' ? emiReferenceYear(year) : undefined;
    const estimate = reference ? '依 ' + reference + ' 學年度校15推估' : '';
    if (estimate) trendNotes.push(year + ' 學年度' + estimate);
    const barButton = button('', async () => {
      await change('year', year);
      if (state.year === year && document.activeElement === document.body) {
        chart.querySelector('[aria-pressed=true]')?.focus({ preventScroll: true });
      }
    });
    const label = n != null ? number.format(n) + ' 人'
      : missingEmiYear(year) ? '無 EMI 資料'
      : failedYears.has(year) ? '載入失敗' : '載入中';
    barButton.dataset.year = year;
    barButton.setAttribute('aria-label', year + ' 學年度，' + label + (estimate ? '，EMI ' + estimate : ''));
    barButton.setAttribute('aria-pressed', String(state.year === year));
    const bar = element('span', 'bar');
    const height = Math.min((n ?? 0) / top, 1) * 100 + '%';
    bar.style.height = height;
    bar.hidden = n == null;
    barButton.style.setProperty('--bar-height', height);
    for (const node of [bar, element('span', 'year-label', year + (estimate ? '*' : '')), element('span', 'bar-label', label)]) {
      node.setAttribute('aria-hidden', 'true');
      barButton.append(node);
    }
    plot.append(barButton);
  }
  const wrapper = element('div', 'trend-chart');
  wrapper.append(axis, plot);
  chart.replaceChildren(wrapper);
  if (focusedYear) plot.querySelector('[data-year="' + focusedYear + '"]')?.focus({ preventScroll: true });
  if (trendNotes.length) instructions.push('* ' + trendNotes.join('、'));
  caption.textContent = instructions.join('。') + '。';
}

function loadYearWithRetry(year) {
  if (!pendingYears.has(year)) {
    const pending = loadYear(year).catch(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return loadYear(year);
    }).finally(() => pendingYears.delete(year));
    pendingYears.set(year, pending);
  }
  return pendingYears.get(year);
}

function rankGroup() {
  if (!modeIsNew() && !state.country) return 'countries';
  if (!state.school) return 'schools';
  if (state.mode === 'nondegree') return 'identities';
  return 'domains';
}

function drill(group, key) {
  const fields = { schools: 'school', countries: 'country', domains: 'domain', identities: 'kind', levels: 'level' };
  if (!fields[group] || key === '9999') return null;
  if (group === 'identities' && state.mode === 'degree' && !degreeKindEntries.some(([value]) => value === key)) return null;
  return () => change(fields[group], state[fields[group]] === key ? '' : key);
}

function renderRanking() {
  const group = rankGroup();
  const titles = {
    countries: '主要來源地', schools: '人數最多的學校',
    domains: '主要學科領域', identities: '主要非學位生類別'
  };
  $('rank-title').textContent = titles[group];
  if (missingEmiYear()) {
    empty($('rank'), '此學年度缺少全英語授課資料。');
    return;
  }
  const ranking = aggregate(currentRows, group).filter(row => row.n && row.key !== '9999').slice(0, 5);
  if (!ranking.length) {
    empty($('rank'), '目前條件沒有可列入排名的資料');
    return;
  }
  const rank = element('ol', 'rank-list');
  for (const item of ranking) {
    const apply = drill(group, item.key);
    const wrapper = apply ? button('', apply) : element('div', 'rank-item');
    wrapper.append(element('span', '', item.label), element('strong', '', number.format(item.n)));
    const track = element('span', 'rank-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = element('i');
    fill.style.width = item.n / ranking[0].n * 100 + '%';
    track.append(fill);
    wrapper.append(track);
    const row = element('li');
    row.append(wrapper);
    rank.append(row);
  }
  $('rank').replaceChildren(rank);
}

function renderGroups() {
  $('groups').replaceChildren(...availableGroups().map(group => {
    const tab = button(groups[group], () => {
      state.group = group;
      state.page = 1;
      $('groups').querySelectorAll('button').forEach(node => {
        node.setAttribute('aria-pressed', String(node.dataset.group === group));
      });
      renderTable();
    });
    tab.dataset.group = group;
    tab.setAttribute('aria-pressed', String(state.group === group));
    return tab;
  }));
}

let enrollmentLoading;
let departmentRequest = 0;

function loadEnrollment() {
  if (window.studentEnrollment) return Promise.resolve(window.studentEnrollment);
  if (enrollmentLoading) return enrollmentLoading;
  enrollmentLoading = new Promise((resolve, reject) => {
    const script = element('script');
    script.src = './data/enrollment.js';
    script.onload = () => {
      script.remove();
      if (window.studentEnrollment) resolve(window.studentEnrollment);
      else reject(new Error('Missing enrollment data'));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Could not load enrollment data'));
    };
    document.head.append(script);
  }).finally(() => { enrollmentLoading = undefined; });
  return enrollmentLoading;
}

async function openDepartment(row) {
  const revision = ++departmentRequest;
  const year = state.year;
  const isNew = modeIsNew();
  const context = [
    row.subtitle, year + ' 學年度', modes[state.mode].label,
    catalog.identities[state.kind], catalog.domains[state.domain], catalog.levels[state.level],
    programFilterLabels[state.programs], emiScope()
  ];
  const departmentRows = isNew ? [] : filterRows(
    records[year].students.filter(student => groupKeys.departments(student) === row.key),
    { country: '', year }
  );
  const sources = aggregate(departmentRows, 'countries');
  $('department-dialog-title').textContent = row.label;
  $('department-dialog-context').textContent = context.filter(Boolean).join(' · ');
  $('department-total-label').textContent = isNew ? '新生實際註冊' : '境外學位生';
  $('department-total-value').textContent = number.format(isNew ? row.n : sum(departmentRows)) + ' 人';

  $('department-sources').hidden = true;
  $('department-sources-body').replaceChildren();
  $('department-sources-note').hidden = false;
  $('department-sources-note').textContent = isNew
    ? '教育部公開的新生註冊資料未提供各科系的來源國家或地區人數。'
    : '載入科系在學總人數…';
  $('department-dialog').showModal();
  $('department-sources-note').parentElement.scrollTop = 0;
  if (isNew) return;

  let total = null;
  let local = null;
  let multipleSourceNames = false;
  try {
    const enrollment = await loadEnrollment();
    if (revision !== departmentRequest || !$('department-dialog').open) return;
    const [school, department] = row.key.split(':');
    const departmentIndex = Number(department);
    const [code, name] = catalog.departments[departmentIndex].split('|');
    const departmentCode = code.padStart(8, '0');
    const enrollmentEntry = (enrollment[year] ?? []).find(entry => entry[0] === school && entry[1] === departmentCode);
    const foreignNames = new Map();
    for (const [studentSchool, , , index, , identity, count] of records[year].students) {
      if (studentSchool !== school || index < 0 || identity >= 3) continue;
      const [studentCode, studentName] = catalog.departments[index].split('|');
      if (studentCode.padStart(8, '0') !== departmentCode) continue;
      const entry = foreignNames.get(index) ?? { name: studentName, foreign: 0 };
      entry.foreign += count;
      foreignNames.set(index, entry);
    }
    const match = matchEnrollmentDepartments(enrollmentEntry, foreignNames.values(), year)
      .find(entry => entry.sourceNames.includes(departmentNameKey(name)));
    if (match?.complete) {
      total = match.total;
      local = total - match.foreign;
      multipleSourceNames = match.sourceNames.length > 1;
    }
  } catch (error) {
    // Keep the existing foreign-source detail available if the extra dataset fails.
  }
  if (revision !== departmentRequest || !$('department-dialog').open) return;
  sources.push({ label: '本地生', n: local });
  $('department-sources-body').replaceChildren(...sources.map(source => {
    const entry = element('tr');
    entry.append(element('td', '', source.label),
      element('td', 'numeric', source.n == null ? '—' : number.format(source.n)),
      element('td', 'numeric', source.n == null || !total || source.n > total ? '—' : percentage(source.n, total)));
    return entry;
  }));
  $('department-sources').hidden = false;
  const sourceScope = '各來源地人數依所選科系及其餘查詢條件顯示，涵蓋所有來源地。';
  $('department-sources-note').textContent = local == null
    ? '兩份資料無法完整對應，本地生及比例顯示「—」。' + sourceScope
    : '本地生以同一系所或班別的正式學籍在學總人數（' + number.format(total) + ' 人）扣除全部境外學位生推算。各列以該在學總人數為分母，比例可能未合計為 100%。' + sourceScope
      + (multipleSourceNames ? ' 本地生計算已納入同系所的其他原始名稱紀錄。' : '');
}

function detailIdentityColumns() {
  if (state.group === 'identities') return [];
  return modes[state.mode].identities
    .filter(identity => !state.kind || identity === Number(state.kind))
    .map(identity => ({ identity, label: catalog.identities[identity] + '（人）' }));
}

function detailCounts(row, identityColumns) {
  return [row.n, ...identityColumns.map(({ identity }) => row.identityCounts[identity] ?? 0)];
}

function renderTable() {
  const group = state.group;
  const isDepartment = group === 'departments';
  const identityColumns = detailIdentityColumns();
  tableRows = aggregate(currentRows, group, identityColumns.length > 0)
    .filter(row => findMatches(row.label + ' ' + row.subtitle, state.search));
  const pageCount = Math.max(1, Math.ceil(tableRows.length / pageSize));
  state.page = Math.min(pageCount, state.page);
  const start = (state.page - 1) * pageSize;
  const visible = tableRows.slice(start, start + pageSize);
  const columns = [groups[group], modeIsNew() ? '新生註冊（人）' : '境外學生（人）',
    ...identityColumns.map(column => column.label)];
  const head = element('tr');
  for (const [index, column] of columns.entries()) {
    const cell = element('th', index ? 'numeric' : '', column);
    if (index > 1) cell.classList.add('identity-column');
    cell.scope = 'col';
    head.append(cell);
  }
  $('table-head').replaceChildren(head);
  $('table-body').replaceChildren(...visible.map(row => {
    const tr = element('tr');
    const label = element('td');
    const apply = isDepartment ? () => openDepartment(row) : drill(group, row.key);
    const name = apply ? button(row.label, apply, 'row-link') : element('span', '', row.label);
    if (isDepartment) name.setAttribute('aria-haspopup', 'dialog');
    label.append(name);
    if (row.subtitle) label.append(element('span', 'row-sub', row.subtitle));
    tr.append(label, ...detailCounts(row, identityColumns)
      .map(count => element('td', 'numeric', number.format(count))));
    return tr;
  }));
  if (!visible.length) {
    const row = element('tr');
    const cell = element('td', 'empty', missingEmiYear() ? '此學年度缺少全英語授課資料。' : '找不到符合條件的明細');
    cell.colSpan = columns.length;
    row.append(cell);
    $('table-body').append(row);
  }
  $('result-count').textContent = missingEmiYear() ? '—' : '共 ' + number.format(tableRows.length) + ' 筆';
  $('page').textContent = state.page + ' / ' + pageCount;
  $('prev').disabled = state.page <= 1;
  $('next').disabled = state.page >= pageCount;
  $('export').disabled = !tableRows.length;
  const caption = $('detail-caption');
  if (isDepartment) {
    caption.textContent = modeIsNew() ? '點選科系可查看新生註冊人數。' : '點選科系可查看來源地人數。';
  } else if (group === 'identities' && state.mode === 'degree') {
    caption.textContent = '點選外籍生或僑生可篩選。再次點選可取消。';
  } else {
    caption.textContent = '點選明細中的名稱可篩選。再次點選可取消。';
  }
}

function exportCsv() {
  if (!tableRows.length) return;
  const identityColumns = detailIdentityColumns();
  const headers = ['學年度', '統計指標', '篩選學校', '篩選來源地', '篩選身分', '篩選學科領域', '篩選學制',
    '專班篩選', '授課語言', groups[state.group], '補充資訊', '人數',
    ...identityColumns.map(column => column.label)];
  const kindLabel = state.mode === 'degree'
    ? degreeKindEntries.find(([value]) => value === state.kind)?.[1]
    : catalog.identities[state.kind];
  const context = [state.year, modeIsNew() ? '境外新生實際註冊（E）' : modes[state.mode].label,
    state.school ? schoolName(state.school) : '', catalog.countries[state.country] ?? '',
    kindLabel ?? '',
    catalog.domains[state.domain] ?? '', state.level ? catalog.levels[state.level] : '',
    programFilterLabels[state.programs] ?? '全部學生', emiScope() || '全語言'];
  const rows = [headers, ...tableRows.map(row => [...context, row.label, row.subtitle, ...detailCounts(row, identityColumns)])];
  const csv = rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = element('a');
  link.href = url;
  link.download = state.year + '學年度-' + modes[state.mode].label + '-' + groups[state.group] + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refresh() {
  const revision = ++request;
  const workspace = document.querySelector('.workspace');
  workspace.setAttribute('aria-busy', 'true');
  $('error').hidden = true;
  $('export').disabled = true;
  try {
    const record = await loadYearWithRetry(state.year);
    if (revision !== request) return;
    updateControls(record);
    currentRows = filterRows(rowsInMode(record));
    $('scope-label').textContent = [
      yearLabel(state.year), state.school ? schoolName(state.school) : '全臺大專校院',
      catalog.countries[state.country], programFilterLabels[state.programs],
      emiScope()
    ].filter(Boolean).join(' · ');
    const missingYears = yearsInMode().filter(year =>
      !records[year] && !missingEmiYear(year) && trendCount(year) == null);
    renderMetrics();
    renderTrend({ loading: missingYears.length > 0 });
    renderRanking();
    renderGroups();
    renderTable();
    if (missingYears.length) {
      Promise.allSettled(missingYears.map(loadYearWithRetry)).then(results => {
        if (revision !== request) return;
        const failedYears = new Set(missingYears.filter((_, index) => results[index].status === 'rejected'));
        renderMetrics();
        renderTrend({ failedYears });
      });
    }
  } catch (error) {
    if (revision !== request) return;
    $('error').textContent = '目前無法讀取統計資料。請重新整理網頁後再試。';
    $('error').hidden = false;
    console.error(error);
  } finally {
    if (revision === request) workspace.setAttribute('aria-busy', 'false');
  }
}

for (const key of ['year', 'kind', 'domain', 'level', 'programs', 'language']) {
  $(key).addEventListener('change', event => change(key, event.target.value));
}
modeButtons.forEach(node => node.addEventListener('click', () => switchMode(node.dataset.mode)));
$('reset').addEventListener('click', () => {
  Object.assign(state, { year: yearsInMode().at(-1), school: '', country: '', kind: '',
    domain: '', level: '', programs: 'include', language: 'all', group: 'schools', page: 1, search: '' });
  $('table-search').value = '';
  refresh();
});
$('table-search').addEventListener('input', event => {
  state.search = event.target.value;
  state.page = 1;
  renderTable();
});
$('prev').addEventListener('click', () => { state.page--; renderTable(); });
$('next').addEventListener('click', () => { state.page++; renderTable(); });
$('export').addEventListener('click', exportCsv);
$('load-trend').addEventListener('click', refresh);
$('data-range').textContent = '臺灣大專校院 · ' + first + '–' + latest + ' 學年度';
refresh();
