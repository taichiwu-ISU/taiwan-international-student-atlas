(() => {
  'use strict';

  const { catalog, records, $, element, button, empty, selectOptions, yearLabel,
    loadYear, makePicker } = window.studentSite;
  const { number, collator, addCount, rankings, summarize, fieldCount, share, percent, people,
    rankLabel, namedCounts, dataTable, col } = window.studentAnalytics;

  const state = { year: catalog.years.at(-1), school: '', country: '' };
  let departmentSchool = '';
  let revision = 0;
  let current = null;
  const yearSelect = $('health-year');
  const openReport = $('open-report');
  const dialog = $('health-dialog');
  const schoolPicker = makePicker('health-school-picker', 'health-school-label', '選擇學校', school => {
    if (school !== state.school) {
      state.school = school;
      state.country = '';
      refresh();
    }
  }, { allowEmpty: false });
  const countryPicker = makePicker('health-country-picker', 'health-country-label', '選擇來源地', country => {
    selectCountry(country);
  }, { allowEmpty: false });

  function schoolName(code, year = state.year) {
    return records[year]?.schoolNames[code] ?? catalog.schools[code] ?? code;
  }

  const countryName = code => catalog.countries[code] ?? code;
  const yearShort = year => year + ' 學年度';

  function localCountry(summary, school, country) {
    const stats = summary?.schools.get(school);
    return stats?.counts.degree == null ? null : stats.countries.get(country) ?? 0;
  }

  function nationalCountry(summary, country) {
    return summary ? summary.countries.get(country) ?? 0 : null;
  }

  function displayed(value) {
    return value == null ? '—' : number.format(value);
  }

  function difference(first, last) {
    return first == null || last == null ? null : last - first;
  }

  function signed(value) {
    return value == null ? '—' : (value > 0 ? '+' : '') + number.format(value);
  }

  function watchSources(history, school, countryCodes) {
    if (history.length !== 4 || history.some(entry => !entry.summary)) return null;
    const first = history[0].summary;
    const latest = history.at(-1).summary;
    if (first.schools.get(school)?.counts.degree == null || latest.schools.get(school)?.counts.degree == null) return null;

    const matches = [];
    for (const country of countryCodes) {
      const totals = history.map(entry => nationalCountry(entry.summary, country));
      if (!totals.slice(1).every((total, i) => total > totals[i])) continue;
      const schoolCounts = [localCountry(first, school, country), localCountry(latest, school, country)];
      const schoolChange = difference(...schoolCounts);
      if (schoolChange > 0) continue;
      matches.push({ country, nationalChange: totals.at(-1) - totals[0], schoolChange });
    }
    return matches.sort((a, b) => b.nationalChange - a.nationalChange
      || collator.compare(countryName(a.country), countryName(b.country)));
  }

  function sourceCodes(history) {
    const counts = new Map();
    for (const { summary } of history) {
      for (const code of summary?.countries.keys() ?? []) counts.set(code, 0);
    }
    for (const [code, count] of history.at(-1).summary.countries) counts.set(code, count);
    return namedCounts(counts, countryName);
  }

  function metric(label, value, note, lead = false) {
    const card = element('div', lead ? 'metric lead' : 'metric');
    card.append(element('span', 'metric-label', label), element('strong', 'metric-value', value),
      element('span', 'metric-foot', note));
    return card;
  }

  function topNames(sources) {
    return sources.map(row => row.label).join('、');
  }

  function concentration(sources, total) {
    return percent(share(sources.reduce((sum, row) => sum + row.count, 0), total));
  }

  function renderOverview() {
    const { history, latest, school, sources, watch } = current;
    const total = school.counts.degree;
    const topThree = sources.slice(0, 3);
    const ranking = latest.totals.degree;

    $('health-metrics').replaceChildren(
      metric('境外學位生', people(total), '所選學年度在學人數', true),
      metric('全臺人數排名', rankLabel(ranking, state.school), '共 ' + number.format(ranking.population) + ' 校有資料，同人數並列'),
      metric('前三大來源占比', concentration(topThree, total), topNames(topThree))
    );

    const first = history[0];
    $('health-top-note').textContent = '顯示本校人數最多的八個來源地。' + (history.length > 1
      ? '增減以 ' + yearShort(first.year) + ' 為基準。' : '');
    const topColumns = [col('來源地'), col('人數', true), col('占本校', true)];
    if (history.length > 1) topColumns.push(col('增減（人）', true));
    const sourceRows = sources.slice(0, 8).map(({ key, count }) => {
      const row = [sourceButton(key), displayed(count), percent(share(count, total))];
      if (history.length > 1) row.push(signed(difference(localCountry(first.summary, state.school, key), count)));
      return row;
    });
    if (sourceRows.length) $('health-top-sources').replaceChildren(dataTable(topColumns, sourceRows));
    else empty($('health-top-sources'), '本年度沒有來源地人數。');

    const label = first.year + '–' + state.year + ' 學年度';
    $('health-watch-note').textContent = history.length < 4
      ? '需要四個連續學年度才能判定全臺人數是否連續三年增加。'
      : label + '全臺人數連續三年增加，且本校期末人數低於或等於期初。依全臺增加人數排序，最多列出八個來源地。';
    if (!watch?.length) {
      const message = watch ? '沒有符合兩項條件的來源地。' : '可用的年度或校方紀錄不足。';
      empty($('health-watch'), message);
      return;
    }
    const watchRows = watch.slice(0, 8).map(row => [sourceButton(row.country), signed(row.nationalChange), signed(row.schoolChange)]);
    $('health-watch').replaceChildren(dataTable([col('來源地'), col('全臺增減（人）', true), col('本校增減（人）', true)], watchRows));
  }

  function sourceButton(country) {
    return button(countryName(country), () => {
      selectCountry(country);
      $('health-trend-title').focus();
    }, 'health-source-link');
  }

  function selectCountry(country) {
    if (!current) return;
    state.country = country;
    renderCountry();
  }

  function trendChart(title, series, scope, className) {
    const figure = element('figure', 'health-chart ' + className);
    const caption = element('figcaption', '', title);
    const bars = element('div', 'health-year-bars');
    const maximum = Math.max(1, ...series.map(point => point[scope] ?? 0));
    for (const point of series) {
      const count = point[scope];
      const item = element('div', 'health-chart-point');
      const track = element('div', 'health-bar-track');
      track.setAttribute('aria-hidden', 'true');
      if (count !== null) {
        const bar = element('span', 'health-bar');
        bar.style.height = count / maximum * 100 + '%';
        track.append(bar);
      }
      item.append(element('div', 'health-chart-count', count == null ? '無資料' : people(count)),
        track, element('div', 'health-chart-year', yearShort(point.year)));
      bars.append(item);
    }
    figure.append(caption, bars);
    return figure;
  }

  function renderPeers(latest, country) {
    const note = $('health-peers-note');
    const target = $('health-peers');
    const types = window.studentSchoolTypes?.[state.year] ?? {};
    const selected = types[state.school];
    if (!selected) {
      departmentSchool = state.school;
      note.textContent = '本校該學年度的設立別或學校類別缺少公開紀錄。';
      empty(target, '無法建立同類學校比較。');
      return;
    }

    const peers = [...latest.schools.keys()]
      .filter(code => types[code]?.[0] === selected[0] && types[code]?.[1] === selected[1])
      .map(code => [code, localCountry(latest, code, country)]);
    const ranked = rankings(peers);
    const others = peers.filter(([code, count]) => code !== state.school && count > 0)
      .sort((a, b) => b[1] - a[1] || collator.compare(schoolName(a[0]), schoolName(b[0])));
    const rows = [[state.school, localCountry(latest, state.school, country)], ...others.slice(0, 5)];
    if (!rows.some(([code]) => code === departmentSchool)) departmentSchool = state.school;
    note.textContent = selected.join('・') + '，共 ' + number.format(ranked.population)
      + ' 校有境外學位生紀錄。列出本校及最多五所同類校。點選校名查看科系人數。';
    target.replaceChildren(dataTable([col('學校'), col('人數', true), col('同類校名次', true)],
      rows.map(([code, count]) => {
        const schoolButton = button(schoolName(code), () => selectDepartmentSchool(code), 'health-source-link');
        schoolButton.dataset.school = code;
        schoolButton.setAttribute('aria-pressed', String(code === departmentSchool));
        schoolButton.setAttribute('aria-controls', 'health-depts');
        return [schoolButton, displayed(count), rankLabel(ranked, code)];
      }), { emphasizeFirst: true }));
  }

  function selectDepartmentSchool(code) {
    if (!current || code === departmentSchool) return;
    departmentSchool = code;
    $('health-peers').querySelectorAll('button[data-school]').forEach(schoolButton => {
      schoolButton.setAttribute('aria-pressed', String(schoolButton.dataset.school === code));
    });
    renderDepartments(state.country);
  }

  function renderDepartments(country) {
    const departments = new Map();
    for (const [school, origin, , department, , identity, count] of records[state.year].students) {
      if (school === departmentSchool && origin === country && identity >= 0 && identity <= 2) {
        addCount(departments, department, count);
      }
    }
    const rows = namedCounts(departments, index => catalog.departments[index].split('|')[1])
      .filter(row => row.count > 0);
    const target = $('health-depts');
    $('health-depts-title').textContent = schoolName(departmentSchool) + '｜科系人數';
    $('health-depts-note').textContent = yearShort(state.year) + ' · ' + countryName(country)
      + ' · ' + number.format(rows.length) + ' 個科系';
    target.scrollTop = 0;
    if (!rows.length) {
      empty(target, '該校本學年度沒有此來源地的境外學位生。');
      return;
    }
    target.replaceChildren(dataTable([col('科系'), col('人數', true)],
      rows.map(row => [row.label, displayed(row.count)])));
  }

  function renderCountry() {
    const { latest, history, countryOptions } = current;
    const country = state.country;
    countryPicker(country, countryOptions.map(row => [row.key, row.label]));
    $('health-trend-note').textContent = countryName(country) + '｜兩張圖的縱軸各自依人數縮放。';
    const trend = history.map(({ year, summary }) => ({
      year, local: localCountry(summary, state.school, country), national: nationalCountry(summary, country)
    }));
    $('health-charts').replaceChildren(
      trendChart('本校', trend, 'local', 'local'),
      trendChart('全臺', trend, 'national', 'national')
    );
    $('health-trend-table').replaceChildren(dataTable(
      [col('學年度'), col('本校（人）', true), col('全臺（人）', true), col('本校占全臺', true)],
      trend.map(({ year, local, national }) => [yearShort(year), displayed(local), displayed(national), percent(share(local, national))])
    ));
    renderPeers(latest, country);
    renderDepartments(country);
  }

  function reportCard(label, value, note) {
    const card = element('div', 'report-kpi');
    card.append(element('span', '', label), element('strong', '', value));
    if (note) card.append(element('small', '', note));
    return card;
  }

  function reportList(title, values) {
    const section = element('section');
    section.append(element('h3', '', title));
    const list = element('ul', 'report-lines');
    for (const [label, value] of values) {
      const row = element('li');
      row.append(element('span', '', label), element('strong', '', value));
      list.append(row);
    }
    if (values.length) section.append(list);
    else section.append(element('p', '', '無資料'));
    return section;
  }

  function topFields(latest) {
    return Object.entries(catalog.domains).map(([code, label]) => {
      const count = fieldCount(current.school, 'degree', code);
      const ranking = rankings([...latest.schools].map(([id, school]) => [id, fieldCount(school, 'degree', code)]));
      return { label, count, place: ranking.places.get(state.school) };
    }).filter(field => field.place != null)
      .sort((a, b) => a.place - b.place || b.count - a.count || collator.compare(a.label, b.label)).slice(0, 3);
  }

  function buildReport() {
    const { latest, school, sources, history, watch } = current;
    const total = school.counts.degree;
    const top = sources.slice(0, 3);
    const ranking = latest.totals.degree;
    const report = element('article', 'health-report');
    report.append(element('p', 'report-period', yearLabel(state.year) + '｜一頁式校務簡報'),
      element('h2', '', schoolName(state.school) + '招生健檢'),
      element('p', 'report-period', '在學境外學位生，含外籍生、僑生（含港澳）與陸生。'));

    const cards = element('div', 'report-kpis');
    cards.append(reportCard('境外學位生', people(total)),
      reportCard('全臺人數排名', rankLabel(ranking, state.school), '共 ' + number.format(ranking.population) + ' 校有資料'),
      reportCard('前三大來源占比', concentration(top, total)));
    report.append(cards);

    const historySection = element('section');
    historySection.append(element('h3', '', '近三學年度學位生人數'));
    const years = element('div', 'report-history');
    for (const { year, summary } of history.slice(-3)) {
      const count = summary?.schools.get(state.school)?.counts.degree;
      years.append(reportCard(yearShort(year), count == null ? '無資料' : people(count)));
    }
    historySection.append(years);
    report.append(historySection);

    const columns = element('div', 'report-columns');
    columns.append(reportList('前三大來源地', top.map(row => [
      row.label, people(row.count) + '（' + percent(share(row.count, total)) + '）'
    ])), reportList('全臺排名最前的學科領域', topFields(latest).map(field => [
      field.label, '第 ' + number.format(field.place) + ' 名（' + people(field.count) + '）'
    ])));
    report.append(columns);

    const watchSection = element('section');
    const first = watch?.[0];
    const watchMessage = first
      ? history[0].year + '–' + state.year + ' 學年度，' + countryName(first.country)
        + '全臺人數連續三年增加，期初至期末全臺 ' + signed(first.nationalChange)
        + ' 人，本校 ' + signed(first.schoolChange) + ' 人。'
      : watch ? '這四個學年度未出現符合條件的來源地。' : '可用的年度或校方紀錄不足。';
    watchSection.append(element('h3', '', '全臺成長、本校未增加'), element('p', '', watchMessage));
    report.append(watchSection, element('p', 'report-source',
      '資料來源為教育部大專校院境外學生公開資料。全臺排名依各校人數計算，同人數並列。境外學生觀測站製作。'));
    return report;
  }

  async function refresh() {
    const run = ++revision;
    current = null;
    departmentSchool = '';
    $('health-error').hidden = true;
    $('health-detail').hidden = true;
    $('health-results').setAttribute('aria-busy', 'true');
    $('health-scope').textContent = '載入統計資料中…';
    $('health-metrics').replaceChildren();
    $('health-print').replaceChildren();
    openReport.disabled = true;

    const end = catalog.years.indexOf(state.year) + 1;
    const years = catalog.years.slice(Math.max(0, end - 4), end);
    const loaded = await Promise.allSettled(years.map(loadYear));
    if (run !== revision) return;

    try {
      const history = years.map((year, i) => ({ year, summary: loaded[i].status === 'fulfilled' ? summarize(year) : null }));
      const latest = history.at(-1).summary;
      if (!latest) throw new Error('The selected academic year could not be loaded.');

      const schools = [...latest.schools].filter(([, stats]) => stats.counts.degree != null);
      schools.sort((a, b) => b[1].counts.degree - a[1].counts.degree || collator.compare(schoolName(a[0]), schoolName(b[0])));
      if (!state.school) state.school = schools[0]?.[0] ?? '';
      const selected = latest.schools.get(state.school);
      const schoolOptions = schools.map(([code]) => [code, schoolName(code)]);
      if (state.school && selected?.counts.degree == null) schoolOptions.unshift([state.school, schoolName(state.school)]);
      schoolPicker(state.school, schoolOptions);
      $('health-scope').textContent = yearShort(state.year) + (state.school ? '｜' + schoolName(state.school) : '');
      if (selected?.counts.degree == null) {
        empty($('health-metrics'), state.school ? '本校此學年度缺少境外學位生紀錄。' : '本年度沒有可用的境外學位生紀錄。');
        return;
      }

      const sources = namedCounts(selected.countries, countryName).filter(row => row.count > 0);
      const countryOptions = sourceCodes(history);
      if (!countryOptions.some(row => row.key === state.country)) state.country = sources[0]?.key ?? countryOptions[0]?.key ?? '';
      current = { history, latest, school: selected, sources, countryOptions,
        watch: watchSources(history, state.school, countryOptions.map(row => row.key)) };
      renderOverview();
      if (state.country) renderCountry();
      $('health-detail').hidden = false;
      openReport.disabled = false;
      if (loaded.some(result => result.status === 'rejected')) {
        $('health-error').textContent = '部分歷年資料暫時無法載入。可重新整理頁面再試一次。';
        $('health-error').hidden = false;
      }
    } catch (error) {
      console.error(error);
      $('health-error').textContent = '暫時無法載入所選學年度，請重新整理或選擇其他學年度。';
      $('health-error').hidden = false;
      $('health-scope').textContent = '資料載入失敗';
    } finally {
      $('health-results').setAttribute('aria-busy', 'false');
    }
  }

  selectOptions(yearSelect, [...catalog.years].reverse().map(year => [year, yearLabel(year)]), state.year);
  yearSelect.addEventListener('change', () => {
    state.year = yearSelect.value;
    refresh();
  });

  openReport.addEventListener('click', () => {
    if (!current) return;
    const report = buildReport();
    $('health-preview').replaceChildren(report);
    $('health-print').replaceChildren(report.cloneNode(true));
    dialog.showModal();
  });
  $('print-report').addEventListener('click', () => window.print());

  refresh();
})();
