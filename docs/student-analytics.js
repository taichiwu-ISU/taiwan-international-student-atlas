window.studentAnalytics = (() => {
  'use strict';

  const { records, element, isSpecialProgram } = window.studentSite;

  const number = new Intl.NumberFormat('zh-TW');
  const collator = new Intl.Collator('zh-TW');
  const metrics = {
    degree: '境外學位生', newcomers: '境外新生', programs: '可辨識專班學位生'
  };

  const summaries = new Map();

  function addCount(map, key, amount) {
    map.set(key, (map.get(key) ?? 0) + amount);
  }

  function rankings(entries) {
    const ordered = entries.filter(([, count]) => count != null)
      .sort((a, b) => b[1] - a[1]);
    const places = new Map();
    let rank = 0;
    ordered.forEach(([school, count], index) => {
      if (!count) return;
      if (index === 0 || ordered[index - 1][1] !== count) rank = index + 1;
      places.set(school, rank);
    });
    return { places, population: ordered.length };
  }

  function summarize(year) {
    if (summaries.has(year)) return summaries.get(year);
    const record = records[year];
    if (!record) return null;
    const schools = new Map();
    const countries = new Map();

    function schoolStats(code) {
      if (!schools.has(code)) {
        schools.set(code, {
          counts: { degree: null, newcomers: null, programs: null },
          fields: { degree: new Map(), newcomers: new Map() }, countries: new Map()
        });
      }
      return schools.get(code);
    }

    for (const row of record.students) {
      const [code, country, domain, , , identity, count] = row;
      if (identity < 0 || identity > 2 || code === '9999') continue;
      const school = schoolStats(code);
      school.counts.degree = (school.counts.degree ?? 0) + count;
      school.counts.programs ??= 0;
      if (isSpecialProgram(row)) school.counts.programs += count;
      addCount(school.fields.degree, domain, count);
      addCount(school.countries, country, count);
      addCount(countries, country, count);
    }

    for (const [code, , domain, , , , count] of record.newcomers ?? []) {
      if (code === '9999') continue;
      const school = schoolStats(code);
      school.counts.newcomers = (school.counts.newcomers ?? 0) + count;
      addCount(school.fields.newcomers, domain, count);
    }

    const totals = Object.fromEntries(Object.keys(metrics).map(metric => [
      metric, rankings([...schools].map(([code, school]) => [code, school.counts[metric]]))
    ]));
    const summary = { schools, countries, totals };
    summaries.set(year, summary);
    return summary;
  }

  function fieldCount(school, metric, domain) {
    return school?.counts[metric] == null ? null : school.fields[metric].get(domain) ?? 0;
  }

  function share(count, total) {
    return count == null || !total ? null : count / total * 100;
  }

  function percent(value) {
    if (value == null) return '—';
    return value > 0 && value < 0.1 ? '<0.1%' : value.toFixed(1) + '%';
  }

  function people(count) {
    return count == null ? '—' : number.format(count) + ' 人';
  }

  function rankLabel(ranking, code) {
    const place = ranking?.places.get(code);
    return place == null ? '—' : '第 ' + number.format(place) + ' 名';
  }

  function rankText(ranking, code) {
    const place = ranking?.places.get(code);
    return place == null ? '' : '全臺第 ' + number.format(place) + ' 名／' + number.format(ranking.population) + ' 校';
  }

  function namedCounts(counts, name) {
    return [...counts].map(([key, count]) => ({ key, label: name(key), count }))
      .sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
  }

  function dataTable(columns, rows, { emphasizeFirst = false } = {}) {
    const table = element('table', 'compare-table');
    const head = table.createTHead().insertRow();
    for (const column of columns) {
      const heading = element('th', column.numeric ? 'numeric' : '', column.label);
      heading.scope = 'col';
      head.append(heading);
    }
    const body = table.createTBody();
    rows.forEach((values, index) => {
      const line = body.insertRow();
      if (emphasizeFirst && index === 0) line.className = 'focus-row';
      values.forEach((value, columnIndex) => {
        const cell = element(columnIndex ? 'td' : 'th', columns[columnIndex].numeric ? 'numeric' : '');
        if (!columnIndex) cell.scope = 'row';
        cell.append(value instanceof Node ? value : String(value));
        line.append(cell);
      });
    });
    return table;
  }

  const col = (label, numeric = false) => ({ label, numeric });

  return { number, collator, metrics, addCount, rankings, summarize, fieldCount, share, percent, people,
    rankLabel, rankText, namedCounts, dataTable, col };
})();
