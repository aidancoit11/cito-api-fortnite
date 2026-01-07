import Imap from 'imap';
import { simpleParser } from 'mailparser';

const config = {
  user: process.env.IMAP_USER || 'citoapi@outlook.com',
  password: process.env.IMAP_PASSWORD || 'Aidancoit7177$',
  host: process.env.IMAP_HOST || 'outlook.office365.com',
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
};

console.log('📬 Polling Outlook IMAP for Epic verification code...');
console.log(`   Email: ${config.user}`);
console.log('   Polling every 2 seconds for 2 minutes...\n');

const startTime = Date.now();
const maxWait = 120000;
let resolved = false;

function checkEmails() {
  if (resolved || Date.now() - startTime > maxWait) {
    if (!resolved) {
      console.log('\n❌ Timeout - no verification email received');
      process.exit(1);
    }
    return;
  }

  const imap = new Imap(config);

  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err) => {
      if (err) {
        imap.end();
        setTimeout(checkEmails, 2000);
        return;
      }

      // Search for recent emails
      const searchDate = new Date();
      searchDate.setMinutes(searchDate.getMinutes() - 10);

      imap.search([['SINCE', searchDate]], (err, results) => {
        if (err || !results || results.length === 0) {
          imap.end();
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          process.stdout.write(`\r⏳ Waiting for email... ${elapsed}s  `);
          setTimeout(checkEmails, 2000);
          return;
        }

        const fetch = imap.fetch(results, { bodies: '' });

        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream as any, (err, parsed) => {
              if (err || resolved) return;

              const from = parsed.from?.text || '';
              const subject = parsed.subject || '';

              if (
                from.toLowerCase().includes('epic') ||
                subject.toLowerCase().includes('epic') ||
                subject.toLowerCase().includes('verification') ||
                subject.toLowerCase().includes('security code')
              ) {
                const text =
                  (parsed.text || '') +
                  (typeof parsed.html === 'string' ? parsed.html : '');
                const codeMatch = text.match(/\b(\d{6})\b/);

                if (codeMatch && !resolved) {
                  resolved = true;
                  console.log('\n\n🎉 VERIFICATION CODE FOUND!');
                  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                  console.log(`📧 From: ${from}`);
                  console.log(`📋 Subject: ${subject}`);
                  console.log('');
                  console.log(`🔑 CODE: ${codeMatch[1]}`);
                  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                  imap.end();
                  process.exit(0);
                }
              }
            });
          });
        });

        fetch.once('end', () => {
          if (!resolved) {
            imap.end();
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            process.stdout.write(`\r⏳ Waiting for email... ${elapsed}s  `);
            setTimeout(checkEmails, 2000);
          }
        });
      });
    });
  });

  imap.once('error', (err: Error) => {
    console.log(`\n⚠️ IMAP error: ${err.message}`);
    if (!resolved) setTimeout(checkEmails, 2000);
  });

  imap.connect();
}

checkEmails();
