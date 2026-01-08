import axios from 'axios';
import * as cheerio from 'cheerio';
import { proxyManager } from './src/utils/proxy-manager.js';

async function findFNCSPages() {
  console.log('Finding FNCS tournament pages...\n');
  const proxyConfig = proxyManager.getAxiosConfig();
  const resp = await axios.get('https://liquipedia.net/fortnite/Portal:Tournaments', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 20000,
    ...proxyConfig,
  });

  const $ = cheerio.load(resp.data);
  const fncsLinks: string[] = [];

  $('a').each((_, a) => {
    const href = $(a).attr('href');
    if (href && href.includes('FNCS') && href.includes('Grand') && !fncsLinks.includes(href)) {
      fncsLinks.push('https://liquipedia.net' + href);
    }
  });

  console.log('Found FNCS Grand Finals pages:');
  fncsLinks.slice(0, 10).forEach(l => console.log('-', l));
  return fncsLinks.slice(0, 3);
}

async function checkDropSpots() {
  // First find actual FNCS pages
  const urls = await findFNCSPages();

  if (urls.length === 0) {
    console.log('No FNCS pages found, trying hardcoded URLs...');
    urls.push(
      'https://liquipedia.net/fortnite/Fortnite_Champion_Series_Chapter_2_Season_5_-_Grand_Finals',
      'https://liquipedia.net/fortnite/FNCS_Invitational_2022',
    );
  }

  for (const url of urls) {
    try {
      console.log('\n=== Checking:', url, '===\n');
      const proxyConfig = proxyManager.getAxiosConfig();
      const resp = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        timeout: 20000,
        ...proxyConfig,
      });

      const $ = cheerio.load(resp.data);

      // Check page title
      console.log('Page title:', $('h1').first().text().trim());

      // Look for section headers related to drops
      console.log('\n--- Section Headers ---');
      $('h2 .mw-headline, h3 .mw-headline').each((i, h) => {
        const text = $(h).text();
        console.log('-', text);
      });

      // Look for any table that might have team/location data
      console.log('\n--- Tables with potential location data ---');
      $('table.wikitable').each((i, table) => {
        const headers = $(table).find('th').map((_, th) => $(th).text().trim()).get();
        const headerStr = headers.join(' | ').toLowerCase();

        // Check if headers mention anything location-related
        if (headerStr.includes('drop') || headerStr.includes('poi') ||
            headerStr.includes('location') || headerStr.includes('land') ||
            headerStr.includes('spot') || headerStr.includes('contest')) {
          console.log('\nFOUND TABLE WITH LOCATION DATA:');
          console.log('Headers:', headers.join(' | '));

          // Print first few rows
          $(table).find('tbody tr').slice(0, 5).each((_, row) => {
            const cells = $(row).find('td').map((_, td) => $(td).text().trim().substring(0, 30)).get();
            if (cells.length > 0) {
              console.log('Row:', cells.join(' | '));
            }
          });
        }
      });

      // Search page content for drop-related terms
      const bodyText = $('body').text();
      const dropMatches = bodyText.match(/(drop|landing|poi|contested|location).{0,50}/gi);
      if (dropMatches && dropMatches.length > 0) {
        console.log('\n--- Context around "drop/POI" mentions ---');
        const unique = [...new Set(dropMatches)].slice(0, 10);
        unique.forEach(m => console.log('-', m.trim()));
      }

      // Success - break
      break;
    } catch (e: any) {
      if (e.response?.status === 404) {
        console.log('404 - Page not found');
      } else {
        console.log('Error:', e.message);
      }
    }
  }
}

checkDropSpots().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
