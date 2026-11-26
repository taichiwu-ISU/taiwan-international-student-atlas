import { readFile, writeFile } from 'node:fs/promises';
import { csvRows } from './csv.mjs';

const [inboundPath, outboundPath, outputPath = 'docs/data/mobility.js'] = process.argv.slice(2);
if (!inboundPath || !outboundPath) throw new Error('Usage: node scripts/prepare-mobility.mjs <non-degree.csv> <student-outbound.csv> [output.js]');

const schoolDirectory = new Map();
const inboundColumns = {
  year: '學年度', school: '學校代號', name: '學校名稱', country: '國別名稱', category: '非學位生類別',
  male: '非學位生人數_男', female: '非學位生人數_女', unspecified: '非學位生人數_無性別資料'
};
const outboundColumns = {
  year: '學年度', school: '學校統計處代碼', name: '學校名稱', country: '進修交流國家(地區)別',
  longer: '本國學生出國進修交流至少1學期(修讀學分)以上人數小計',
  shorter: '本國學生出國進修交流未滿1學期(修讀學分)人數小計'
};

function count(value) {
  if (!/^\d+$/.test(value?.trim())) throw new Error('Invalid mobility count: ' + value);
  return Number(value);
}

function summarize(source, columns, readCounts) {
  const rows = csvRows(source);
  const headers = rows.next().value;
  const indexes = Object.fromEntries(Object.entries(columns).map(([key, heading]) => {
    const index = headers.indexOf(heading);
    if (index < 0) throw new Error('Missing mobility column: ' + heading);
    return [key, index];
  }));
  const groups = new Map();
  const countries = new Map();
  for (const row of rows) {
    const totals = readCounts(row, indexes);
    if (!totals || totals.every(value => value === 0)) continue;
    const year = row[indexes.year].trim();
    const school = row[indexes.school].trim();
    const name = row[indexes.name].trim();
    const country = row[indexes.country].trim() || '未列國別';
    if (!/^\d{3}$/.test(year) || !/^[\dA-Z]{4}$/i.test(school) || !name) {
      throw new Error('Invalid mobility school record: ' + [year, school, name].join(', '));
    }
    if (!schoolDirectory.has(school) || schoolDirectory.get(school).year <= year) {
      schoolDirectory.set(school, { year, name });
    }
    if (!countries.has(country)) countries.set(country, countries.size);
    const countryId = countries.get(country);
    const key = school + ':' + countryId;
    if (!groups.has(year)) groups.set(year, new Map());
    const group = groups.get(year);
    if (!group.has(key)) {
      group.set(key, [school, countryId, ...totals]);
    } else {
      totals.forEach((total, index) => { group.get(key)[index + 2] += total; });
    }
  }
  const byYear = Object.fromEntries([...groups].map(([year, group]) =>
    [year, [...group.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1])]
  ));
  return { countries: [...countries.keys()], byYear };
}

const [inboundSource, outboundSource] = await Promise.all([readFile(inboundPath, 'utf8'), readFile(outboundPath, 'utf8')]);
const inbound = summarize(inboundSource, inboundColumns, (row, i) =>
  row[i.category] === '外國交換生' ? [count(row[i.male]) + count(row[i.female]) + count(row[i.unspecified])] : null
);
const outbound = summarize(outboundSource, outboundColumns, (row, i) => [count(row[i.longer]), count(row[i.shorter])]);
const schools = Object.fromEntries([...schoolDirectory].sort(([a], [b]) => a.localeCompare(b))
  .map(([code, { name }]) => [code, name]));
const data = { schools, inbound, outbound };
await writeFile(outputPath, 'window.studentMobility = ' + JSON.stringify(data) + ';\n');
