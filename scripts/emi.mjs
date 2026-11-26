const daytimeLevels = new Map([
  ['學士(四年)', '學士班(日間)'], ['學士(二年)', '學士班(日間)'], ['4+X', '學士班(日間)'],
  ['碩士', '碩士班(日間)'], ['博士', '博士班'], ['五專', '五專'], ['二專', '二專(日間)'],
  ['學士班(含四技)', '學士班(日間)'], ['二年制大學(二技)', '學士班(日間)'],
  ['學士後第二專長學士班(4+X)', '學士班(日間)'],
  ['碩士班', '碩士班(日間)'], ['博士班', '博士班']
]);
const masterInService = '碩士在職專班';
const legacySchedule = /^(D|DN|DY|N|NN|PN)_/;

const normalize = value => value.normalize('NFKC').replace(/\s/g, '').replaceAll('台', '臺');
const programKey = (year, school, code, name) => [year, school, code, normalize(name)].join('|');

function admissionClass(schedule, level) {
  if (schedule === '日間') return daytimeLevels.get(normalize(level));
  if (schedule === '在職' && level === '碩士班') return masterInService;
  return undefined;
}

export function createEmiIndex(rows, referenceYears = {}) {
  const programs = new Map();
  const years = {};
  for (const [year, , , school, , code, name, level, language] of rows) {
    years[year] ??= { degree: [], newcomers: [] };
    const key = programKey(year, school, code, name);
    if (!programs.has(key)) programs.set(key, { languages: new Map(), schedules: new Set() });
    const { languages } = programs.get(key);
    const className = normalize(level);
    if (!languages.has(className)) languages.set(className, new Set());
    languages.get(className).add(language.trim());
  }

  for (const [year, referenceYear] of Object.entries(referenceYears)) {
    if (years[year]) continue;
    if (!years[referenceYear] || years[referenceYear].referenceYear) {
      throw new Error('Missing official teaching-language data for ' + referenceYear);
    }
    years[year] = { degree: [], newcomers: [], referenceYear };
  }

  function findProgram(year, school, code, name) {
    const key = programKey(year, school, code, name);
    const existing = programs.get(key);
    if (existing) return existing;
    const referenceYear = years[year]?.referenceYear;
    if (!referenceYear) return undefined;
    const reference = programs.get(programKey(referenceYear, school, code, name));
    if (!reference) return undefined;

    // Reuse the official language while collecting schedules for the requested year only.
    const program = { languages: reference.languages, schedules: new Set() };
    programs.set(key, program);
    return program;
  }

  function isEnglish(program, className) {
    const languages = program.languages.get(className);
    return languages?.size === 1 && languages.has('英語');
  }

  function addAdmission([year, , , school, , code, name, schedule, level], index) {
    const program = findProgram(year, school, code, name);
    if (!program) return;
    const className = admissionClass(schedule, level);
    program.schedules.add(className);
    if (index != null && isEnglish(program, className)) years[year].newcomers.push(index);
  }

  function degreeMatches(year, school, code, name, level) {
    const prefix = name.match(legacySchedule)?.[1];
    const program = findProgram(year, school, code, name.replace(legacySchedule, ''));
    if (!program) return false;

    const daytimeClass = daytimeLevels.get(normalize(level));
    const masters = daytimeClass === '碩士班(日間)';
    if (prefix === 'N' || prefix === 'NN' || /碩士在職/.test(name)) {
      return masters && isEnglish(program, masterInService);
    }
    if (prefix === 'PN' || /進修/.test(name)) return false;
    if (prefix) return isEnglish(program, daytimeClass);

    // The headcount file sometimes combines day and in-service students under the same program.
    if (program.schedules.size) {
      return [...program.schedules].every(className => isEnglish(program, className) &&
        (className === daytimeClass || (masters && className === masterInService)));
    }
    return isEnglish(program, daytimeClass) &&
      (!masters || !program.languages.has(masterInService) || isEnglish(program, masterInService));
  }

  function addDegree(year, students, catalog) {
    if (!years[year]) return;
    const seen = new Set();
    for (const [school, , , department, level, identity] of students) {
      if (identity >= 3) continue;
      const key = [school, department, level].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const [code, name] = catalog.departments[department].split('|');
      if (degreeMatches(year, school, code, name, catalog.levels[level])) years[year].degree.push(key);
    }
  }

  return { addAdmission, addDegree, years };
}
