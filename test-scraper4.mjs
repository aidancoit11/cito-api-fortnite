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

function parsePlacement(text) {
  const lowerText = text.toLowerCase().trim();
  const directMatch = lowerText.match(/^(\d+)/);
  if (directMatch && directMatch[1]) {
    return parseInt(directMatch[1], 10);
  }
  const rangeMatch = lowerText.match(/(\d+)[a-z]*\s*[-–]\s*(\d+)/);
  if (rangeMatch && rangeMatch[1]) {
    return parseInt(rangeMatch[1], 10);
  }
  const topMatch = lowerText.match(/top\s*(\d+)/);
  if (topMatch && topMatch[1]) {
    return parseInt(topMatch[1], 10);
  }
  return 999;
}

function parseDate(text) {
  const cleanText = text.trim();
  const isoMatch = cleanText.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(cleanText);
  }
  return null;
}

const resultsUrl = 'https://liquipedia.net/fortnite/MrSavage/Results';
const response = await axios.get(resultsUrl, { headers });
const $ = cheerio.load(response.data);

const earnings = [];
const seenTournaments = new Set();
let skipped = { noDate: 0, noPlacement: 0, noTournament: 0, noEarnings: 0, duplicate: 0 };

$('table.wikitable.sortable').each((_, table) => {
  const $table = $(table);
  
  const headerCells = $table.find('tr').first().find('th');
  const headerTexts = [];
  headerCells.each((_, th) => {
    headerTexts.push($(th).text().toLowerCase().trim());
  });
  
  const hasDate = headerTexts.some(h => h.includes('date'));
  const hasPrize = headerTexts.some(h => h.includes('prize'));
  if (!hasDate || !hasPrize) return;
  
  const dateIdx = headerTexts.findIndex(h => h.includes('date'));
  const placeIdx = headerTexts.findIndex(h => h.includes('place'));
  const prizeIdx = headerTexts.findIndex(h => h.includes('prize'));
  
  $table.find('tbody tr').each((_, row) => {
    const $row = $(row);
    if ($row.find('th').length > 0) return;
    
    const cells = $row.find('td');
    if (cells.length < 4) return;
    
    // Extract date
    const dateText = cells.eq(dateIdx >= 0 ? dateIdx : 0).text().trim();
    const tournamentDate = parseDate(dateText);
    if (!tournamentDate) {
      skipped.noDate++;
      return;
    }
    
    // Extract placement
    const placeCell = cells.eq(placeIdx >= 0 ? placeIdx : 1);
    const placeText = placeCell.find('.placement-text').text().trim() || placeCell.text().trim();
    const placement = parsePlacement(placeText);
    
    // Extract tournament name
    let tournamentName = '';
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
    
    if (!tournamentName) {
      // Fallback to link text
      cells.each((_, cell) => {
        if (tournamentName) return false;
        const $cell = $(cell);
        const links = $cell.find('a[href*="/fortnite/"]');
        links.each((_, link) => {
          if (tournamentName) return false;
          const $link = $(link);
          const href = $link.attr('href') || '';
          const text = $link.attr('title') || $link.text().trim();
          if (href.includes('_Tournaments') || href.includes('index.php') ||
              text.includes('S-Tier') || text.includes('A-Tier') ||
              text.includes('B-Tier') || text.includes('C-Tier') ||
              text.includes('D-Tier') || text.includes('Weekly')) {
            return;
          }
          if (text && text.length > 8) {
            tournamentName = text;
            return false;
          }
        });
      });
    }
    
    if (!tournamentName) {
      skipped.noTournament++;
      return;
    }
    
    // Extract prize
    const prizeCell = cells.eq(cells.length - 1);
    const prizeText = prizeCell.text().trim();
    const earningsAmount = parseEarnings(prizeText);
    if (earningsAmount <= 0) {
      skipped.noEarnings++;
      return;
    }
    
    // Generate tournament ID
    const dateStr = tournamentDate.toISOString().split('T')[0];
    const tournamentId = `${dateStr}-${tournamentName}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100);
    
    if (seenTournaments.has(tournamentId)) {
      skipped.duplicate++;
      return;
    }
    seenTournaments.add(tournamentId);
    
    earnings.push({
      tournamentId,
      tournamentName,
      tournamentDate,
      placement,
      earnings: earningsAmount,
    });
  });
});

console.log('Earnings found:', earnings.length);
console.log('Skipped reasons:', skipped);
console.log('');
console.log('First 10 earnings:');
earnings.slice(0, 10).forEach((e, i) => {
  console.log(i + 1, ':', e.tournamentDate.toISOString().split('T')[0], '|', e.tournamentName.substring(0, 40), '| $' + e.earnings);
});
