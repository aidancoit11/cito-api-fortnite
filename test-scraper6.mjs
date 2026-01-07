import axios from 'axios';
import * as cheerio from 'cheerio';

const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
};

const resultsUrl = 'https://liquipedia.net/fortnite/MrSavage/Results';
const response = await axios.get(resultsUrl, { headers });
const $ = cheerio.load(response.data);

$('table.wikitable.sortable').first().each((_, table) => {
  const $table = $(table);
  
  const headerCells = $table.find('tr').first().find('th');
  const headerTexts = [];
  headerCells.each((i, th) => {
    headerTexts.push({ idx: i, text: $(th).text().toLowerCase().trim() });
  });
  
  console.log('Headers:');
  headerTexts.forEach(h => console.log(' ', h.idx, ':', h.text));
  
  const prizeIdx = headerTexts.findIndex(h => h.text.includes('prize'));
  console.log('');
  console.log('prizeIdx from findIndex:', prizeIdx);
  
  // Test first data row
  const firstDataRow = $table.find('tbody tr').filter((_, r) => $(r).find('td').length >= 4).first();
  const cells = firstDataRow.find('td');
  console.log('');
  console.log('First data row has', cells.length, 'cells');
  console.log('cells.eq(prizeIdx):', cells.eq(prizeIdx).text().trim());
  console.log('cells.eq(cells.length - 1):', cells.eq(cells.length - 1).text().trim());
  console.log('cells.eq(6):', cells.eq(6).text().trim());
});
