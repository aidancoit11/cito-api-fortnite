import { Page } from 'playwright';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { Jimp } from 'jimp';

/**
 * Captcha Solver v3 - Handles BOTH types
 *
 * IMAGE SELECTION (3x3 grid): Claude Vision API - good at object recognition
 * DRAG-DROP (shapes): Jimp-based Shape Matching - FREE
 *
 * Falls back to 2Captcha if both fail.
 */

// Logging helper
function log(message: string, level: 'info' | 'success' | 'warn' | 'error' | 'debug' = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const icons: Record<string, string> = {
    info: '📋', success: '✅', warn: '⚠️', error: '❌', debug: '🔍',
  };
  const colors: Record<string, string> = {
    info: '\x1b[36m', success: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[35m',
  };
  const reset = '\x1b[0m';
  console.log(`${colors[level]}[${timestamp}] ${icons[level]} ${message}${reset}`);
}

interface ShapeSolution {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  confidence: number;
}

interface Shape {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixels: boolean[][];  // Binary mask of the shape
  area: number;
}

/**
 * Extract shapes from a binary image using flood fill
 */
function extractShapes(bitmap: { width: number; height: number; data: Buffer }, threshold: number): Shape[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const visited = new Array(height).fill(null).map(() => new Array(width).fill(false));
  const shapes: Shape[] = [];

  // Convert to grayscale and threshold
  const binary: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    binary[y] = [];
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const gray = (bitmap.data[idx] + bitmap.data[idx + 1] + bitmap.data[idx + 2]) / 3;
      binary[y][x] = gray < threshold;  // Dark pixels are shapes
    }
  }

  // Flood fill to find connected components
  function floodFill(startX: number, startY: number): { minX: number; maxX: number; minY: number; maxY: number; pixels: [number, number][] } {
    const stack: [number, number][] = [[startX, startY]];
    const pixels: [number, number][] = [];
    let minX = startX, maxX = startX, minY = startY, maxY = startY;

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (visited[y][x] || !binary[y][x]) continue;

      visited[y][x] = true;
      pixels.push([x, y]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    return { minX, maxX, minY, maxY, pixels };
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!visited[y][x] && binary[y][x]) {
        const { minX, maxX, minY, maxY, pixels } = floodFill(x, y);
        const shapeWidth = maxX - minX + 1;
        const shapeHeight = maxY - minY + 1;
        const area = pixels.length;

        // Filter by size - ignore tiny noise and huge background
        if (area > 300 && shapeWidth > 15 && shapeHeight > 15 && shapeWidth < width * 0.8 && shapeHeight < height * 0.8) {
          // Create binary mask for the shape
          const mask: boolean[][] = new Array(shapeHeight).fill(null).map(() => new Array(shapeWidth).fill(false));
          for (const [px, py] of pixels) {
            mask[py - minY][px - minX] = true;
          }

          shapes.push({
            x: minX,
            y: minY,
            width: shapeWidth,
            height: shapeHeight,
            centerX: minX + shapeWidth / 2,
            centerY: minY + shapeHeight / 2,
            pixels: mask,
            area,
          });
        }
      }
    }
  }

  return shapes;
}

/**
 * Compare two shapes using Hu moments approximation
 * Returns a score where LOWER is BETTER (0 = perfect match)
 */
function compareShapes(shape1: Shape, shape2: Shape): number {
  // Normalize shapes to same size for comparison
  const size = 32;  // Compare at 32x32 resolution

  function resizeMask(mask: boolean[][], targetSize: number): boolean[][] {
    const srcH = mask.length;
    const srcW = mask[0].length;
    const result: boolean[][] = new Array(targetSize).fill(null).map(() => new Array(targetSize).fill(false));

    for (let y = 0; y < targetSize; y++) {
      for (let x = 0; x < targetSize; x++) {
        const srcX = Math.floor(x * srcW / targetSize);
        const srcY = Math.floor(y * srcH / targetSize);
        result[y][x] = mask[srcY]?.[srcX] || false;
      }
    }
    return result;
  }

  const mask1 = resizeMask(shape1.pixels, size);
  const mask2 = resizeMask(shape2.pixels, size);

  // Calculate moments for shape comparison
  function calculateMoments(mask: boolean[][]): { m00: number; m10: number; m01: number; m20: number; m02: number; m11: number } {
    let m00 = 0, m10 = 0, m01 = 0, m20 = 0, m02 = 0, m11 = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (mask[y][x]) {
          m00 += 1;
          m10 += x;
          m01 += y;
          m20 += x * x;
          m02 += y * y;
          m11 += x * y;
        }
      }
    }
    return { m00, m10, m01, m20, m02, m11 };
  }

  const mom1 = calculateMoments(mask1);
  const mom2 = calculateMoments(mask2);

  if (mom1.m00 === 0 || mom2.m00 === 0) return Infinity;

  // Calculate central moments (translation invariant)
  const cx1 = mom1.m10 / mom1.m00;
  const cy1 = mom1.m01 / mom1.m00;
  const cx2 = mom2.m10 / mom2.m00;
  const cy2 = mom2.m01 / mom2.m00;

  function centralMoment(mask: boolean[][], cx: number, cy: number, p: number, q: number): number {
    let sum = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (mask[y][x]) {
          sum += Math.pow(x - cx, p) * Math.pow(y - cy, q);
        }
      }
    }
    return sum;
  }

  // Normalized central moments (scale invariant)
  const mu20_1 = centralMoment(mask1, cx1, cy1, 2, 0) / Math.pow(mom1.m00, 2);
  const mu02_1 = centralMoment(mask1, cx1, cy1, 0, 2) / Math.pow(mom1.m00, 2);
  const mu11_1 = centralMoment(mask1, cx1, cy1, 1, 1) / Math.pow(mom1.m00, 2);

  const mu20_2 = centralMoment(mask2, cx2, cy2, 2, 0) / Math.pow(mom2.m00, 2);
  const mu02_2 = centralMoment(mask2, cx2, cy2, 0, 2) / Math.pow(mom2.m00, 2);
  const mu11_2 = centralMoment(mask2, cx2, cy2, 1, 1) / Math.pow(mom2.m00, 2);

  // Hu moment I1 (rotation invariant)
  const hu1_1 = mu20_1 + mu02_1;
  const hu1_2 = mu20_2 + mu02_2;

  // Hu moment I2
  const hu2_1 = Math.pow(mu20_1 - mu02_1, 2) + 4 * Math.pow(mu11_1, 2);
  const hu2_2 = Math.pow(mu20_2 - mu02_2, 2) + 4 * Math.pow(mu11_2, 2);

  // Compare using log-transformed Hu moments
  const sign = (x: number) => x >= 0 ? 1 : -1;
  const logHu = (h: number) => h === 0 ? 0 : sign(h) * Math.log10(Math.abs(h));

  const diff1 = Math.abs(logHu(hu1_1) - logHu(hu1_2));
  const diff2 = Math.abs(logHu(hu2_1) - logHu(hu2_2));

  // Also add area ratio penalty
  const areaRatio = Math.min(shape1.area, shape2.area) / Math.max(shape1.area, shape2.area);
  const areaPenalty = 1 - areaRatio;

  return diff1 + diff2 + areaPenalty * 0.5;
}

/**
 * Jimp-based Shape Solver (FREE)
 *
 * Algorithm:
 * 1. Crop to iframe area
 * 2. Split into left (pieces) and right (targets)
 * 3. Extract shapes using flood fill
 * 4. Compare shapes using Hu moments
 * 5. Return best match coordinates
 */
async function cvShapeSolver(
  screenshotBuffer: Buffer,
  iframeBounds: { x: number; y: number; width: number; height: number }
): Promise<ShapeSolution> {
  log('STEP 1: Jimp Shape Matching (FREE)...', 'info');

  const image = await Jimp.read(screenshotBuffer);
  const width = image.bitmap.width;
  const height = image.bitmap.height;

  log(`Screenshot: ${width}x${height}`, 'debug');

  // Crop to iframe area
  const iframeX = Math.max(0, Math.round(iframeBounds.x));
  const iframeY = Math.max(0, Math.round(iframeBounds.y));
  const iframeW = Math.min(Math.round(iframeBounds.width), width - iframeX);
  const iframeH = Math.min(Math.round(iframeBounds.height), height - iframeY);

  log(`Iframe: (${iframeX}, ${iframeY}) ${iframeW}x${iframeH}`, 'debug');

  const iframeImage = image.clone().crop({ x: iframeX, y: iframeY, w: iframeW, h: iframeH });

  // Split: left has piece (~40%), right has targets (~60%)
  const splitPoint = Math.round(iframeW * 0.4);

  const leftImage = iframeImage.clone().crop({ x: 0, y: 0, w: splitPoint, h: iframeH });
  const rightImage = iframeImage.clone().crop({ x: splitPoint, y: 0, w: iframeW - splitPoint, h: iframeH });

  log(`Left: ${leftImage.bitmap.width}x${leftImage.bitmap.height}, Right: ${rightImage.bitmap.width}x${rightImage.bitmap.height}`, 'debug');

  // Extract shapes from both sides
  const leftShapes = extractShapes(leftImage.bitmap, 180);
  const rightShapes = extractShapes(rightImage.bitmap, 180);

  log(`Found ${leftShapes.length} pieces, ${rightShapes.length} targets`, 'info');

  if (leftShapes.length === 0) {
    throw new Error('No draggable piece found on left side');
  }
  if (rightShapes.length === 0) {
    throw new Error('No target shapes found on right side');
  }

  // Find the main piece (usually the largest distinct shape on left)
  // Sort by area descending
  leftShapes.sort((a, b) => b.area - a.area);
  const piece = leftShapes[0];
  log(`Piece: ${piece.width}x${piece.height} at (${Math.round(piece.centerX)}, ${Math.round(piece.centerY)}), area=${piece.area}`, 'debug');

  // Compare piece to all targets
  let bestMatch = { targetIdx: 0, score: Infinity };

  for (let t = 0; t < rightShapes.length; t++) {
    const target = rightShapes[t];
    const score = compareShapes(piece, target);
    log(`vs Target ${t} (${target.width}x${target.height}, area=${target.area}): score=${score.toFixed(4)}`, 'debug');

    if (score < bestMatch.score) {
      bestMatch = { targetIdx: t, score };
    }
  }

  const target = rightShapes[bestMatch.targetIdx];
  const confidence = Math.max(0, 1 - bestMatch.score / 2);  // Convert to 0-1 scale

  log(`Best match: Target ${bestMatch.targetIdx} (confidence: ${(confidence * 100).toFixed(1)}%)`, 'success');

  // Calculate absolute coordinates
  // FROM: center of piece in left side + iframe offset
  const fromX = iframeX + piece.centerX;
  const fromY = iframeY + piece.centerY;

  // TO: center of target in right side + split offset + iframe offset
  const toX = iframeX + splitPoint + target.centerX;
  const toY = iframeY + target.centerY;

  log(`Drag: (${Math.round(fromX)}, ${Math.round(fromY)}) -> (${Math.round(toX)}, ${Math.round(toY)})`, 'success');

  return {
    fromX,
    fromY,
    toX,
    toY,
    confidence,
  };
}

/**
 * IMAGE SELECTION: Claude Vision API
 * Claude is GOOD at identifying objects ("drums", "cats", "bicycles", etc.)
 */
async function claudeImageSelection(
  screenshotBuffer: Buffer,
  iframeBounds: { x: number; y: number; width: number; height: number }
): Promise<number[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  log('Using Claude Vision for image selection...', 'info');

  const anthropic = new Anthropic({ apiKey });
  const base64Image = screenshotBuffer.toString('base64');

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: `This is an hCaptcha with a 3x3 grid of images.
Read the prompt at the top (e.g., "Select the item that can play melodies").

Images are numbered 1-9:
[1] [2] [3]
[4] [5] [6]
[7] [8] [9]

Return ONLY a JSON array of image numbers that match the prompt.
Example: [5] or [2, 5, 8]

RESPOND WITH ONLY THE JSON ARRAY:`,
          },
        ],
      },
    ],
  });

  const response = message.content[0].type === 'text' ? message.content[0].text : '';
  log(`Claude response: ${response}`, 'debug');

  const match = response.match(/\[[\d,\s]*\]/);
  if (!match) {
    throw new Error('Could not parse response');
  }

  const selected: number[] = JSON.parse(match[0]);
  log(`Selected images: ${selected.join(', ')}`, 'success');

  return selected;
}

/**
 * Click selected images in 3x3 grid
 */
async function clickGridImages(
  page: Page,
  selectedImages: number[],
  iframeBounds: { x: number; y: number; width: number; height: number }
): Promise<void> {
  // Grid: 300x300 total, 100x100 per cell
  // Header: ~140px, grid is centered
  const gridOffsetTop = 140;
  const gridOffsetLeft = (iframeBounds.width - 300) / 2;
  const cellSize = 100;

  for (const num of selectedImages) {
    const row = Math.floor((num - 1) / 3);
    const col = (num - 1) % 3;

    const x = iframeBounds.x + gridOffsetLeft + (col * cellSize) + (cellSize / 2);
    const y = iframeBounds.y + gridOffsetTop + (row * cellSize) + (cellSize / 2);

    log(`Clicking image ${num} at (${Math.round(x)}, ${Math.round(y)})`, 'info');
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
  }

  // Click submit/verify button
  await page.waitForTimeout(500);
  const submitX = iframeBounds.x + iframeBounds.width - 80;
  const submitY = iframeBounds.y + iframeBounds.height - 35;
  await page.mouse.click(submitX, submitY);
  log('Clicked submit', 'success');
}

/**
 * Detect captcha type from screenshot
 */
async function detectCaptchaType(screenshotBuffer: Buffer): Promise<'image_selection' | 'drag_drop'> {
  // Check for "Move" button text which indicates drag-drop
  // For now, use a simple heuristic - check image content

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return 'drag_drop'; // Default
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const base64Image = screenshotBuffer.toString('base64');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: base64Image },
            },
            {
              type: 'text',
              text: 'Is this a 3x3 GRID of images to select, or a DRAG puzzle with shapes? Reply: GRID or DRAG',
            },
          ],
        },
      ],
    });

    const response = message.content[0].type === 'text' ? message.content[0].text : '';
    log(`Type detection: ${response}`, 'debug');

    return response.toUpperCase().includes('GRID') ? 'image_selection' : 'drag_drop';
  } catch {
    return 'drag_drop';
  }
}

/**
 * 2Captcha Coordinates Fallback (for drag-drop)
 */
async function twoCaptchaCoordinates(screenshotBuffer: Buffer): Promise<ShapeSolution> {
  const apiKey = process.env['2CAPTCHA_API_KEY'];

  if (!apiKey) {
    throw new Error('2CAPTCHA_API_KEY not set - add it for fallback solving');
  }

  log('STEP 2: 2Captcha Coordinates API (fallback)...', 'info');

  const base64Image = screenshotBuffer.toString('base64');

  // Submit to 2Captcha
  const submitResponse = await axios.post('https://2captcha.com/in.php', null, {
    params: {
      key: apiKey,
      method: 'base64',
      coordinatescaptcha: 1,
      body: base64Image,
      textinstructions: 'Click TWO points: 1) FIRST click CENTER of draggable piece (near "Move" button). 2) SECOND click CENTER of matching target shape.',
      json: 1,
    },
  });

  if (submitResponse.data.status !== 1) {
    throw new Error(`2Captcha submit failed: ${submitResponse.data.request}`);
  }

  const captchaId = submitResponse.data.request;
  log(`Submitted to 2Captcha, ID: ${captchaId}`, 'success');
  log('Waiting for human workers (10-30 sec)...', 'info');

  // Poll for result
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const resultResponse = await axios.get('https://2captcha.com/res.php', {
      params: { key: apiKey, action: 'get', id: captchaId, json: 1 },
    });

    if (resultResponse.data.status === 1) {
      const result = resultResponse.data.request;
      log(`2Captcha result: ${result}`, 'success');

      // Parse: "coordinates:x=123,y=456;x=789,y=012" or "x=123,y=456;x=789,y=012"
      const coordStr = result.replace('coordinates:', '').replace('OK|', '');
      const points = coordStr.split(';').map((point: string) => ({
        x: parseInt(point.match(/x=(\d+)/)?.[1] || '0'),
        y: parseInt(point.match(/y=(\d+)/)?.[1] || '0'),
      }));

      if (points.length >= 2) {
        return {
          fromX: points[0].x,
          fromY: points[0].y,
          toX: points[1].x,
          toY: points[1].y,
          confidence: 0.95, // Human workers are reliable
        };
      }
      throw new Error('Invalid coordinate response');
    }

    if (resultResponse.data.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`2Captcha error: ${resultResponse.data.request}`);
    }

    log(`Waiting... (${i + 1}/30)`, 'debug');
  }

  throw new Error('2Captcha timeout');
}

/**
 * Execute drag operation
 */
async function executeDrag(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  log(`Executing drag: (${Math.round(fromX)}, ${Math.round(fromY)}) → (${Math.round(toX)}, ${Math.round(toY)})`, 'info');

  await page.mouse.move(fromX, fromY);
  await page.waitForTimeout(200);

  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(100);

  // Smooth drag in steps
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    await page.mouse.move(
      fromX + (toX - fromX) * progress,
      fromY + (toY - fromY) * progress
    );
    await page.waitForTimeout(15);
  }

  await page.mouse.move(toX, toY);
  await page.waitForTimeout(150);

  await page.mouse.up({ button: 'left' });
  log('Drag complete', 'success');
}

/**
 * Get iframe bounds
 */
async function getIframeBounds(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const selectors = [
    'iframe[src*="hcaptcha.com"][src*="getcaptcha"]',
    'iframe[src*="newassets.hcaptcha.com"]',
    'iframe[src*="hcaptcha"][title*="challenge"]',
  ];

  for (const selector of selectors) {
    try {
      const iframe = await page.$(selector);
      if (iframe && await iframe.isVisible().catch(() => false)) {
        const bounds = await iframe.boundingBox();
        if (bounds && bounds.width > 100) {
          log(`Iframe at (${Math.round(bounds.x)}, ${Math.round(bounds.y)}) ${Math.round(bounds.width)}x${Math.round(bounds.height)}`, 'success');
          return bounds;
        }
      }
    } catch { /* try next */ }
  }

  const vp = page.viewportSize() || { width: 1280, height: 800 };
  return { x: 0, y: 0, width: vp.width, height: vp.height };
}

/**
 * MAIN SOLVER - Handles both IMAGE SELECTION and DRAG-DROP
 */
export async function solveCaptcha(page: Page): Promise<void> {
  console.log('');
  console.log('\x1b[36m═══════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[36m🤖 CAPTCHA SOLVER v3 - Grid + Drag Support\x1b[0m');
  console.log('\x1b[36m═══════════════════════════════════════════════════════\x1b[0m');
  console.log('');

  try {
    // Wait for challenge
    log('Waiting for captcha challenge...', 'info');

    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const iframe = await page.$('iframe[src*="hcaptcha"][src*="getcaptcha"], iframe[src*="hcaptcha"][title*="challenge"]');
      if (iframe && await iframe.isVisible().catch(() => false)) {
        log('Challenge iframe found', 'success');
        break;
      }
      if (i === 9) {
        log('No challenge found - might be already solved', 'warn');
        return;
      }
    }

    // Wait for images to load
    await page.waitForTimeout(3000);

    // Get iframe bounds
    const iframeBounds = await getIframeBounds(page);

    // Take screenshot
    log('Taking screenshot...', 'info');
    const screenshot = await page.screenshot({ fullPage: false });

    // Save debug image
    const fs = await import('fs');
    fs.writeFileSync('captcha-debug.png', screenshot);
    log('Debug: captcha-debug.png', 'debug');

    // Detect captcha type
    log('Detecting captcha type...', 'info');
    const captchaType = await detectCaptchaType(screenshot);
    log(`Captcha type: ${captchaType}`, 'success');

    if (captchaType === 'image_selection') {
      // ===== IMAGE SELECTION (3x3 grid) =====
      // Use Claude Vision - it's GOOD at object recognition
      try {
        const selectedImages = await claudeImageSelection(screenshot, iframeBounds);
        await clickGridImages(page, selectedImages, iframeBounds);
        await page.waitForTimeout(2000);
        log('Image selection complete', 'success');
      } catch (error: any) {
        log(`Image selection failed: ${error.message}`, 'error');
        throw error;
      }

    } else {
      // ===== DRAG-DROP (shapes) =====
      let solution: ShapeSolution | null = null;

      // Try Jimp shape matching first (FREE)
      try {
        solution = await cvShapeSolver(screenshot, iframeBounds);

        if (solution.confidence >= 0.5) {
          log(`Shape match confidence: ${(solution.confidence * 100).toFixed(1)}% - using it`, 'success');
        } else {
          log(`Shape match confidence too low: ${(solution.confidence * 100).toFixed(1)}%`, 'warn');
          solution = null;
        }
      } catch (error: any) {
        log(`Shape matching failed: ${error.message}`, 'error');
      }

      // Fallback to 2Captcha
      if (!solution) {
        const apiKey = process.env['2CAPTCHA_API_KEY'];

        if (apiKey) {
          try {
            solution = await twoCaptchaCoordinates(screenshot);
          } catch (error: any) {
            log(`2Captcha failed: ${error.message}`, 'error');
          }
        } else {
          log('No 2CAPTCHA_API_KEY - manual solve required', 'warn');
          log('👉 SOLVE THE CAPTCHA MANUALLY', 'warn');
          await page.waitForURL((url) => url.href.includes('code='), { timeout: 300000 });
          log('Solved manually', 'success');
          return;
        }
      }

      if (!solution) {
        throw new Error('All drag-drop solving methods failed');
      }

      await executeDrag(page, solution.fromX, solution.fromY, solution.toX, solution.toY);
      await page.waitForTimeout(2000);
      log('Drag-drop complete', 'success');
    }

    console.log('');
    log('CAPTCHA ATTEMPT COMPLETE', 'success');
    console.log('');

  } catch (error: any) {
    console.log('');
    log(`CAPTCHA FAILED: ${error.message}`, 'error');
    console.log('');
    throw error;
  }
}
