import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { csvRows } from './csv.mjs';
import { createEmiIndex } from './emi.mjs';

const output = new URL('../docs/data/', import.meta.url);
const input = new URL('../raw/', import.meta.url);
const names = { schools: {}, countries: {}, domains: {
  '01': '教育', '02': '藝術及人文', '03': '社會科學、新聞學及圖書資訊',
  '04': '商業、管理及法律', '05': '自然科學、數學及統計', '06': '資訊通訊科技',
  '07': '工程、製造及營建', '08': '農業、林業、漁業及獸醫',
  '09': '醫藥衛生及社會福利', '10': '服務', '99': '其他'
}};
const catalog = { departments: [], levels: [], identities: [] };
const indexes = Object.fromEntries(Object.keys(catalog).map(key => [key, new Map()]));
const years = new Map();
const schoolTypes = {};
const baseIdentities = ['正式修讀學位外國學生', '僑生（含港澳）', '正式修讀學位陸生'];
baseIdentities.forEach(name => index('identities', name));

function index(key, value) {
  const map = indexes[key];
  if (!map.has(value)) {
    map.set(value, catalog[key].length);
    catalog[key].push(value);
  }
  return map.get(value);
}

function year(value) {
  if (!/^\d{3}$/.test(value)) throw new Error(`Unexpected year ${value}`);
  if (!years.has(value)) years.set(value, { students: [], newcomers: null, schoolNames: {} });
  return years.get(value);
}

function count(value) {
  if (!/^\d+(,\d{3})*$/.test(value)) throw new Error(`Unexpected count ${value}`);
  return Number(value.replaceAll(',', ''));
}

function inputRows(file, width) {
  const rows = csvRows(readFileSync(new URL(file, input), 'utf8'));
  if (rows.next().value?.length !== width) throw new Error(`Unexpected headers in ${file}`);
  return (function* () {
    for (const row of rows) {
      if (row.length !== width) throw new Error(`Unexpected row in ${file}: ${row.slice(0, 8)}`);
      yield row;
    }
  })();
}

function schoolCode(value) {
  return ['0003A', '0003B'].includes(value) ? '0003' : value;
}

function setSchool(record, code, name) {
  record.schoolNames[code] ??= name;
}

function domain(code) {
  const prefix = code.slice(0, 2);
  if (!Object.hasOwn(names.domains, prefix)) throw new Error(`Unclassified department code: ${code}`);
  return prefix;
}

function departmentId(code, name) {
  return index('departments', code + '|' + name);
}

const emi = createEmiIndex(inputRows('emi-107-113.csv', 15), { '114': '113' });

for (const row of inputRows('degree.csv', 20)) {
  const [y, school, schoolName, country, countryName, code, department, level] = row;
  const record = year(y);
  const counts = baseIdentities.map((_, i) => count(row[8 + i * 2]) + count(row[9 + i * 2]));
  if (!counts.some(Boolean)) continue;
  setSchool(record, school, schoolName);
  names.countries[country] = countryName;
  counts.forEach((n, identity) => {
    if (n) record.students.push([school, country, domain(code), departmentId(code, department), index('levels', level || '未列學制'), identity, n]);
  });
}

for (const row of inputRows('nondegree.csv', 9)) {
  const [y, code, schoolName, country, countryName, category, men, women, unspecified] = row;
  const n = count(men) + count(women) + count(unspecified);
  if (!n) continue;
  const record = year(y);
  const school = schoolCode(code);
  setSchool(record, school, schoolName);
  names.countries[country] ??= countryName;
  record.students.push([school, country, '', -1, -1, index('identities', category), n]);
}

for (const row of inputRows('new-114.csv', 16)) {
  const [y, establishment, category, school, schoolName, code, department, , level] = row;
  (schoolTypes[y] ??= {})[school] ??= [establishment, category];
  if (row[12] === '...') {
    emi.addAdmission(row);
    continue;
  }
  const n = count(row[12]);
  const record = year(y);
  record.newcomers ??= [];
  emi.addAdmission(row, record.newcomers.length);
  setSchool(record, school, schoolName);
  record.newcomers.push([school, '', domain(code), departmentId(code, department), index('levels', level), -1, n]);
}

mkdirSync(output, { recursive: true });
const chronological = [...years.keys()].sort();
const annualTotals = {};
for (const value of chronological) {
  const record = years.get(value);
  emi.addDegree(value, record.students, catalog);
  Object.assign(names.schools, record.schoolNames);
  const degree = record.students.filter(row => row[5] < 3).reduce((sum, row) => sum + row[6], 0);
  const nondegree = record.students.filter(row => row[5] >= 3).reduce((sum, row) => sum + row[6], 0);
  const newcomers = record.newcomers?.reduce((sum, row) => sum + row[6], 0);
  annualTotals[value] = { degree, nondegree, newcomers };
  console.log(value, { degree, nondegree, total: degree + nondegree, newcomers });
  writeFileSync(new URL(`${value}.js`, output), `window.studentYears[${JSON.stringify(value)}]=${JSON.stringify(record)};\n`);
}
writeFileSync(new URL('catalog.js', output), `window.studentYears={};window.studentCatalog=${JSON.stringify({
  ...names, ...catalog, years: chronological, newcomerYears: chronological.filter(value => years.get(value).newcomers),
  annualTotals
})};\n`);
writeFileSync(new URL('school-types.js', output), `window.studentSchoolTypes=${JSON.stringify(schoolTypes)};\n`);
writeFileSync(new URL('emi.js', output), `window.studentEmi=${JSON.stringify(emi.years)};\n`);
