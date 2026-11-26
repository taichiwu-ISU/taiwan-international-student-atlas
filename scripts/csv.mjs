export function* csvRows(data) {
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|\n|\r|$)/gy;
  data = data.replace(/^\uFEFF/, '');
  let row = [];

  while (field.lastIndex < data.length || row.length) {
    const position = field.lastIndex;
    const match = field.exec(data);
    if (!match) throw new Error(`Malformed CSV field at ${position}`);
    row.push(match[1]?.replaceAll('""', '"') ?? match[2]);
    if (match[3] !== ',') {
      if (row.length > 1 || row[0]) yield row;
      row = [];
    }
  }
}
