(() => {
  'use strict';

  const { catalog, $, element, button, empty, selectOptions, yearLabel,
    loadYear, makePicker, isSpecialProgram } = window.studentSite;
  const { dataTable, col, namedCounts, number, people } = window.studentAnalytics;
  const schoolTypes = window.studentSchoolTypes;
  const emi = window.studentEmi;
  const filters = Object.fromEntries(['mode', 'year', 'identity', 'domain', 'level', 'language', 'programs']
    .map(key => [key, $('cohort-' + key)]));
  const collator = new Intl.Collator('zh-TW');
  const custom = [new Set(), new Set()];
  let country = '';
  let request = 0;
  let studentMode = 'degree';
  const studentLabels = { degree: '境外學位生', nondegree: '非學位生', all: '所有學生' };
  const studentButtons = document.querySelectorAll('[data-students]');

  function updateStudentControls() {
    const identities = catalog.identities.map((name, index) => [String(index), name])
      .filter(([index]) => studentMode === 'all' || (Number(index) < 3) === (studentMode === 'degree'));
    if (!identities.some(([index]) => index === filters.identity.value)) filters.identity.value = '';
    selectOptions(filters.identity, choices(identities, '所有學生身分'), filters.identity.value);
    for (const key of ['domain', 'level', 'language']) {
      filters[key].disabled = studentMode === 'nondegree';
      if (filters[key].disabled) filters[key].value = '';
    }
    studentButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.students === studentMode)));
    $('cohort-summary').textContent = studentLabels[studentMode] + '人數';
    $('cohort-student-note').textContent = studentMode === 'degree'
      ? '包含外籍學位生、僑生（含港澳）及陸生。'
      : studentMode === 'nondegree'
        ? '包含華語文中心、交換及研習等非學位生。公開資料無學科領域、學制及授課語言明細。'
        : '合計境外學位生與非學位生。若選擇領域、學制或 EMI，僅計入具有對應明細的學生。';
  }

  const choices = (entries, all) => [['', all], ...entries];
  const namedEntries = object => Object.entries(object).sort((a, b) => collator.compare(a[1], b[1]));
  selectOptions(filters.year, catalog.years.slice().reverse().map(year => [year, year + ' 學年度']), catalog.years.at(-1));
  selectOptions(filters.identity, choices(catalog.identities.map((name, index) => [String(index), name]), '所有學生身分'), '');
  selectOptions(filters.domain, choices(Object.entries(catalog.domains).sort(), '所有領域'), '');
  const levelEntries = catalog.levels.map((name, index) => [String(index), name]);
  selectOptions(filters.level, choices(levelEntries, '所有學制'), '');

  const countryPicker = makePicker('cohort-country-picker', 'cohort-country-label', '所有來源地', value => {
    country = value;
    updateCountryPicker();
    refresh();
  });
  let countries = namedEntries(catalog.countries);
  function updateCountryPicker() {
    countryPicker(country, countries);
  }

  const customPickers = ['a', 'b'].map((key, index) =>
    makePicker('group-' + key + '-picker', 'group-' + key + '-label', '搜尋並加入學校', code => {
      custom[index].add(code);
      refresh();
    }, { allowEmpty: false })
  );
  const chipLists = [$('group-a-chips'), $('group-b-chips')];

  function schoolName(record, code) {
    return record.schoolNames[code] ?? catalog.schools[code] ?? code;
  }

  function groupsFor(record, year, mode) {
    if (mode === 'custom') return ['A 組', 'B 組'].map((name, index) => ({ name, codes: [...custom[index]] }));
    const ownership = { 'public-type': '公立', 'private-type': '私立' }[mode];
    const types = Object.entries(schoolTypes[year] ?? {});
    const general = ([, [, type]]) => type === '一般大學';
    const technical = ([code, [, type]]) => type === '技專校院' && schoolName(record, code).endsWith('大學');
    const codes = entries => entries.map(([code]) => code);
    if (mode === 'type' || ownership) {
      const schools = ownership ? types.filter(([, [owner]]) => owner === ownership) : types;
      const prefix = ownership ?? '';
      return [
        { name: prefix + '一般大學', codes: codes(schools.filter(general)) },
        { name: prefix + '科技大學', codes: codes(schools.filter(technical)) }
      ];
    }
    const universities = types.filter(entry => general(entry) || technical(entry));
    return ['公立', '私立'].map(ownership => ({
      name: ownership + '大學',
      codes: codes(universities.filter(([, [type]]) => type === ownership))
    }));
  }

  function renderCustom(record, year) {
    const available = new Set([...Object.keys(schoolTypes[year] ?? {}), ...record.students.map(row => row[0])]);
    available.delete('9999');
    const entries = [...available].sort().map(code => [code, schoolName(record, code)]);
    customPickers.forEach((picker, index) => {
      picker('', entries.filter(([code]) => !custom[index].has(code) && !custom[1 - index].has(code)));
      chipLists[index].replaceChildren(...[...custom[index]].map(code => {
        const name = schoolName(record, code);
        const chip = button(name + ' ×', () => {
          custom[index].delete(code);
          $('group-' + ['a', 'b'][index] + '-picker').querySelector('summary').focus();
          refresh();
        }, 'peer-chip');
        chip.setAttribute('aria-label', '移除 ' + name);
        return chip;
      }));
    });
    return available;
  }

  function aggregate(rows, { identity, domain, level, programs, language, studentMode, selectedCountry }, eligible,
    { sourceCountry = selectedCountry, keyFor = ([school]) => school, schools = null } = {}) {
    const totals = new Map();
    for (const row of rows) {
      const [school, source, field, department, studyLevel, studentIdentity, count] = row;
      if (studentMode === 'degree' && studentIdentity >= 3) continue;
      if (studentMode === 'nondegree' && studentIdentity < 3) continue;
      if (sourceCountry && source !== sourceCountry) continue;
      if (schools && !schools.has(school)) continue;
      if (identity !== '' && studentIdentity !== Number(identity)) continue;
      if (domain && field !== domain) continue;
      if (level !== '' && studyLevel !== Number(level)) continue;
      if (programs && isSpecialProgram(row) !== (programs === 'only')) continue;
      if (language && !eligible.has([school, department, studyLevel].join(':'))) continue;
      const key = keyFor(row);
      totals.set(key, (totals.get(key) ?? 0) + count);
    }
    return totals;
  }

  function openSchoolDepartments(school, rows, scope, eligible) {
    const dialog = $('cohort-department-dialog');
    const body = $('cohort-department-body');
    const details = $('cohort-department-table');
    $('cohort-department-title').textContent = school.name;
    $('cohort-department-context').textContent = [
      yearLabel(scope.year), studentLabels[scope.studentMode], catalog.countries[scope.selectedCountry],
      catalog.identities[scope.identity], catalog.domains[scope.domain], catalog.levels[scope.level],
      scope.programs === 'only' ? '僅可辨識專班' : scope.programs === 'exclude' ? '排除可辨識專班' : '',
      scope.language && 'EMI'
    ].filter(Boolean).join(' · ');
    $('cohort-department-total').textContent = people(school.count);
    if (!school.count) {
      empty(details, school.count == null ? '此學年度缺少校別資料。' : '此學年度沒有符合條件的學生紀錄。');
    } else {
      const counts = aggregate(rows, scope, eligible, { schools: new Set([school.code]), keyFor: row => row[3] });
      const departments = namedCounts([...counts].filter(([id, count]) => id >= 0 && count > 0),
        id => catalog.departments[id].split('|')[1]);
      const departmentRows = departments.map(({ label, count }) => [label, number.format(count)]);
      const unlisted = counts.get(-1);
      if (unlisted) departmentRows.push(['未提供科系明細', number.format(unlisted)]);
      details.replaceChildren(dataTable([col('科系'), col('人數', true)], departmentRows));
    }
    dialog.showModal();
    body.scrollTop = 0;
  }

  function renderResults(groups, record, totals, available, scope, eligible, history) {
    const stats = groups.map(group => {
      const schools = group.codes.map(code => ({
        code,
        name: schoolName(record, code),
        count: available.has(code) ? totals.get(code) ?? 0 : null
      })).sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || collator.compare(a.name, b.name));
      const reported = schools.filter(school => school.count != null);
      const total = reported.reduce((sum, school) => sum + school.count, 0);
      return { name: group.name, schools, reported: reported.length, total };
    });
    const max = Math.max(...stats.map(group => group.total), 1);
    $('cohort-metrics').replaceChildren(...stats.map((group, index) => {
      const card = element('article', index === 0 ? 'metric lead' : 'metric');
      const value = group.reported ? number.format(group.total) + ' 人' : '—';
      const caption = group.schools.length
        ? number.format(group.reported) + ' 所納入統計／' + number.format(group.schools.length) + ' 所入選'
        : '尚無學校';
      const meter = element('span', 'cohort-meter');
      const bar = element('span');
      bar.style.width = (group.total / max * 100) + '%';
      meter.setAttribute('aria-hidden', 'true');
      meter.append(bar);
      card.append(element('h3', 'metric-label', group.name), element('strong', 'metric-value', value),
        element('span', 'metric-foot', caption), meter);
      return card;
    }));
    const groupNote = scope.mode === 'custom'
      ? '每所學校只能加入一組。所選學年度沒有校別資料時，以「—」標示。'
      : '依所選學年度的教育部校別資料分組。科技大學包含技專校院類別中的大學。';
    $('cohort-note').textContent = groupNote + ' 0 人表示沒有符合篩選條件的學生紀錄。';
    $('cohort-schools').hidden = !stats.some(group => group.schools.length);
    $('cohort-table').replaceChildren(...stats.map((group, index) => {
      const column = element('section', 'cohort-school-column');
      const title = element('h3', '', group.name);
      title.id = 'cohort-school-title-' + index;
      const scroll = element('div', 'table-scroll');
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-labelledby', title.id);
      const rows = group.schools.map(school => {
        const nameButton = button(school.name, () => openSchoolDepartments(school, record.students, scope, eligible), 'row-link');
        nameButton.setAttribute('aria-haspopup', 'dialog');
        return [nameButton, ...history.map(point => {
          const count = schoolCount(point, school.code, index);
          return count == null ? '—' : number.format(count);
        })];
      });
      if (rows.length) scroll.append(dataTable([col('學校'), ...history.map(point => col(point.year + ' 年', true))], rows));
      else empty(scroll, '尚未選擇學校');
      column.append(title, scroll);
      return column;
    }));
    renderHistory(history, groups);
  }

  function schoolCount(point, code, index) {
    if (!point.totals || !point.groups[index].codes.includes(code) || !point.available.has(code)) return null;
    return point.totals.get(code) ?? 0;
  }

  function groupCount(point, index) {
    if (!point.totals) return null;
    const counts = point.groups[index].codes.map(code => schoolCount(point, code, index)).filter(count => count != null);
    return counts.length ? counts.reduce((sum, count) => sum + count, 0) : null;
  }

  function renderTrend(points, groups, scope) {
    const chart = $('cohort-trend-chart');
    const countsByYear = points.map(point => groups.map((_, index) => groupCount(point, index)));
    const highest = Math.max(1, ...countsByYear.flat());
    const magnitude = 10 ** Math.floor(Math.log10(highest / 4));
    const step = Math.max(1, Math.ceil(highest / (4 * magnitude)) * magnitude);
    const axis = element('div', 'axis');
    axis.setAttribute('aria-hidden', 'true');
    for (let index = 0; index <= 4; index++) {
      const tick = element('span', '', number.format(Math.round(index * step)));
      tick.style.bottom = index * 25 + '%';
      axis.append(tick);
    }

    $('cohort-trend-legend').replaceChildren(...groups.map((group, index) => {
      const label = element('span', 'school-mark cohort-series-' + index);
      label.append(element('i'), group.name);
      return label;
    }));
    const plot = element('div', 'plot');
    const estimates = [];
    points.forEach(({ year }, position) => {
      const counts = countsByYear[position];
      const reference = scope.language ? emi[year]?.referenceYear : null;
      const estimate = reference ? '依 ' + reference + ' 學年度校15推估' : '';
      if (estimate) estimates.push(year + ' 學年度' + estimate);
      const yearButton = button('', async () => {
        if (filters.year.value === year) return;
        filters.year.value = year;
        await refresh();
        if (filters.year.value === year && document.activeElement === document.body) {
          chart.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
        }
      });
      const labels = counts.map((count, index) =>
        groups[index].name + ' ' + (count == null ? '無可用資料' : people(count))
      );
      yearButton.setAttribute('aria-label', [year + ' 學年度', ...labels, estimate].filter(Boolean).join('，'));
      yearButton.setAttribute('aria-pressed', String(scope.year === year));
      yearButton.style.setProperty('--bar-height', Math.max(0, ...counts) / (step * 4) * 100 + '%');
      const bars = element('span', 'cohort-trend-bars');
      counts.forEach((count, index) => {
        const bar = element('span', (count == null ? 'cohort-trend-missing' : 'bar') + ' cohort-series-' + index,
          count == null ? '—' : '');
        if (count != null) bar.style.height = count / (step * 4) * 100 + '%';
        bars.append(bar);
      });
      const tooltip = element('span', 'bar-label');
      tooltip.append(...labels.map(label => element('span', '', label)));
      for (const node of [bars, element('span', 'year-label', year + (estimate ? '*' : '')), tooltip]) {
        node.setAttribute('aria-hidden', 'true');
        yearButton.append(node);
      }
      plot.append(yearButton);
    });
    const wrapper = element('div', 'trend-chart');
    wrapper.append(axis, plot);
    chart.replaceChildren(wrapper);
    const notes = [];
    if (countsByYear.some(counts => counts.includes(null))) notes.push('— 表示無可用資料。');
    if (points.some(point => point.failed)) notes.push('部分年度資料載入失敗，請重新整理後再試。');
    if (scope.language && points.some(point => !emi[point.year])) notes.push('未提供 EMI 資料的學年度無法套用此篩選。');
    if (estimates.length) notes.push('* ' + estimates.join('、') + '。');
    const note = $('cohort-trend-note');
    note.textContent = notes.join(' ');
    note.hidden = notes.length === 0;
    $('cohort-trend').hidden = false;
  }

  function renderHistory(history, groups) {
    const rows = history.map((point, position) => [
      point.year + ' 學年度',
      ...groups.flatMap((group, index) => {
        const count = groupCount(point, index);
        const previous = position ? groupCount(history[position - 1], index) : null;
        let growth = '—';
        if (count != null && previous === 0) growth = '前期為 0';
        if (count != null && previous > 0) {
          const change = ((count - previous) / previous * 100).toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          growth = (count > previous ? '+' : '') + change + '%';
        }
        return [count == null ? '—' : number.format(count), growth];
      })
    ]);
    $('cohort-history-table').replaceChildren(dataTable([
      col('學年度'), ...groups.flatMap(group => [col(group.name + '人數', true), col('年增率', true)])
    ], rows));
    $('cohort-history').hidden = false;
    $('cohort-history-note').textContent = '兩組套用相同篩選條件。預設分組依各學年度校別分類，自選群組沿用所選學校代碼。— 表示資料不足或無可比較的前一年；前期為 0 時不計算成長率。';
  }

  async function refresh() {
    const current = ++request;
    const values = {
      ...Object.fromEntries(Object.entries(filters).map(([key, input]) => [key, input.value])),
      studentMode, selectedCountry: country
    };
    const { year, mode, language } = values;
    const referenceYear = emi[year]?.referenceYear;
    $('custom-groups').hidden = mode !== 'custom';
    $('cohort-error').hidden = true;
    $('cohort-trend').hidden = true;
    $('cohort-history').hidden = true;
    $('cohort-results').setAttribute('aria-busy', 'true');
    $('cohort-scope').textContent = yearLabel(year);
    $('cohort-language-note').textContent = !emi[year]
      ? year + ' 學年度沒有可比對的全英語授課資料。'
      : referenceYear
        ? 'EMI 依 ' + referenceYear + ' 學年度教育部「校15」推估，學生人數採 ' + year + ' 學年度。'
        : 'EMI 依教育部「校15」全英語授課班別比對，涵蓋有系所與學制明細的學位生。';
    try {
      const loaded = await Promise.allSettled(catalog.years.map(loadYear));
      const years = new Map(catalog.years.map((year, index) => [year, loaded[index]]));
      if (current !== request) return;
      const selected = years.get(year);
      if (selected.status === 'rejected') throw selected.reason;
      const record = selected.value;
      const available = renderCustom(record, year);
      const groups = groupsFor(record, year, mode);
      const eligible = language ? new Set(emi[year]?.degree ?? []) : null;
      const countryTotals = aggregate(record.students, values, eligible, {
        sourceCountry: '', keyFor: row => row[1], schools: new Set(groups.flatMap(group => group.codes))
      });
      countries = namedEntries(catalog.countries).sort(([a, nameA], [b, nameB]) =>
        (countryTotals.get(b) ?? 0) - (countryTotals.get(a) ?? 0) || collator.compare(nameA, nameB))
        .map(([code, name]) => [code, name + '（' + number.format(countryTotals.get(code) ?? 0) + ' 人）']);
      updateCountryPicker();
      const points = catalog.years.map(year => {
        const loaded = years.get(year);
        const record = loaded.value;
        return {
          year,
          groups: record ? groupsFor(record, year, mode) : [{ codes: [] }, { codes: [] }],
          available: new Set([...Object.keys(schoolTypes[year] ?? {}), ...(record?.students ?? []).map(row => row[0])]),
          totals: record && (!language || emi[year])
            ? aggregate(record.students, values, language ? new Set(emi[year].degree) : null) : null,
          failed: loaded.status === 'rejected'
        };
      });
      renderTrend(points, groups, values);
      if (language && !emi[year]) {
        empty($('cohort-metrics'), '此學年度無法依 EMI 篩選。可選擇其他學年度或顯示所有授課語言。');
        $('cohort-schools').hidden = true;
        $('cohort-note').textContent = '';
        return;
      }
      const pointsByYear = new Map(points.map(point => [point.year, point]));
      const totals = pointsByYear.get(year).totals;
      const history = Array.from({ length: 5 }, (_, index) => {
        const historyYear = String(Number(year) - 4 + index);
        return pointsByYear.get(historyYear) ?? { year: historyYear, totals: null };
      });
      renderResults(groups, record, totals, available, values, eligible, history);
    } catch (error) {
      if (current !== request) return;
      $('cohort-error').textContent = '無法載入此學年度的統計資料。請重新整理或切換學年度。';
      $('cohort-error').hidden = false;
      $('cohort-metrics').replaceChildren();
      $('cohort-schools').hidden = true;
      $('cohort-note').textContent = '';
    } finally {
      if (current === request) $('cohort-results').setAttribute('aria-busy', 'false');
    }
  }

  Object.values(filters).forEach(input => input.addEventListener('change', refresh));
  studentButtons.forEach(button => button.addEventListener('click', () => {
    studentMode = button.dataset.students;
    updateStudentControls();
    refresh();
  }));
  updateStudentControls();
  updateCountryPicker();
  refresh();
})();
