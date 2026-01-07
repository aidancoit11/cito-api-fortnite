import axios from 'axios';
import * as cheerio from 'cheerio';

const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
};

const resultsUrl = 'https://liquipedia.net/fortnite/MrSavage/Results';
const response = await axios.get(resultsUrl, { headers });
const $ = cheerio.load(response.data);

let withPrize = 0;
let noPrize = 0;

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
    if (prizeText === '-' || prizeText === '' || prizeText === '$0') {
      noPrize++;
    } else {
      withPrize++;
    }
  });
});

console.log('Rows with prize money:', withPrize);
console.log('Rows without prize:', noPrize);
console.log('Total:', withPrize + noPrize);
