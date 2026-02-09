import { chromium, type Page, type BrowserContext } from 'playwright'
import { generateCommentary, extractRanking } from './ai'
import * as fs from 'fs'
import * as path from 'path'

interface PlayerInput {
  name: string
  useShield: boolean
}

interface RaceWorkerResult {
  rawRanking: { rank: number; name: string }[]
  videoUrl: string | null
  commentaries: { timestamp: number; content: string }[]
}

/**
 * Simulates a duck race when Playwright automation is not available
 * (e.g., when running without Docker/Xvfb)
 */
async function simulateRace(players: PlayerInput[]): Promise<RaceWorkerResult> {
  console.log('🦆 Running simulated race (no browser)...')
  
  const commentaries: { timestamp: number; content: string }[] = []
  const shuffled = [...players].sort(() => Math.random() - 0.5)
  
  // Simulate commentary
  const comments = [
    `Cuộc đua bắt đầu! Các chú vịt đang chen nhau ở vạch xuất phát!`,
    `${shuffled[0]?.name} đang dẫn đầu một cách bất ngờ! ${shuffled[shuffled.length - 1]?.name} đang tụt lại phía sau.`,
    `Cuộc đua đang rất gay cấn! ${shuffled[1]?.name} đang cố vượt lên!`,
    `Gần tới đích rồi! ${shuffled[0]?.name} vẫn giữ vững phong độ!`,
    `KẾT THÚC! Cuộc đua vừa kết thúc với kết quả đầy bất ngờ!`,
  ]

  for (let i = 0; i < comments.length; i++) {
    commentaries.push({
      timestamp: i * 8,
      content: comments[i],
    })
  }

  // Generate ranking
  const rawRanking = shuffled.map((p, idx) => ({
    rank: idx + 1,
    name: p.name,
  }))

  return {
    rawRanking,
    videoUrl: null,
    commentaries,
  }
}

/**
 * Main race worker - automates the duck race on online-stopwatch.com
 */
export async function runRaceWorker(players: PlayerInput[]): Promise<RaceWorkerResult> {
  // Check if we should simulate (no browser available)
  const shouldSimulate = process.env.SIMULATE_RACE === 'true' || 
                         process.env.NODE_ENV === 'development'
  
  if (shouldSimulate) {
    return simulateRace(players)
  }

  // Ensure video directory exists
  const videoDir = path.join(process.cwd(), 'tmp', 'videos')
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true })
  }

  let browser
  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    console.log('🦆 Launching browser for duck race...')
    
    browser = await chromium.launch({
      headless: false, // Needs Xvfb on server
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
      ],
    })

    context = await browser.newContext({
      recordVideo: {
        dir: videoDir,
        size: { width: 1280, height: 720 },
      },
      viewport: { width: 1280, height: 720 },
    })

    page = await context.newPage()

    // Navigate to duck race
    console.log('Navigating to duck race...')
    await page.goto('https://www.online-stopwatch.com/duck-race/full-screen/', {
      waitUntil: 'networkidle',
      timeout: 30000,
    })

    // Wait for the page to load
    await page.waitForTimeout(3000)

    // Handle potential cookie/ad overlays
    try {
      const consentBtn = page.locator('button:has-text("Accept"), button:has-text("I agree"), .fc-cta-consent')
      if (await consentBtn.isVisible({ timeout: 3000 })) {
        await consentBtn.click()
        await page.waitForTimeout(1000)
      }
    } catch {
      // No consent dialog
    }

    // The duck race page might use iframes - try to find the game
    // First, try working directly on the page
    let gameContext: Page | ReturnType<typeof page.frameLocator> = page

    // Look for settings/edit button to enter names
    console.log('Setting up players...')
    
    // Try to find the names input area
    // The exact selectors depend on the actual page structure
    // These are educated guesses based on common patterns
    try {
      // Click on settings/gear icon or edit names button
      const setupSelectors = [
        'text=Edit Names',
        'text=Settings',
        '.settings-button',
        'button[title="Settings"]',
        '#settingsButton',
        '.gear-icon',
      ]

      for (const selector of setupSelectors) {
        try {
          const el = page.locator(selector).first()
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click()
            await page.waitForTimeout(500)
            break
          }
        } catch {
          continue
        }
      }

      // Enter player names
      const namesString = players.map((p) => p.name).join('\n')
      const inputSelectors = [
        'textarea',
        'input[type="text"]',
        '.names-input',
        '#names',
      ]

      for (const selector of inputSelectors) {
        try {
          const el = page.locator(selector).first()
          if (await el.isVisible({ timeout: 2000 })) {
            await el.fill(namesString)
            await page.waitForTimeout(500)
            break
          }
        } catch {
          continue
        }
      }

      // Confirm/Save names
      const confirmSelectors = [
        'text=OK',
        'text=Save',
        'text=Confirm',
        'text=Done',
        'button[type="submit"]',
      ]

      for (const selector of confirmSelectors) {
        try {
          const el = page.locator(selector).first()
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click()
            await page.waitForTimeout(1000)
            break
          }
        } catch {
          continue
        }
      }
    } catch (error) {
      console.error('Failed to set up player names:', error)
    }

    // Start the race
    console.log('Starting race...')
    const startSelectors = [
      'text=Start',
      'text=GO',
      '.start-button',
      '#startButton',
      'button.start',
    ]

    for (const selector of startSelectors) {
      try {
        const el = page.locator(selector).first()
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click()
          break
        }
      } catch {
        continue
      }
    }

    // Commentary loop
    const commentaries: { timestamp: number; content: string }[] = []
    const startTime = Date.now()
    let raceOngoing = true
    let checkCount = 0
    const maxChecks = 30 // Max ~2.5 minutes

    console.log('Race is running! Starting commentary...')

    while (raceOngoing && checkCount < maxChecks) {
      await page.waitForTimeout(5000) // Check every 5 seconds
      checkCount++

      // Check if race finished (look for results/finish indicators)
      try {
        const finishSelectors = [
          'text=Results',
          'text=Finished',
          '.results',
          '.race-results',
          '.winner',
        ]

        for (const selector of finishSelectors) {
          const el = page.locator(selector).first()
          if (await el.isVisible({ timeout: 500 })) {
            raceOngoing = false
            break
          }
        }
      } catch {
        // Race still ongoing
      }

      // Take screenshot for commentary (every 10 seconds)
      if (raceOngoing && checkCount % 2 === 0) {
        try {
          const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 70 })
          const base64 = screenshotBuf.toString('base64')
          const comment = await generateCommentary(base64)
          const timestamp = Math.floor((Date.now() - startTime) / 1000)
          commentaries.push({ timestamp, content: comment })
          console.log(`[${timestamp}s] ${comment}`)
        } catch (error) {
          console.error('Commentary generation failed:', error)
        }
      }
    }

    console.log('Race finished! Extracting results...')
    await page.waitForTimeout(2000) // Wait for animation to settle

    // Take final screenshot for result extraction
    const finalScreenshot = await page.screenshot({ type: 'jpeg', quality: 90, fullPage: true })
    const finalBase64 = finalScreenshot.toString('base64')

    let rawRanking: { rank: number; name: string }[]
    try {
      rawRanking = await extractRanking(finalBase64)
    } catch {
      // Fallback: create ranking from player order if AI fails
      console.error('AI ranking extraction failed, using random order')
      rawRanking = players.map((p, idx) => ({
        rank: idx + 1,
        name: p.name,
      }))
    }

    // Close and get video
    await page.close()
    const videoPath = await page.video()?.path()
    await context.close()
    await browser.close()

    // TODO: Upload video to S3/R2 and return URL
    // For now, return local path
    const videoUrl = videoPath || null

    return {
      rawRanking,
      videoUrl,
      commentaries,
    }
  } catch (error) {
    console.error('Race worker failed:', error)
    if (browser) await browser.close()

    // Fallback to simulation
    return simulateRace(players)
  }
}
