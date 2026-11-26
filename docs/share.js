(() => {
  'use strict';
  const { catalog, $, element, button, selectOptions, loadYear, makePicker, findMatches,
    departmentNameKey, matchEnrollmentDepartments } = window.studentSite;
  const { number, dataTable, col } = window.studentAnalytics;
  const enrollment = window.studentEnrollment;
  const emi = window.studentEmi;
  const schoolTypes = window.studentSchoolTypes;
  const schoolNamesByYear = Object.fromEntries(Object.entries(enrollment).map(([year, entries]) =>
    [year, Object.fromEntries(entries.map(row => [row[0], row[4]]))]));
  const years = catalog.years.filter(year => enrollment[year]);
  const state = { year: years.at(-1), ownership: '', type: '', school: '', domain: '', view: 'school', sort: 'ratio', search: '', page: 1 };
  const pageSize = 20;
  let rows = [];
  let request = 0;
  const schoolPicker = makePicker('share-school-picker', 'share-school-label', '所有學校', code => {
    state.school = code;
    state.view = code ? 'department' : 'school';
    state.page = 1;
    refresh();
  });
  selectOptions($('share-year'), years.slice().reverse().map(year => [year, year + ' 學年度']), state.year);
  selectOptions($('share-domain'), [['', '所有領域'], ...Object.entries(catalog.domains).sort()], '');
  const ratio = (foreign, total) => total > 0 && foreign <= total ? foreign / total * 100 : null;
  const percentage = value => value == null ? '—' : value.toFixed(1) + '%';

  function matchesSchoolType(school, year, scope) {
    const [ownership, category] = schoolTypes[year]?.[school] ?? [];
    if (scope.ownership && ownership !== scope.ownership) return false;
    if (scope.type === 'general') return category === '一般大學';
    if (scope.type === 'technical') {
      const name = schoolNamesByYear[year]?.[school] ?? catalog.schools[school] ?? '';
      return category === '技專校院' && name.endsWith('大學');
    }
    return true;
  }

  function renderTable() {
    const filtered = rows.filter(row => !state.search || findMatches([row.schoolName, row.name, row.code, row.school].join(' '), state.search));
    filtered.sort((a, b) => (b[state.sort] ?? -1) - (a[state.sort] ?? -1) || a.name.localeCompare(b.name, 'zh-TW'));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.page = Math.min(state.page, pages);
    const department = state.view === 'department';
    const columns = department ? [col('學校'), col('科系')] : [col('學校')];
    if (department) columns.push(col('全英語授課'));
    columns.push(col('境外學位生', true), col('在學總人數', true), col('外生佔比', true));
    const lines = filtered.slice((state.page - 1) * pageSize, state.page * pageSize).map(row => {
      const name = department ? row.name : button(row.schoolName, () => {
        state.school = row.school;
        state.view = 'department';
        state.page = 1;
        refresh();
      }, 'row-link');
      const share = element('div', 'share-value');
      share.append(element('span', '', percentage(row.ratio)));
      if (row.ratio != null) {
        const track = element('span', 'share-track');
        const fill = element('span');
        fill.style.width = row.ratio + '%';
        track.setAttribute('aria-hidden', 'true');
        track.append(fill);
        share.append(track);
      }
      const english = !emi[state.year] ? '無年度資料' : row.english
        ? (emi[state.year].referenceYear ? '有（推估）' : '有') : '未比對到';
      const language = element('span', row.english ? 'share-emi-badge' : 'share-emi-unknown', english);
      return [...(department ? [row.schoolName, name, language] : [name]), row.foreign == null ? '—' : number.format(row.foreign),
        row.total == null ? '—' : number.format(row.total), share];
    });
    $('share-table').replaceChildren(dataTable(columns, lines));
    if (!lines.length) $('share-table').append(element('p', 'empty', '沒有符合條件的資料'));
    $('share-count').textContent = '共 ' + number.format(filtered.length) + ' 筆';
    $('share-page').textContent = state.page + ' / ' + pages;
    $('share-prev').disabled = state.page === 1;
    $('share-next').disabled = state.page === pages;
    $('share-table-title').textContent = department ? '各科系境外學位生佔比' : '各校境外學位生佔比';
    $('share-emi-note').hidden = !department;
    const referenceYear = emi[state.year]?.referenceYear;
    $('share-emi-note').textContent = '全英語授課「有」表示該科系至少一個學制班別可由本站境外學位生明細比對至教育部「校15」全英語授課班別。未比對到的科系，其授課語言仍需確認。'
      + (referenceYear ? ' ' + state.year + ' 學年度依 ' + referenceYear + ' 學年度資料推估。' : '')
      + (!emi[state.year] ? ' 此學年度尚無可用的 EMI 比對資料。' : '');
    document.querySelectorAll('[data-share-view]').forEach(node =>
      node.setAttribute('aria-pressed', String(node.dataset.shareView === state.view)));
  }

  async function renderHistory(revision, scope) {
    const historyYears = years.filter(year => Number(year) <= Number(scope.year));
    const points = await Promise.all(historyYears.map(async year => {
      try {
        const record = await loadYear(year);
        const selected = enrollment[year].filter(([school, code]) =>
          matchesSchoolType(school, year, scope) &&
          (!scope.school || school === scope.school) && (!scope.domain || code.slice(0, 2) === scope.domain));
        const keys = new Set(selected.map(([school, code]) => school + ':' + code));
        const total = selected.reduce((sum, row) => sum + row[3], 0);
        let foreign = 0;
        let excluded = 0;
        for (const row of record.students) {
          if (row[5] >= 3 || row[3] < 0) continue;
          const school = ['0003A', '0003B'].includes(row[0]) ? '0003' : row[0];
          const code = catalog.departments[row[3]].split('|')[0].padStart(8, '0');
          if (!matchesSchoolType(school, year, scope)) continue;
          if (scope.school && school !== scope.school || scope.domain && code.slice(0, 2) !== scope.domain) continue;
          if (keys.has(school + ':' + code)) foreign += row[6];
          else excluded += row[6];
        }
        return { year, total, foreign, local: total - foreign, share: ratio(foreign, total), excluded };
      } catch {
        return { year, share: null };
      }
    }));
    if (revision !== request) return;
    const maxTotal = Math.max(1, ...points.filter(point => point.share != null).map(point => point.total));
    $('share-history-chart').replaceChildren(...points.map(point => {
      const row = element('div', 'share-history-row');
      row.append(element('span', 'share-history-year', point.year + ' 年'));
      if (point.share == null) {
        row.append(element('span', 'share-history-missing', '無可比較資料'));
        return row;
      }
      const localShare = 100 - point.share;
      const plot = element('div', 'share-history-plot');
      const bar = element('div', 'share-history-bar');
      bar.style.width = point.total / maxTotal * 100 + '%';
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', point.year + ' 學年度，本地生 ' + number.format(point.local) + ' 人，占 ' +
        percentage(localShare) + '，境外學位生 ' + number.format(point.foreign) + ' 人，占 ' + percentage(point.share));
      for (const [name, share, count, className] of [
        ['本地生', localShare, point.local, 'share-history-local'],
        ['境外學位生', point.share, point.foreign, 'share-history-foreign']
      ]) {
        const segment = element('span', className);
        segment.style.width = share + '%';
        segment.title = name + ' ' + percentage(share) + '（' + number.format(count) + ' 人）';
        bar.append(segment);
      }
      plot.append(bar);
      const counts = element('div', 'share-history-counts');
      counts.append(
        element('span', 'share-history-local-count', '本地生 ' + percentage(localShare) + '（' + number.format(point.local) + ' 人）'),
        element('span', 'share-history-foreign-count', '境外學位生 ' + percentage(point.share) + '（' + number.format(point.foreign) + ' 人）')
      );
      const totalLabel = element('span', 'share-history-total', number.format(point.total) + ' 人');
      totalLabel.setAttribute('aria-label', '總學生數 ' + number.format(point.total) + ' 人');
      totalLabel.title = '總學生數';
      row.append(plot, totalLabel, counts);
      return row;
    }));
    $('share-history-table').replaceChildren(dataTable([
      col('學年度'), col('本地生人數', true), col('本地生佔比', true),
      col('境外學位生人數', true), col('境外學位生佔比', true), col('在學總人數', true)
    ], points.map(point => [
      point.year, point.share == null ? '—' : number.format(point.local),
      point.share == null ? '—' : percentage(100 - point.share),
      point.share == null ? '—' : number.format(point.foreign), percentage(point.share),
      point.share == null ? '—' : number.format(point.total)
    ])));
    const excluded = points.filter(point => point.excluded).map(point => point.year + ' 年 ' + number.format(point.excluded) + ' 人');
    $('share-history-note').textContent = '顯示106學年度至所選學年度，沿用公私立、學校類型、學校與領域篩選，校別分類依各學年度資料。整條長度依當年在學總人數縮放，最多人數的年度為滿長；兩色分段依人數呈現，標示各類比例及人數。本地生以在學總數扣除境外學位生計算。'
      + (excluded.length ? ' 缺少對應總人數的境外紀錄已排除（' + excluded.join('、') + '）。' : '')
      + ' 113學年度起在學總數納入國際專修部學位先修生。';
    $('share-history-chart').setAttribute('aria-busy', 'false');
  }

  function departmentRows(group) {
    const { school, code, schoolName, enrollmentEntry, foreignNames } = group;
    return matchEnrollmentDepartments(enrollmentEntry, foreignNames.values(), state.year).map(row => ({
      school, code, schoolName, ...row, ratio: row.complete ? ratio(row.foreign, row.total) : null
    }));
  }

  async function refresh() {
    const current = ++request;
    $('share-results').setAttribute('aria-busy', 'true');
    $('share-error').hidden = true;
    $('share-history').hidden = false;
    $('share-history-chart').setAttribute('aria-busy', 'true');
    $('share-history-chart').replaceChildren(element('p', 'empty', '載入歷年資料中…'));
    $('share-history-table').replaceChildren();
    $('share-history-note').textContent = '';
    try {
      const record = await loadYear(state.year);
      if (current !== request) return;
      const departments = new Map();
      const englishPrograms = new Set(emi[state.year]?.degree ?? []);
      const schoolNames = {};
      for (const entry of enrollment[state.year]) {
        const [school, code, , total, schoolName] = entry;
        schoolNames[school] = schoolName;
        departments.set(school + ':' + code, {
          school, code, total, foreign: 0, schoolName, enrollmentEntry: entry, foreignNames: new Map()
        });
      }
      for (const row of record.students) {
        if (row[5] >= 3 || row[3] < 0) continue;
        const entry = catalog.departments[row[3]];
        const split = entry.indexOf('|');
        const code = entry.slice(0, split).padStart(8, '0');
        const name = entry.slice(split + 1);
        const school = ['0003A', '0003B'].includes(row[0]) ? '0003' : row[0];
        const key = school + ':' + code;
        if (!departments.has(key)) departments.set(key, {
          school, code, total: null, foreign: 0, foreignNames: new Map(),
          schoolName: record.schoolNames[school] ?? catalog.schools[school] ?? school
        });
        const group = departments.get(key);
        group.foreign += row[6];
        const nameId = departmentNameKey(name);
        const counts = group.foreignNames.get(nameId) ?? { name, foreign: 0, english: false };
        counts.foreign += row[6];
        counts.english ||= englishPrograms.has([row[0], row[3], row[4]].join(':'));
        group.foreignNames.set(nameId, counts);
      }
      Object.assign(schoolNames, record.schoolNames);
      const eligibleSchools = Object.entries(schoolNames).filter(([code]) =>
        code !== '9999' && matchesSchoolType(code, state.year, state)).sort(([a], [b]) => a.localeCompare(b));
      if (state.school && !eligibleSchools.some(([code]) => code === state.school)) {
        state.school = '';
        state.view = 'school';
        state.page = 1;
      }
      schoolPicker(state.school, eligibleSchools);
      const selected = [...departments.values()].filter(row =>
        matchesSchoolType(row.school, state.year, state) &&
        (!state.school || state.school === row.school) && (!state.domain || row.code.slice(0, 2) === state.domain));
      const schools = new Map();
      for (const row of selected) {
        const school = schools.get(row.school) ?? { school: row.school, schoolName: row.schoolName, name: row.schoolName, foreign: 0, total: null };
        school.foreign += row.foreign;
        if (row.total != null) school.total = (school.total ?? 0) + row.total;
        schools.set(row.school, school);
      }
      const total = selected.reduce((sum, row) => sum + (row.total ?? 0), 0);
      const foreign = selected.reduce((sum, row) => sum + row.foreign, 0);
      const unmatched = selected.filter(row => row.total == null);
      const unmatchedCount = unmatched.reduce((sum, row) => sum + row.foreign, 0);
      const matchedForeign = foreign - unmatchedCount;
      const overallRatio = ratio(matchedForeign, total);
      for (const school of schools.values()) {
        const missing = unmatched.some(row => row.school === school.school && row.foreign > 0);
        school.ratio = missing ? null : ratio(school.foreign, school.total);
      }
      rows = state.view === 'school' ? [...schools.values()] : selected.flatMap(departmentRows);
      $('share-scope').textContent = [state.year + ' 學年度', schoolNames[state.school] ?? '全臺大專校院',
        state.ownership, { general: '一般大學', technical: '科技大學' }[state.type],
        catalog.domains[state.domain]].filter(Boolean).join(' · ');
      $('share-metrics').replaceChildren(...[
        ['可對應科系的境外學位生', number.format(matchedForeign) + ' 人'],
        ['正式學籍在學總人數', number.format(total) + ' 人'],
        ['外生佔比', percentage(overallRatio)]
      ].map(([label, value], index) => {
        const card = element('article', index === 2 ? 'metric lead' : 'metric');
        card.append(element('h3', 'metric-label', label), element('strong', 'metric-value', value));
        return card;
      }));
      $('share-coverage').textContent = unmatched.length
        ? number.format(unmatched.length) + ' 個科系代碼缺少在學總人數，涉及 ' + number.format(unmatchedCount) + ' 名境外學位生，已排除於上方總覽計算。相關科系及學校佔比顯示「—」。'
        : '科系代碼均可對應在學總人數。點選校名可查看各科系明細。';
      renderTable();
      await renderHistory(current, { ...state });
    } catch (error) {
      if (current !== request) return;
      $('share-error').textContent = '資料載入失敗，請重新整理或切換學年度。';
      $('share-error').hidden = false;
      $('share-metrics').replaceChildren();
      $('share-table').replaceChildren();
      $('share-history').hidden = true;
    } finally {
      if (current === request) $('share-results').setAttribute('aria-busy', 'false');
    }
  }

  for (const key of ['year', 'domain', 'ownership', 'type']) $('share-' + key).addEventListener('change', event => {
    state[key] = event.target.value;
    state.page = 1;
    refresh();
  });
  document.querySelectorAll('[data-share-view]').forEach(node => node.addEventListener('click', () => {
    state.view = node.dataset.shareView;
    state.page = 1;
    refresh();
  }));
  $('share-sort').addEventListener('change', event => { state.sort = event.target.value; state.page = 1; renderTable(); });
  $('share-search').addEventListener('input', event => { state.search = event.target.value; state.page = 1; renderTable(); });
  $('share-prev').addEventListener('click', () => { state.page--; renderTable(); });
  $('share-next').addEventListener('click', () => { state.page++; renderTable(); });
  refresh();
})();
