import { chromium, type Page, type BrowserContext, type Frame } from 'playwright'
import { generateCommentary } from './ai'
import { generateZaiCommentary } from './ai-zai'
import { recordCommentary, waitForCommentaryAndCleanup } from './commentary-manager'
import { uploadVideoToR2 } from './r2-upload'
import { raceEventBus, RACE_EVENTS } from './event-bus'
import * as fs from 'fs'
import * as path from 'path'

interface PlayerInput {
  name: string
  useShield: boolean
}

interface RaceWorkerResult {
  rawRanking: { rank: number; name: string }[]
  videoUrl: string | null
  commentaryJobsQueued: number // Number of jobs queued for async processing
}

/**
 * Simulates a duck race when Playwright automation is not available
 */
async function simulateRace(players: PlayerInput[]): Promise<RaceWorkerResult> {
  console.log('🦆 Running simulated race (no browser)...')

  const commentaries: { timestamp: number; content: string }[] = []
  const shuffled = [...players].sort(() => Math.random() - 0.5)

  const comments = [
    `LIGHTS OUT! Các con dzịt lao ra khỏi vạch xuất phát!`,
    `${shuffled[0]?.name} đang dẫn đầu! ${shuffled[shuffled.length - 1]?.name} có nguy cơ thành con dzịt tuần này.`,
    `Gay cấn quá! ${shuffled[1]?.name} đang cố thoát kiếp dzịt!`,
    `Gần tới đích rồi! ${shuffled[0]?.name} vẫn giữ vững phong độ!`,
    `CHEQUERED FLAG! 2 con dzịt tuần này đã lộ diện!`,
  ]

  for (let i = 0; i < comments.length; i++) {
    commentaries.push({ timestamp: i * 8, content: comments[i] })
  }

  const rawRanking = shuffled.map((p, idx) => ({ rank: idx + 1, name: p.name }))

  return { rawRanking, videoUrl: null, commentaryJobsQueued: commentaries.length }
}

/**
 * Get the game iframe from the main page.
 * The duck race game lives inside iframe#fullframe.
 */
async function getGameFrame(page: Page): Promise<Frame> {
  // Wait for the fullframe iframe to appear
  await page.waitForSelector('#fullframe', { timeout: 15000 })
  const frame = page.frame('fullframe')
  if (!frame) throw new Error('Game frame #fullframe not found')
  return frame
}

/**
 * Open the settings panel by dispatching mousedown on the settings gear in canvas.
 * In the game: exportRoot.settings is the settings panel (an Adobe Animate MovieClip).
 * Clicking on the canvas area where the gear/settings is triggers gotoSettings().
 */
async function openSettings(frame: Frame): Promise<void> {
  // The settings gear is part of the canvas. We trigger it via JS:
  // exportRoot.settings is already accessible; we call the show() method on the Settings instance.
  // However, the Settings instance is a local var inside Main(). 
  // Alternative: dispatch mousedown on exportRoot.settings which triggers gotoSettings().
  await frame.evaluate(() => {
    const win = window as any
    // The settings MC covers the bottom portion. Dispatch click on it to open.
    if (win.exportRoot?.settings) {
      win.exportRoot.settings.visible = true
      win.exportRoot.settings.dispatchEvent('mousedown')
    }
  })
  await frame.page().waitForTimeout(500)
}

/**
 * Switch to Names tab and fill in player names.
 * The game has a textarea#namesList in the DOM that gets shown when "Names" tab is active.
 * We can directly manipulate it + trigger the tab switch via canvas.
 */
async function setPlayerNames(frame: Frame, names: string[]): Promise<void> {
  const page = frame.page()

  // Step 1: Open settings by clicking the gear area on canvas
  // The settings panel is triggered by clicking on exportRoot.settings area
  console.log('  Opening settings panel...')
  await frame.evaluate(() => {
    const win = window as any
    const root = win.exportRoot
    // Trigger the settings to show
    if (root.settings) {
      root.settings.visible = true
      // Click the settings gear - it's at the bottom of the canvas
      root.settings.dispatchEvent('mousedown')
    }
  })
  await page.waitForTimeout(1000)

  // Step 2: Switch to Names tab via canvas event
  console.log('  Switching to Names tab...')
  await frame.evaluate(() => {
    const win = window as any
    const root = win.exportRoot
    // The tab buttons: exportRoot.settings.list.tabNames / tabNumbers
    if (root.settings?.list?.tabNames) {
      root.settings.list.tabNames.dispatchEvent('mousedown')
    }
  })
  await page.waitForTimeout(1000)

  // Step 3: Fill the textarea#namesList (it's a real DOM element inside the iframe)
  console.log(`  Filling ${names.length} player names...`)
  const namesText = names.join('\n')

  // The textarea is inside the game iframe's DOM
  await frame.evaluate((text) => {
    const textarea = document.getElementById('namesList') as HTMLTextAreaElement
    if (textarea) {
      textarea.style.display = 'block'
      textarea.value = text
      // Trigger jQuery change event so the game picks up the names
      const $ = (window as any).$
      if ($) {
        $('#namesList').val(text).trigger('change').trigger('keyup')
      }
    }
  }, namesText)
  await page.waitForTimeout(500)

  // Step 4: Close settings / Apply (click back-to-timer)
  console.log('  Applying settings and closing...')
  await frame.evaluate(() => {
    const win = window as any
    const root = win.exportRoot
    // The back button: exportRoot.settings.back
    if (root.settings?.back) {
      root.settings.back.dispatchEvent('mousedown')
    }
  })
  await page.waitForTimeout(2000) // Wait for characters to be rebuilt
}

/**
 * Start the race by dispatching mousedown on the Start button.
 * The Start button is exportRoot.timer.bStart in the canvas.
 */
async function startRace(frame: Frame): Promise<void> {
  console.log('  Clicking Start button...')
  await frame.evaluate(() => {
    const win = window as any
    const root = win.exportRoot
    if (root.timer?.bStart) {
      root.timer.bStart.dispatchEvent('mousedown')
    }
  })
}

/**
 * Check if the race has finished.
 * The race is finished when exportRoot.winOrder becomes visible.
 */
async function isRaceFinished(frame: Frame): Promise<boolean> {
  return await frame.evaluate(() => {
    const win = window as any
    const root = win.exportRoot
    return root?.winOrder?.visible === true && root?.winOrder?.alpha > 0.5
  })
}

/**
 * Extract the final ranking from the game's internal state.
 * finishCharacters[] is the ordered array of ducks that crossed the finish line.
 * We can also extract from the #listwinners DOM element.
 */
async function extractRankingFromGame(frame: Frame): Promise<{ rank: number; name: string }[]> {
  // Try to get ranking from the game's JS state
  const ranking = await frame.evaluate(() => {
    const win = window as any

    // Method 1: Read from #listwinners HTML
    const listDiv = document.getElementById('listwinners')
    if (listDiv && listDiv.innerHTML.trim().length > 0) {
      const rows = listDiv.querySelectorAll('tr, li, .winner-row, div')
      const results: { rank: number; name: string }[] = []
      rows.forEach((row, i) => {
        const text = row.textContent?.trim()
        if (text && text.length > 0 && text.length < 100) {
          // Parse "1. Name" or "1 Name" patterns
          const match = text.match(/(\d+)[\.\)\s]+(.+)/)
          if (match) {
            results.push({ rank: parseInt(match[1]), name: match[2].trim() })
          } else if (text.length > 1) {
            results.push({ rank: i + 1, name: text })
          }
        }
      })
      if (results.length > 0) return results
    }

    // Method 2: Read listwinners innerHTML as text
    if (listDiv) {
      const html = listDiv.innerHTML
      // The list often contains entries like "1st: Name" or numbered lines
      const lines = html.replace(/<[^>]+>/g, '\n').split('\n').filter((l: string) => l.trim().length > 0)
      const results: { rank: number; name: string }[] = []
      let rank = 1
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length > 0 && trimmed.length < 80) {
          const match = trimmed.match(/^(\d+)[\.\)\s:]+(.+)/)
          if (match) {
            results.push({ rank: parseInt(match[1]), name: match[2].trim() })
          } else if (!trimmed.match(/^(position|rank|name|#|result)/i)) {
            results.push({ rank: rank++, name: trimmed })
          }
        }
      }
      if (results.length > 0) return results
    }

    return null
  })

  if (ranking && ranking.length > 0) {
    console.log('  Extracted ranking from game state:', ranking)
    return ranking
  }

  // If that fails, return null to trigger screenshot-based extraction
  throw new Error('Could not extract ranking from game state')
}

/**
 * Main race worker - automates the duck race on online-stopwatch.com
 * 
 * Architecture:
 * - The game runs inside iframe#fullframe (same-origin)
 * - The game is built with Adobe Animate + CreateJS (canvas-based)
 * - UI elements are canvas objects, but #namesList is a real textarea
 * - We interact via JS evaluation on the game's global objects:
 *   exportRoot, stage, Settings, Main, ListWinners etc.
 */
export async function runRaceWorker(players: PlayerInput[], raceId?: number): Promise<RaceWorkerResult> {
  const shouldSimulate = process.env.SIMULATE_RACE === 'true'

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
      headless: false, // Canvas needs a display (Xvfb on server, or headed on desktop)
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--autoplay-policy=no-user-gesture-required',
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

    // Start Live Stream via CDP (if raceId is present)
    if (raceId) {
      try {
        const client = await context.newCDPSession(page)
        console.log('🎥 Starting live stream CDP session...')

        await client.send('Page.startScreencast', {
          format: 'jpeg',
          quality: 80,
          maxWidth: 1280,
          maxHeight: 720,
          everyNthFrame: 1 // Capture every frame
        })

        client.on('Page.screencastFrame', async (payload) => {
          const { sessionId, data, metadata } = payload
          // Ack the frame to receive the next one
          await client.send('Page.screencastFrameAck', { sessionId })

          // Broadcast to event bus
          raceEventBus.emit(RACE_EVENTS.FRAME, {
            raceId,
            data,
            timestamp: metadata.timestamp
          })
        })
      } catch (e) {
        console.error('❌ Failed to start live stream:', e)
      }
    }

    // Navigate to duck race - use direct URL without iframe wrapper
    const numPlayers = players.length
    console.log('📍 Navigating to duck race...')
    await page.goto(`https://www.online-stopwatch.com/html5/race-timers-2025/duck-race-1000/?v=141125124133&ns=${numPlayers}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // Wait for the game to initialize (no iframe needed with direct URL)
    console.log('⏳ Waiting for game to initialize...')
    await page.waitForFunction(() => {
      const win = window as unknown as { exportRoot?: { settings?: unknown; timer?: unknown } }
      return win.exportRoot && win.exportRoot.settings && win.exportRoot.timer
    }, { timeout: 30000 })
    console.log('✅ Game engine initialized!')

    // Handle any cookie consent overlays on main page
    try {
      const consentBtn = page.locator('.fc-cta-consent, button:has-text("Accept"), button:has-text("I agree")')
      if (await consentBtn.isVisible({ timeout: 2000 })) {
        await consentBtn.first().click()
        await page.waitForTimeout(500)
      }
    } catch { /* no consent dialog */ }

    // === STEP 1: CONFIGURE TIMER (12 seconds) AND PLAYER NAMES ===
    console.log('📝 Opening settings...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const root = w.exportRoot
      root.settings.visible = true
      const gear = root.settings
      const evt = new w.createjs.MouseEvent('mousedown', false, false, 0, 0, null, -1, true, 0, 0)
      evt.currentTarget = gear
      gear.dispatchEvent(evt)
    })
    await page.waitForTimeout(1500)

    // Set timer to 36 seconds (digits: 3, 6)
    console.log('⏱️ Setting timer to 36 seconds...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const timer = w.exportRoot.settings.timer.oldWay
      const clickEvents = ['mousedown', 'pressup', 'click']
      // Click btn3 for "3"
      if (timer.btn3) {
        clickEvents.forEach(type => {
          timer.btn3.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
      // Click btn6 for "6"
      if (timer.btn6) {
        clickEvents.forEach(type => {
          timer.btn6.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    await page.waitForTimeout(500)

    // Switch to Names tab
    console.log('📝 Switching to Names tab...')
    const playerNames = players.map((p) => p.name)
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const list = w.exportRoot.settings.list
      const tab1 = list.tab1
      if (tab1) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          tab1.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    await page.waitForTimeout(1000)

    // Click Edit List button
    console.log('📝 Clicking Edit List...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const list = w.exportRoot.settings.list
      if (list.btn_editList) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          list.btn_editList.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    await page.waitForTimeout(1000)

    // Fill the textarea with player names
    console.log(`📝 Filling ${playerNames.length} player names...`)
    await page.evaluate((namesText) => {
      const el = document.getElementById('namesList') as HTMLTextAreaElement
      const $ = (window as any).$
      if (el) {
        el.style.display = 'block'
        el.value = namesText
        if ($) $('#namesList').val(namesText).trigger('change').trigger('keyup')
      }
    }, playerNames.join('\n'))
    await page.waitForTimeout(500)

    // Click Done button
    console.log('📝 Clicking Done to apply names...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const list = w.exportRoot.settings.list
      if (list.btn_done) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          list.btn_done.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    await page.waitForTimeout(1500)

    // NOW click Set to apply timer settings
    console.log('⏱️ Clicking Set to finalize timer...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const timer = w.exportRoot.settings.timer.oldWay
      if (timer.btnset) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          timer.btnset.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    await page.waitForTimeout(1000)

    // Close settings via back button
    console.log('📝 Closing settings...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const back = w.exportRoot.settings.back
      if (back) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          back.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    await page.waitForTimeout(1000)

    // Shuffle Characters to rebuild ducks with new names
    console.log('🔀 Shuffling characters...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const shuffle = w.exportRoot.bShuffle
      if (shuffle) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          shuffle.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    await page.waitForTimeout(1500)
    console.log(`✅ ${playerNames.length} players configured!`)

    // === STEP 2: START THE RACE ===
    console.log('🏁 Starting race...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const bStart = w.exportRoot.timer?.bStart
      if (bStart) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          bStart.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    console.log('✅ Race started!')

    // === STEP 3: COMMENTARY LOOP ===
    let commentaryJobsQueued = 0
    const startTime = Date.now()
    let raceFinished = false
    let checkCount = 0
    const maxChecks = 150 // Max ~45 seconds (0.3s * 150)

    // Timestamps to capture commentary (seconds) - 8 key moments across 36s race
    // 0: Start, 5: Early, 10: Building, 15: Mid, 20: Heating up, 25: Tension, 30: Final push, 33: Last seconds
    const CAPTURE_TIMESTAMPS = [0, 5, 10, 15, 20, 25, 30, 33]
    const capturedTimestamps = new Set<number>()

    console.log('🎙️ Race in progress, monitoring...')

    // IMMEDIATELY capture t=0 screenshot before the loop begins
    try {
      console.log('📸 Capturing screenshot for 0s mark (start)...')
      const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 70 })
      const base64 = screenshotBuf.toString('base64')
      if (raceId) {
        recordCommentary(raceId, 0, base64, false, playerNames.join(', '))
        commentaryJobsQueued++
        capturedTimestamps.add(0)
        console.log('  [0s] 📝 Queued for AI commentary')
      }
    } catch (error) {
      console.error('  t=0 screenshot failed:', error)
    }

    while (!raceFinished && checkCount < maxChecks) {
      await page.waitForTimeout(300) // Check every 300ms for precise timing
      checkCount++

      const elapsedSeconds = (Date.now() - startTime) / 1000

      // FIRST: Try to capture screenshots at specific timestamps (do this regardless of race state)
      let targetTimestamp: number | null = null
      for (const t of CAPTURE_TIMESTAMPS) {
        if (Math.abs(elapsedSeconds - t) < 1.0 && !capturedTimestamps.has(t)) {
          targetTimestamp = t
          break
        }
      }

      if (targetTimestamp !== null) {
        capturedTimestamps.add(targetTimestamp)
        try {
          console.log(`📸 Capturing screenshot for ${targetTimestamp}s mark...`)
          const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 70 })
          const base64 = screenshotBuf.toString('base64')

          // Queue for async AI commentary generation
          if (raceId) {
            recordCommentary(raceId, targetTimestamp, base64, false, playerNames.join(', '))
            commentaryJobsQueued++
            console.log(`  [${targetTimestamp}s] 📝 Queued for AI commentary`)
          } else {
            console.log(`  [${targetTimestamp}s] ⚠️ No raceId - skipping queue`)
          }
        } catch (error) {
          console.error('  Screenshot capture failed:', error)
        }
      }

      // THEN: Check if race finished
      try {
        raceFinished = await page.evaluate(() => {
          const win = window as unknown as { exportRoot?: { winOrder?: { visible: boolean; alpha: number } } }
          return win.exportRoot?.winOrder?.visible === true && (win.exportRoot?.winOrder?.alpha ?? 0) > 0.5
        })
      } catch {
        // Page might be busy, continue
      }
    }

    if (raceFinished) {
      console.log('🏁 Race finished detected!')
    }

    if (!raceFinished) {
      console.log('⚠️ Race timed out, proceeding with extraction...')
    }

    // Wait for finish animations to settle (increased for 36s race)
    await page.waitForTimeout(5000)

    // === STEP 4: EXTRACT RESULTS ===
    console.log('📊 Extracting race results...')

    // Click the trophy to show the results popup
    console.log('🏆 Clicking trophy to show results...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const winOrder = w.exportRoot.winOrder
      if (winOrder) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          winOrder.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    await page.waitForTimeout(3000)

    let rawRanking: { rank: number; name: string }[]

    // Extract from #resultsTable which contains the actual race results
    try {
      rawRanking = await page.evaluate(() => {
        const table = document.querySelector('#resultsTable')
        if (!table) throw new Error('No #resultsTable found')
        const rows = Array.from(table.querySelectorAll('tr'))
        if (rows.length === 0) throw new Error('No results in table')
        return rows.map((row, i) => {
          const cells = row.querySelectorAll('td')
          return {
            rank: i + 1,
            name: cells[1]?.textContent?.trim() || `Player ${i + 1}`
          }
        }).filter(r => r.name && r.name.length > 0)
      })
      console.log('✅ Ranking extracted from #resultsTable!')
    } catch (extractError) {
      // Fallback: use player order (random)
      console.log('  DOM extraction failed, using random order:', extractError)
      const shuffled = [...players].sort(() => Math.random() - 0.5)
      rawRanking = shuffled.map((p, idx) => ({ rank: idx + 1, name: p.name }))
    }

    // Queue FINAL commentary AFTER we have actual results
    try {
      console.log('📸 Capturing results screenshot for final commentary...')
      const resultsScreenshot = await page.screenshot({ type: 'jpeg', quality: 70 })
      const resultsBase64 = resultsScreenshot.toString('base64')
      const elapsed = (Date.now() - startTime) / 1000

      if (raceId) {
        // Enrich ranking with shield usage data for AI commentary
        const enrichedRanking = rawRanking.map(r => {
          const matched = players.find(p => p.name === r.name)
          return { ...r, usedShield: matched?.useShield ?? false }
        })
        const resultsJson = JSON.stringify(enrichedRanking)
        recordCommentary(raceId, Math.round(elapsed), resultsBase64, true, playerNames.join(', '), resultsJson)
        commentaryJobsQueued++
        console.log(`  [End] 📝 Queued final commentary with actual results: ${rawRanking.map(r => `#${r.rank} ${r.name}`).join(', ')}`)
      }
    } catch (error) {
      console.error('Final results commentary queue failed:', error)
    }

    // === STEP 5: CLEANUP & RETURN ===
    console.log('📹 Saving video...')
    const videoPath = await page.video()?.path()
    await page.close()
    await context.close()
    await browser.close()

    // Upload video to R2 if configured, otherwise keep local path
    let videoUrl: string | null = null
    if (videoPath && raceId) {
      videoUrl = await uploadVideoToR2(videoPath, raceId)
      if (!videoUrl) {
        // R2 not configured or upload failed, use local path
        videoUrl = videoPath
      }
    } else {
      videoUrl = videoPath || null
    }

    if (raceId) {
      await waitForCommentaryAndCleanup(raceId)
    }

    console.log('✅ Race worker complete!', { ranking: rawRanking, commentaryJobsQueued })

    return {
      rawRanking,
      videoUrl,
      commentaryJobsQueued,
    }
  } catch (error) {
    console.error('❌ Race worker failed:', error)
    if (page) {
      try {
        // Try to capture error screenshot
        await page.screenshot({ path: path.join(process.cwd(), 'tmp', 'error-screenshot.png') })
      } catch { /* ignore */ }
    }
    if (browser) {
      try { await browser.close() } catch { /* ignore */ }
    }

    // Fallback to simulation
    console.log('⚠️ Falling back to simulated race...')
    return simulateRace(players)
  }
}
