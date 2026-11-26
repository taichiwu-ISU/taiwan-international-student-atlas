window.studentSite = (() => {
  'use strict';

  const catalog = window.studentCatalog;
  const records = window.studentYears;
  const $ = id => document.getElementById(id);
  const loading = new Map();

  const specialProgramLabel = /專班|國際專修部|國際學生產學合作班|^海青班$|海外青年(?:就學輔導)?技術(?:研習|訓練)班/;
  const specialProgramDepartments = catalog.departments.map(entry => {
    const name = entry.split('|')[1].replace(/[（(]\s*含[^）)]*[）)]/g, '');
    return specialProgramLabel.test(name);
  });
  const specialProgramIdentities = catalog.identities.map(name => specialProgramLabel.test(name));

  function isSpecialProgram(row) {
    return Boolean(specialProgramDepartments[row[3]] || specialProgramIdentities[row[5]]);
  }

  const departmentNameKey = name => name.normalize('NFKC').trim();
  const legacyDepartmentPrefix = /^(D|DN|DY|N|NN|PN)_/;

  function matchEnrollmentDepartments(entry, foreignNames, year) {
    const enrolled = new Map();
    const unmatched = [];
    const namedTotals = entry?.length >= 6 ? entry[5] ?? [[entry[2], entry[3]]] : [];
    for (const [name, count] of namedTotals) {
      const key = departmentNameKey(name);
      const group = enrolled.get(key) ?? { name, total: 0, foreign: 0, sourceNames: [], english: false };
      group.total += count;
      enrolled.set(key, group);
    }
    for (const source of foreignNames) {
      const key = departmentNameKey(source.name);
      const legacyName = year === '106' || year === '107' ? key.replace(legacyDepartmentPrefix, '') : key;
      const group = enrolled.get(key) ?? enrolled.get(legacyName);
      if (!group) {
        unmatched.push({ ...source, total: null, complete: false, sourceNames: [key] });
        continue;
      }
      group.foreign += source.foreign;
      group.sourceNames.push(key);
      group.english ||= Boolean(source.english);
    }
    for (const group of enrolled.values()) {
      group.complete = !unmatched.length && group.foreign <= group.total;
      if (unmatched.length && !group.sourceNames.length) group.foreign = null;
    }
    return [...enrolled.values(), ...unmatched];
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  }

  function button(label, handler, className) {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  function empty(container, message) {
    container.replaceChildren(element('p', 'empty', message));
  }

  function selectOptions(select, entries, current) {
    select.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
    select.value = current;
  }

  function yearLabel(year) {
    return year + ' 學年度（' + (Number(year) + 1911) + '–' + (Number(year) + 1912) + '）';
  }

  function findMatches(text, keyword) {
    return text.normalize('NFKC').toLowerCase().replaceAll('台', '臺')
      .includes(keyword.normalize('NFKC').toLowerCase().replaceAll('台', '臺').trim());
  }

  function loadYear(year) {
    if (records[year]) return Promise.resolve(records[year]);
    if (loading.has(year)) return loading.get(year);
    const promise = new Promise((resolve, reject) => {
      const script = element('script');
      script.src = './data/' + year + '.js';
      script.onload = () => {
        script.remove();
        if (records[year]) resolve(records[year]);
        else reject(new Error('Missing data for ' + year));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Could not load ' + year));
      };
      document.head.append(script);
    }).finally(() => loading.delete(year));
    loading.set(year, promise);
    return promise;
  }

  function makePicker(id, label, placeholder, apply, { allowEmpty = true } = {}) {
    const container = $(id);
    const details = element('details', 'picker');
    const summary = element('summary');
    const selected = element('span');
    selected.id = id + '-selected';
    summary.setAttribute('aria-labelledby', label + ' ' + selected.id);
    summary.append(selected);
    const popover = element('div', 'picker-popover');
    const input = element('input');
    input.type = 'search';
    input.placeholder = '輸入名稱或代碼';
    input.setAttribute('aria-label', input.placeholder);
    const list = element('div', 'picker-options');
    let entries = [];
    let value = '';

    function fill() {
      const matches = entries.filter(([code, label]) => !input.value.trim() || findMatches(label + ' ' + code, input.value));
      if (!matches.length) {
        list.replaceChildren(element('p', '', '找不到符合的項目'));
        return;
      }
      list.replaceChildren(...matches.map(([code, name]) => {
        const option = button(name, () => {
          details.open = false;
          summary.focus();
          apply(code);
        });
        option.setAttribute('aria-current', String(code === value));
        return option;
      }));
    }

    details.addEventListener('toggle', () => {
      if (!details.open) return;
      input.value = '';
      fill();
      input.focus();
    });
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape' && details.open) {
        details.open = false;
        summary.focus();
      }
      if (event.key === 'ArrowDown' && event.target === input) {
        event.preventDefault();
        list.querySelector('button')?.focus();
      }
    });
    document.addEventListener('click', event => {
      if (!details.contains(event.target)) details.open = false;
    });
    input.addEventListener('input', fill);
    popover.append(input, list);
    details.append(summary, popover);
    container.append(details);
    return (next, options) => {
      value = next;
      selected.textContent = options.find(([code]) => code === value)?.[1] ?? placeholder;
      entries = allowEmpty ? [['', placeholder], ...options] : options;
      if (details.open) fill();
    };
  }

  return { catalog, records, $, element, button, empty, selectOptions, yearLabel, findMatches,
    loadYear, makePicker, isSpecialProgram, departmentNameKey, matchEnrollmentDepartments };
})();
