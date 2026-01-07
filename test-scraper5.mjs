import axios from 'axios';
import * as cheerio from 'cheerio';

const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
};

function parseEarnings(text) {
  const match = text.replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const value = parseFloat(match);
  return isNaN(value) ? 0 : value;
}

const resultsUrl = 'https://liquipedia.net/fortnite/MrSavage/Results';
const response = await axios.get(resultsUrl, { headers });
const $ = cheerio.load(response.data);

let stats = { works: 0, fails: 0 };
let failExamples = [];
let workExamples = [];

$('table.wikitable.sortable').first().find('tbody tr').each((i, row) => {
  const $row = $(row);
  if ($row.find('th').length > 0) return;
  
  const cells = $row.find('td');
  if (cells.length < 4) return;
  
  const dateText = cells.eq(0).text().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return;
  
  const prizeCell = cells.eq(cells.length - 1);
  const prizeText = prizeCell.text().trim();
  const prizeHtml = prizeCell.html();
  const parsed = parseEarnings(prizeText);
  
  if (parsed > 0) {
    stats.works++;
    if (workExamples.length < 5) {
      workExamples.push({ text: prizeText, parsed, html: prizeHtml?.substring(0, 100) });
    }
  } else if (prizeText !== '-') {
    stats.fails++;
    if (failExamples.length < 10) {
      failExamples.push({ text: prizeText, parsed, html: prizeHtml?.substring(0, 100) });
    }
  }
});

console.log('Stats:', stats);
console.log('');
console.log('Working examples:');
workExamples.forEach(e => console.log(' -', JSON.stringify(e.text), '-> $' + e.parsed));
console.log('');
console.log('Failing examples (not "-"):');
failExamples.forEach(e => console.log(' -', JSON.stringify(e.text), '-> $' + e.parsed, '| HTML:', e.html));
