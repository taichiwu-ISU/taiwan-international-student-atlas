'use strict';

const { catalog, records, $, element, button, empty, selectOptions, yearLabel,
  loadYear, makePicker } = window.studentSite;

const { number, collator, metrics, addCount, rankings, summarize, fieldCount, share, percent, people,
  rankLabel, rankText, namedCounts, dataTable, col } = window.studentAnalytics;

const colors = ['#482363', '#386eaa', '#a15a30', '#75588f', '#8d6b19'];
const domains = Object.keys(catalog.domains).sort();
const maxPeers = colors.length - 1;
const state = {
  year: catalog.years.at(-1), school: '', peers: [], trendMetric: 'degree',
  fieldMetric: 'degree', country: ''
};
let revision = 0;

function schoolName(code, year = state.year) {
  return records[year]?.schoolNames[code] ?? catalog.schools[code] ?? code;
}

function selectedSchools() {
  return [state.school, ...state.peers];
}

function median(values) {
  const sorted = values.filter(value => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function labeledValue(value, note) {
  const line = element('div', 'measure-text', value);
  if (note) line.append(element('span', 'measure-foot', note));
  return line;
}

function schoolMark(code, index) {
  const name = element('span', 'school-mark');
  const marker = element('i');
  marker.style.backgroundColor = colors[index];
  marker.setAttribute('aria-hidden', 'true');
  name.append(marker, element('span', '', schoolName(code)));
  return name;
}

const focusPicker = makePicker('focus-school-picker', 'focus-school-label', '選擇主比較學校', code => {
  state.school = code;
  state.peers = state.peers.filter(peer => peer !== code);
  refresh();
}, { allowEmpty: false });

const peerPicker = makePicker('peer-school-picker', 'peer-school-label', '加入對照學校', code => {
  if (state.peers.length >= maxPeers || selectedSchools().includes(code)) return;
  state.peers.push(code);
  refresh().then(() => {
    if (state.peers.length === maxPeers) $('peer-chips').lastElementChild?.focus();
  });
}, { allowEmpty: false });

const countryPicker = makePicker('compare-country-picker', 'compare-country-label', '所有來源地', code => {
  state.country = code;
  refresh();
});

function renderControls(summary) {
  const schools = Object.keys(catalog.schools).filter(code => code !== '9999')
    .map(code => [code, schoolName(code)])
    .sort((a, b) => collator.compare(a[1], b[1]) || a[0].localeCompare(b[0]));
  focusPicker(state.school, schools);
  peerPicker('', schools.filter(([code]) => !selectedSchools().includes(code)));
  $('peer-picker-field').hidden = state.peers.length >= maxPeers;
  $('peer-chips').replaceChildren(...state.peers.map((code, index) => {
    const chip = button('', () => {
      state.peers = state.peers.filter(peer => peer !== code);
      refresh().then(() => $('peer-school-picker').querySelector('summary')?.focus());
    }, 'peer-chip');
    chip.setAttribute('aria-label', '移除對照學校 ' + schoolName(code));
    const close = element('span', 'chip-close', '×');
    close.setAttribute('aria-hidden', 'true');
    chip.append(schoolMark(code, index + 1), close);
    return chip;
  }));
  $('peer-status').textContent = '已加入 ' + state.peers.length + '／' + maxPeers + ' 所對照學校';
  const countries = Object.entries(catalog.countries).sort((a, b) =>
    (summary.countries.get(b[0]) ?? 0) - (summary.countries.get(a[0]) ?? 0) || collator.compare(a[1], b[1])
  );
  countryPicker(state.country, countries);
}

function renderRanks(summary) {
  const school = summary.schools.get(state.school);
  $('compare-scope').textContent = yearLabel(state.year) + ' · ' + schoolName(state.school);
  $('compare-metrics').replaceChildren(...Object.entries(metrics).map(([metric, label]) => {
    const card = element('article', metric === 'degree' ? 'metric lead' : 'metric');
    const count = school?.counts[metric];
    const total = element('span', 'metric-value', count == null ? '—' : number.format(count));
    if (count != null) total.append(element('small', '', '人'));
    const shareNote = metric === 'programs' && count != null
      ? '占本校境外學位生 ' + percent(share(count, school.counts.degree))
      : '';
    card.append(element('span', 'metric-label', label), total,
      element('span', 'metric-foot', rankText(summary.totals[metric], state.school)
        || (count == null ? '該年度無可用紀錄' : '0 人，未列名次')));
    if (shareNote) card.append(element('span', 'metric-foot', shareNote));
    return card;
  }));

  $('rank-comparison').hidden = state.peers.length === 0;
  if (!state.peers.length) return;
  const columns = [col('學校'), ...Object.values(metrics).map(label => col(label, true)), col('專班占比', true)];
  const rows = selectedSchools().map((code, index) => {
    const counts = summary.schools.get(code)?.counts;
    return [
      schoolMark(code, index),
      ...Object.keys(metrics).map(metric =>
        labeledValue(people(counts?.[metric]), rankText(summary.totals[metric], code))),
      percent(share(counts?.programs, counts?.degree))
    ];
  });
  $('compare-ranks').replaceChildren(dataTable(columns, rows, { emphasizeFirst: true }));
}

function renderTrend(years) {
  const chart = $('compare-trend-chart');
  const metric = state.trendMetric;
  const schools = selectedSchools();
  const points = years.map(year => summarize(year));
  const max = Math.max(0, ...points.flatMap(point =>
    schools.map(code => point?.schools.get(code)?.counts[metric] ?? 0)
  ));

  if (!max) {
    const reported = points.some(point =>
      schools.some(code => point?.schools.get(code)?.counts[metric] != null));
    empty(chart, reported ? '目前比較學校在這段期間的人數皆為 0。' : '目前比較學校在這段期間無可用紀錄。');
  } else {
    const legend = element('div', 'compare-legend');
    legend.append(...schools.map(schoolMark));
    const plot = element('div', 'compare-trend-plot');
    plot.setAttribute('aria-hidden', 'true');
    const scale = element('div', 'compare-scale');
    const magnitude = 10 ** Math.floor(Math.log10(max / 4));
    const step = Math.max(1, Math.ceil(max / (4 * magnitude)) * magnitude);
    for (let i = 4; i >= 0; i--) scale.append(element('span', '', number.format(i * step)));
    const groups = element('div', 'compare-trend-groups');
    for (const [index, year] of years.entries()) {
      const group = element('div', 'compare-trend-group');
      const bars = element('div', 'compare-bars');
      schools.forEach((code, schoolIndex) => {
        const count = points[index]?.schools.get(code)?.counts[metric];
        const bar = element('span', 'compare-bar');
        bar.style.height = (count ?? 0) / (4 * step) * 100 + '%';
        bar.style.backgroundColor = colors[schoolIndex];
        if (count != null) bar.title = schoolName(code, year) + ' · ' + year + ' 學年度 · ' + people(count);
        bars.append(bar);
      });
      group.append(bars, element('span', 'compare-year-label', year));
      groups.append(group);
    }
    plot.append(scale, groups);
    chart.replaceChildren(legend, plot);
  }

  const columns = [col('學校'), ...years.map(year => col(year + ' 學年度', true))];
  const rows = schools.map((code, i) => [
    schoolMark(code, i), ...points.map(point => labeledValue(
      people(point?.schools.get(code)?.counts[metric]), rankText(point?.totals[metric], code)
    ))
  ]);
  $('compare-trend-table').replaceChildren(dataTable(columns, rows, { emphasizeFirst: true }));
}

function renderFields(summary) {
  const metric = state.fieldMetric;
  const schools = selectedSchools();
  const chosen = schools.length > 1;
  const focus = summary.schools.get(state.school);
  const participating = [...summary.schools].filter(([, school]) => school.counts[metric] != null);
  const baseline = (chosen ? state.peers.map(code => summary.schools.get(code)) :
    participating.filter(([code]) => code !== state.school).map(([, school]) => school))
    .filter(school => school?.counts[metric] > 0);
  const columns = [col('學科領域'), col('本校人數', true), col('全臺排名', true)];
  if (chosen) columns.push(col('組內排名', true));
  columns.push(col('本校占比', true), col('對照中位數', true), col('占比差距', true));

  const fields = domains.map(domain => ({
    domain, rank: rankings(participating.map(([code, school]) => [code, fieldCount(school, metric, domain)]))
  })).sort((a, b) =>
    (a.rank.places.get(state.school) ?? Infinity) - (b.rank.places.get(state.school) ?? Infinity)
    || a.domain.localeCompare(b.domain)
  );

  const rows = fields.map(({ domain, rank }) => {
    const count = fieldCount(focus, metric, domain);
    const ratio = share(count, focus?.counts[metric]);
    const reference = median(baseline.map(school => share(fieldCount(school, metric, domain), school.counts[metric])));
    const difference = ratio == null || reference == null ? null : Math.round((ratio - reference) * 10) / 10;
    const link = button(catalog.domains[domain], () => showField(domain, summary), 'row-link');
    link.setAttribute('aria-haspopup', 'dialog');
    const values = [link, people(count), rankLabel(rank, state.school)];
    if (chosen) values.push(rankLabel(rankings(schools.map(code =>
      [code, fieldCount(summary.schools.get(code), metric, domain)])), state.school));
    const delta = difference == null ? '—' :
      (difference > 0 ? '+' : '') + difference.toFixed(1) + ' 個百分點';
    values.push(percent(ratio), percent(reference), element('span', difference > 0 ? 'positive-delta' : '', delta));
    return values;
  });
  const table = $('compare-fields');
  if (!participating.length) empty(table, '此學年度沒有可用的' + metrics[metric] + '領域資料。');
  else table.replaceChildren(dataTable(columns, rows));
  $('field-baseline').textContent = participating.length
    ? '占比以各校' + metrics[metric] + '總人數為分母。對照中位數涵蓋' +
      (chosen ? '自選對照學校' : '全臺其餘學校') + '中可計算占比的 ' + baseline.length + ' 校。'
    : '';
}

function rankedList(title, entries) {
  const block = element('section', 'field-list');
  block.append(element('h3', '', title));
  if (!entries.length) {
    block.append(element('p', 'compare-note', '目前無可用紀錄。'));
    return block;
  }
  const list = element('ol');
  for (const item of entries.slice(0, 5)) {
    const line = element('li');
    line.append(element('span', '', item.label), element('strong', '', people(item.count)));
    list.append(line);
  }
  block.append(list);
  return block;
}

function showField(domain, summary) {
  if (summary !== summarize(state.year)) return;
  const metric = state.fieldMetric;
  const isNew = metric === 'newcomers';
  const record = records[state.year];
  const departments = new Map();
  const countries = new Map();
  for (const [school, country, rowDomain, department, , identity, count] of
    (isNew ? record.newcomers : record.students)) {
    if (school !== state.school || rowDomain !== domain || !count) continue;
    if (!isNew && (identity < 0 || identity > 2)) continue;
    if (department >= 0) addCount(departments, department, count);
    if (country) addCount(countries, country, count);
  }
  $('field-dialog-title').textContent = catalog.domains[domain];
  $('field-dialog-context').textContent = yearLabel(state.year) + ' · ' + metrics[metric];
  const rows = selectedSchools().map((code, index) => {
    const school = summary.schools.get(code);
    const count = fieldCount(school, metric, domain);
    return [schoolMark(code, index), people(count), percent(share(count, school?.counts[metric]))];
  });
  const body = $('field-dialog-body');
  const lists = element('div', 'field-lists');
  lists.append(rankedList('本校科系前五名', namedCounts(departments, key => catalog.departments[key].split('|')[1])));
  if (!isNew) lists.append(rankedList('本校來源地前五名', namedCounts(countries, key => catalog.countries[key] ?? key)));
  body.replaceChildren(dataTable([col('學校'), col('人數', true), col('校內占比', true)], rows, { emphasizeFirst: true }),
    element('p', 'field-focus', '主比較學校 · ' + schoolName(state.school)), lists);
  if (isNew) body.append(element('p', 'compare-note panel-note', '教育部的新生註冊資料未提供來源地細分。'));
  $('field-dialog').showModal();
  body.scrollTop = 0;
}

function renderCountries(summary) {
  const country = state.country;
  const columns = [col('學校')];
  if (country) columns.push(col(catalog.countries[country] + '人數', true), col('占本校境外學位生', true));
  else columns.push(col('前五大來源地'));
  const rows = selectedSchools().map((code, index) => {
    const name = schoolMark(code, index);
    const school = summary.schools.get(code);
    if (country) {
      const count = school?.counts.degree == null ? null : school.countries.get(country) ?? 0;
      return [name, people(count), percent(share(count, school?.counts.degree))];
    }
    if (!school?.counts.degree) return [name, '—'];
    const pills = element('div', 'source-pills');
    for (const item of namedCounts(school.countries, key => catalog.countries[key] ?? key).slice(0, 5)) {
      pills.append(element('span', '', item.label + ' ' + people(item.count)));
    }
    return [name, pills];
  });
  $('compare-countries').replaceChildren(dataTable(columns, rows, { emphasizeFirst: true }));
}

async function refresh() {
  const token = ++revision;
  const result = $('compare-results');
  result.setAttribute('aria-busy', 'true');
  $('compare-error').hidden = true;
  try {
    await loadYear(state.year);
    if (token !== revision) return;
    const summary = summarize(state.year);
    if (!state.school) state.school = summary.totals.degree.places.keys().next().value ?? Object.keys(catalog.schools)[0];
    renderControls(summary);
    renderRanks(summary);
    renderFields(summary);
    renderCountries(summary);
    const yearEnd = catalog.years.indexOf(state.year) + 1;
    const years = catalog.years.slice(Math.max(0, yearEnd - 5), yearEnd);
    if (years.some(year => !records[year])) empty($('compare-trend-chart'), '載入歷年資料中…');
    const loaded = await Promise.allSettled(years.map(loadYear));
    if (token !== revision) return;
    renderTrend(years);
    if (loaded.some(value => value.status === 'rejected')) {
      $('compare-trend-chart').append(element('p', 'compare-note panel-note', '部分歷年資料暫時無法載入。'));
    }
  } catch (error) {
    if (token !== revision) return;
    $('compare-error').textContent = '目前無法載入比較資料。請重新整理後再試。';
    $('compare-error').hidden = false;
    console.error(error);
  } finally {
    if (token === revision) result.setAttribute('aria-busy', 'false');
  }
}

selectOptions($('compare-year'), catalog.years.slice().reverse().map(year => [year, year + ' 學年度']), state.year);
for (const [id, key] of [
  ['compare-year', 'year'], ['compare-trend-metric', 'trendMetric'], ['compare-field-metric', 'fieldMetric']
]) {
  $(id).addEventListener('change', event => {
    state[key] = event.target.value;
    refresh();
  });
}
refresh();
