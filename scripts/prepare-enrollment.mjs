import { readFileSync, writeFileSync } from 'node:fs';
import { csvRows } from './csv.mjs';

// Inputs are the official dataset 9622 CSV downloads.
// https://stats.moe.gov.tw/files/opendata/106-112_students.csv
// https://stats.moe.gov.tw/files/opendata/students.csv
const years = {};
for (const file of process.argv.slice(2)) {
  const rows = csvRows(readFileSync(file, 'utf8'));
  const headers = rows.next().value;
  for (const row of rows) {
    const data = Object.fromEntries(headers.map((key, i) => [key, row[i]]));
    const year = data['學年度'];
    const school = data['學校代碼'].padStart(4, '0');
    const department = data['科系代碼'].padStart(8, '0');
    const count = Number(data['總計'].replaceAll(',', ''));
    if (!Number.isFinite(count)) throw new Error('Invalid enrollment count');
    const entries = years[year] ??= new Map();
    const key = school + ':' + department;
    const name = data['科系名稱'];
    const item = entries.get(key) ?? [school, department, name, 0, data['學校名稱'], new Map()];
    item[3] += count;
    const countsByName = item[5];
    countsByName.set(name, (countsByName.get(name) ?? 0) + count);
    entries.set(key, item);
  }
}
const enrollment = Object.fromEntries(Object.entries(years).map(([year, entries]) => [
  year, [...entries.values()].map(([school, code, name, total, schoolName, countsByName]) => [
    school, code, name, total, schoolName, countsByName.size > 1 ? [...countsByName] : null
  ])
]));
writeFileSync(new URL('../docs/data/enrollment.js', import.meta.url),
  'window.studentEnrollment=' + JSON.stringify(enrollment) + ';\n');
console.log(Object.fromEntries(Object.entries(years).map(([year, entries]) => [year, entries.size])));
