import axios from 'axios';
import * as cheerio from 'cheerio';

async function test() {
  // Get current month's page
  const now = new Date();
  const year = now.getFullYear();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const month = monthNames[now.getMonth()];
  // Try the "Transfers" page directly (not Portal:Transfers)
  const url = `https://liquipedia.net/fortnite/Transfers`;

  console.log(`Fetching: ${url}`);
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
    },
  });
  const $ = cheerio.load(response.data);

  // Debug: print all table classes
  console.log('\nTables found:');
  $('table').each((i, el) => {
    const classes = $(el).attr('class') || 'no-class';
    const rows = $(el).find('tr').length;
    console.log(`  Table ${i}: class="${classes}" (${rows} rows)`);
  });

  // Debug: print first few rows of largest table
  console.log('\n\nLooking at wikitable rows:');
  let found = false;
  $('table').each((tableIdx, table) => {
    if (found) return;
    const $table = $(table);
    const rows = $table.find('tr');
    if (rows.length > 5) {
      console.log(`\n--- Table ${tableIdx} (${rows.length} rows) ---`);
      rows.slice(0, 6).each((rowIdx, row) => {
        const cells = $(row).find('th, td');
        console.log(`\nRow ${rowIdx} (${cells.length} cells):`);
        cells.each((cellIdx, cell) => {
          const text = $(cell).text().trim().substring(0, 40);
          console.log(`  Cell ${cellIdx}: "${text}"`);
        });
      });
      found = true;
    }
  });
}
test().catch(console.error);
