import axios from 'axios';
import * as cheerio from 'cheerio';

const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
};

const resultsUrl = 'https://liquipedia.net/fortnite/MrSavage/Results';
const response = await axios.get(resultsUrl, { headers });
const $ = cheerio.load(response.data);

let withTournament = 0;
let noTournament = 0;
let examples = [];

$('table.wikitable.sortable').each((_, table) => {
  const $table = $(table);
  
  $table.find('tbody tr').each((_, row) => {
    const $row = $(row);
    if ($row.find('th').length > 0) return;
    
    const cells = $row.find('td');
    if (cells.length < 4) return;
    
    const dateText = cells.eq(0).text().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return;
    
    const prizeText = cells.eq(cells.length - 1).text().trim();
    if (prizeText === '-' || prizeText === '' || prizeText === '$0') return;
    
    // Try to extract tournament name using the same logic as my scraper
    let tournamentName = '';
    
    // First check data-sort-value attributes
    cells.each((idx, cell) => {
      if (tournamentName) return false;
      const $cell = $(cell);
      const sortVal = $cell.attr('data-sort-value');
      if (sortVal && sortVal.length > 10 &&
          !sortVal.includes('Tier') && !sortVal.includes('S-Tier') &&
          !sortVal.includes('A-Tier') && !sortVal.includes('B-Tier') &&
          !sortVal.includes('C-Tier') && !sortVal.includes('D-Tier') &&
          !sortVal.includes('Weekly')) {
        const parts = sortVal.split(' / ');
        if (parts.length <= 1 || parts[0].length > 20) {
          tournamentName = sortVal;
          return false;
        }
      }
    });
    
    if (tournamentName) {
      withTournament++;
    } else {
      noTournament++;
      if (examples.length < 10) {
        // Get all data-sort-values for debugging
        const sortVals = [];
        cells.each((_, cell) => {
          const sv = $(cell).attr('data-sort-value');
          if (sv) sortVals.push(sv);
        });
        examples.push({ date: dateText, prize: prizeText, sortVals });
      }
    }
  });
});

console.log('Rows with tournament name:', withTournament);
console.log('Rows without tournament name:', noTournament);
console.log('');
console.log('Examples of rows without tournament name:');
examples.forEach((ex, i) => {
  console.log(i + 1, ':', ex.date, '| Prize:', ex.prize);
  console.log('   data-sort-values:', ex.sortVals.join(' | '));
});
