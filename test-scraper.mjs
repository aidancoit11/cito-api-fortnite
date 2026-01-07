import axios from 'axios';
import * as cheerio from 'cheerio';

const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

const wikiUrl = 'https://liquipedia.net/fortnite/MrSavage';
const resultsUrl = wikiUrl + '/Results';

console.log('Fetching:', resultsUrl);

const response = await axios.get(resultsUrl, { headers });
const $ = cheerio.load(response.data);

console.log('Page title:', $('title').text());
console.log('');

let tableCount = 0;
let rowCount = 0;
let dataRowCount = 0;

$('table.wikitable.sortable').each((_, table) => {
  tableCount++;
  const $table = $(table);
  
  const headerCells = $table.find('tr').first().find('th');
  const headerTexts = [];
  headerCells.each((_, th) => {
    headerTexts.push($(th).text().toLowerCase().trim());
  });
  
  console.log('Table', tableCount, 'headers:', headerTexts.slice(0, 4).join(' | '));
  
  const hasDate = headerTexts.some(h => h.includes('date'));
  const hasPrize = headerTexts.some(h => h.includes('prize'));
  console.log('Has date?', hasDate, 'Has prize?', hasPrize);
  
  if (!hasDate || !hasPrize) {
    console.log('Skipping table - missing date or prize column');
    console.log('');
    return;
  }
  
  $table.find('tbody tr').each((i, row) => {
    rowCount++;
    const $row = $(row);
    if ($row.find('th').length > 0) return; // Skip header/year rows
    
    const cells = $row.find('td');
    if (cells.length < 4) return;
    
    // Get first cell (date) to confirm this is a data row
    const dateText = cells.eq(0).text().trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      dataRowCount++;
      // Print first few rows
      if (dataRowCount <= 5) {
        const prizeText = cells.eq(cells.length - 1).text().trim();
        console.log('Data row', dataRowCount, ':', dateText, '| Prize:', prizeText);
      }
    }
  });
  console.log('');
});

console.log('Total tables:', tableCount);
console.log('Total rows in tbody:', rowCount);
console.log('Actual data rows:', dataRowCount);
