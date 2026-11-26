(() => {
  'use strict';

  const { studentMobility, studentSite, studentAnalytics } = window;
  if (!studentMobility || !studentSite || !studentAnalytics) {
    document.getElementById('mobility-error').hidden = false;
    return;
  }

  const { $, element, button, empty, makePicker, selectOptions, yearLabel } = studentSite;
  const { number, collator, addCount, namedCounts } = studentAnalytics;
  const { inbound, outbound, schools } = studentMobility;
  const directions = [
    { id: 'inbound', data: inbound, unit: '人' },
    { id: 'outbound', data: outbound, unit: '人次' }
  ];
  const years = [...new Set(directions.flatMap(({ data }) => Object.keys(data.byYear)))].sort();
  const schoolEntries = Object.entries(schools).sort((a, b) => collator.compare(a[1], b[1]));
  const yearSelect = $('mobility-year');
  let year = years.findLast(value => inbound.byYear[value] && outbound.byYear[value]) ?? years.at(-1);
  let school = '';

  const schoolPicker = makePicker('mobility-school', 'mobility-school-label', '所有學校', value => {
    school = value;
    schoolPicker(school, schoolEntries);
    render();
  });

  function summarize({ byYear }, targetYear) {
    const rows = byYear[targetYear];
    if (!rows) return { message: '無公開資料' };
    const counts = new Map();
    let longer = 0;
    let shorter = 0;
    for (const [code, country, first, second = 0] of rows) {
      if (school && code !== school) continue;
      longer += first;
      shorter += second;
      addCount(counts, country, first + second);
    }
    return counts.size ? { total: longer + shorter, longer, shorter, counts } : { message: '無符合紀錄' };
  }

  function renderTotal({ id, unit }, selected) {
    const total = $(id + '-total');
    const breakdown = $(id + '-breakdown');
    total.replaceChildren(element('strong', '', selected.total == null ? '—' : number.format(selected.total)), unit);
    if (selected.total == null) {
      breakdown.textContent = selected.message;
    } else if (id === 'outbound') {
      breakdown.textContent = '至少一學期 ' + number.format(selected.longer) + ' · 未滿一學期 ' + number.format(selected.shorter);
    } else {
      breakdown.textContent = '來自 ' + number.format(selected.counts.size) + ' 個國家或地區';
    }
  }

  function renderChart({ id, unit }, history) {
    const chart = $(id + '-chart');
    const highest = Math.max(4, ...[...history.values()].map(point => point.total ?? 0));
    const magnitude = 10 ** Math.floor(Math.log10(highest / 4));
    const step = Math.ceil(highest / (4 * magnitude)) * magnitude;
    const axis = element('div', 'axis');
    axis.setAttribute('aria-hidden', 'true');
    for (let index = 0; index <= 4; index++) {
      const tick = element('span', '', number.format(step * index));
      tick.style.bottom = index * 25 + '%';
      axis.append(tick);
    }

    const plot = element('div', 'plot');
    for (const [targetYear, point] of history) {
      const value = point.total == null ? point.message : number.format(point.total) + ' ' + unit;
      const height = (point.total ?? 0) / (4 * step) * 100 + '%';
      const column = button('', () => {
        year = targetYear;
        yearSelect.value = year;
        render();
        chart.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      });
      column.setAttribute('aria-pressed', String(targetYear === year));
      column.setAttribute('aria-label', targetYear + ' 學年度，' + value);
      column.style.setProperty('--bar-height', height);
      const bar = element('span', point.total == null ? 'mobility-gap' : 'bar', point.total == null ? '—' : '');
      if (point.total != null) bar.style.height = height;
      for (const node of [bar, element('span', 'year-label', targetYear), element('span', 'bar-label', value)]) {
        node.setAttribute('aria-hidden', 'true');
        column.append(node);
      }
      plot.append(column);
    }
    const wrapper = element('div', 'trend-chart');
    wrapper.append(axis, plot);
    chart.replaceChildren(wrapper);
  }

  function renderRanking({ id, data, unit }, selected) {
    const container = $(id + '-rank');
    if (!selected.counts) {
      empty(container, selected.message);
      return;
    }
    const ranked = namedCounts(selected.counts, index => data.countries[index]).slice(0, 5);
    const list = element('ol', 'rank-list');
    for (const { label, count } of ranked) {
      const item = element('li', 'rank-item');
      const track = element('span', 'rank-track');
      track.setAttribute('aria-hidden', 'true');
      const bar = element('i');
      bar.style.width = count / ranked[0].count * 100 + '%';
      track.append(bar);
      item.append(element('span', '', label), element('strong', '', number.format(count) + ' ' + unit), track);
      list.append(item);
    }
    container.replaceChildren(list);
  }

  function render() {
    $('mobility-scope').textContent = yearLabel(year) + ' · ' + (schools[school] ?? '全臺大專校院');
    for (const direction of directions) {
      const history = new Map(years.map(value => [value, summarize(direction.data, value)]));
      const selected = history.get(year);
      renderTotal(direction, selected);
      renderChart(direction, history);
      renderRanking(direction, selected);
    }
  }

  selectOptions(yearSelect, years.slice().reverse().map(value => [value, value + ' 學年度']), year);
  yearSelect.disabled = false;
  yearSelect.addEventListener('change', () => {
    year = yearSelect.value;
    render();
  });
  schoolPicker(school, schoolEntries);
  render();
  $('mobility-results').hidden = false;
})();
