const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function runOnGitHub() {
  console.log('====================================================');
  console.log('    AGRIBUSINESS LINKEDIN AUTO-POSTER (GITHUB RUNNER)');
  console.log('====================================================\n');

  const liAt = process.env.LI_AT;
  const jsessionId = process.env.JSESSIONID;

  if (!liAt) {
    console.error('ERROR: Missing LI_AT secret in GitHub Actions environment!');
    process.exit(1);
  }

  const configFile = path.join(__dirname, 'agribusiness_config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));

  const activeIndex = config.current_pillar_index;
  const pillar = config.pillars[activeIndex];

  console.log(`[Active Pillar ${pillar.id + 1} of ${config.pillars.length}]`);
  console.log(`Title:   ${pillar.name}`);
  console.log(`Metrics: ${pillar.metrics_focus}\n`);

  const postFile = path.join(__dirname, 'output', `pillar${pillar.id + 1}_post_draft.txt`);
  const outputFiles = fs.existsSync(path.join(__dirname, 'output')) ? fs.readdirSync(path.join(__dirname, 'output')) : [];
  const imageMatch = outputFiles.find(f => f.startsWith(`pillar${pillar.id + 1}`) && (f.endsWith('.jpg') || f.endsWith('.png')));
  const imageFile = imageMatch ? path.join(__dirname, 'output', imageMatch) : null;

  if (!fs.existsSync(postFile)) {
    console.error(`Missing post text file: ${postFile}`);
    process.exit(1);
  }

  const postText = fs.readFileSync(postFile, 'utf8').replace(/^\uFEFF/, '');
  console.log(`Post loaded (${postText.split(/\s+/).length} words).`);
  if (imageFile) console.log(`Infographic visual: ${path.basename(imageFile)}`);

  console.log('\n[1/4] Launching headless browser on GitHub runner...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  });

  const cookies = [
    {
      name: 'li_at',
      value: liAt,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: true,
      secure: true
    }
  ];

  if (jsessionId) {
    cookies.push({
      name: 'JSESSIONID',
      value: jsessionId,
      domain: '.linkedin.com',
      path: '/',
      secure: true
    });
  }

  await context.addCookies(cookies);
  const page = await context.newPage();

  console.log('[2/4] Navigating to LinkedIn...');
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  const currentUrl = page.url();
  console.log('Current URL on cloud runner:', currentUrl);

  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
    console.error('Authentication expired or checkpoint triggered. Check your LI_AT secret.');
    await page.screenshot({ path: path.join(__dirname, 'output', 'github_auth_failed.png') });
    await browser.close();
    process.exit(1);
  }

  try {
    console.log('[3/4] Locating Photo button to attach infographic...');
    const photoTrigger = await page.waitForSelector(
      "button:has-text('Photo'), div[role='button']:has-text('Photo'), button[aria-label*='photo' i], button.share-box-feed-entry__trigger, button:has-text('Start a post')",
      { timeout: 25000 }
    );

    if (imageFile && fs.existsSync(imageFile)) {
      console.log('Uploading infographic file...');
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        photoTrigger.click()
      ]);
      await fileChooser.setFiles(imageFile);
      console.log('Image sent to LinkedIn! Waiting for photo editor modal...');
      await page.waitForTimeout(4000);

      // Confirm in photo modal via "Next" button
      const nextBtn = await page.waitForSelector("button:has-text('Next'), button.share-box-footer__primary-btn", { timeout: 15000 });
      await nextBtn.click();
      console.log('Clicked "Next". Infographic attached in composer!');
      await page.waitForTimeout(3000);
    } else {
      await photoTrigger.click();
      await page.waitForTimeout(2500);
    }

    // Insert post text into composer
    console.log('[4/4] Inserting post text into composer...');
    const editor = await page.waitForSelector("div.ql-editor[role='textbox'], div[role='textbox']", { timeout: 15000 });
    await editor.click();
    await page.keyboard.insertText(postText);
    console.log('Post text inserted.');
    await page.waitForTimeout(2500);

    // Publish post
    console.log('Publishing post and infographic...');
    const postBtn = await page.waitForSelector("button.share-actions__primary-action, button:has-text('Post')", { timeout: 10000 });
    await postBtn.click();
    console.log('Post button clicked! Waiting 8s for submission to finalize...');
    await page.waitForTimeout(8000);

    const confirmShot = path.join(__dirname, 'output', 'github_run_confirmation.png');
    await page.screenshot({ path: confirmShot });
    console.log('Confirmation screenshot saved to:', confirmShot);

    // Advance pillar rotation index
    config.current_pillar_index = (activeIndex + 1) % config.pillars.length;
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');

    console.log('\n====================================================');
    console.log(' SUCCESS: Content and Infographic published via GitHub Actions!');
    console.log(` Next cycle scheduled: Pillar ${config.current_pillar_index + 1}: "${config.pillars[config.current_pillar_index].name}"`);
    console.log('====================================================\n');
  } catch (err) {
    console.error('Error during cloud run:', err.message);
    await page.screenshot({ path: path.join(__dirname, 'output', 'github_error.png') }).catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runOnGitHub();
