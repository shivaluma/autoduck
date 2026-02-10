/**
 * E2E Test: Real duck race automation  
 * Run: npx tsx scripts/test-race.ts
 *
 * Key insight: The game canvas is Adobe Animate + CreateJS.
 * Canvas buttons respond to CreateJS events, not native DOM events.
 * We must use createjs.MouseEvent or proper event dispatch.
 */
import { chromium } from 'playwright'
import { generateZaiCommentary } from '../lib/ai-zai'

// Duck race URL with exportRoot accessible (no iframe wrapper)
const GAME_URL = 'https://www.online-stopwatch.com/html5/race-timers-2025/duck-race-1000/?v=141125124133&ns=6'

async function main() {
  const names = ['Zịt Lợi', 'Zịt Minh', 'Zịt Tâm', 'Zịt Tân', 'Zịt Thanh', 'Zịt Tuấn']

  console.log('🦆 === AUTODUCK E2E TEST ===')
  console.log(`   Players: ${names.join(', ')}\n`)

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()

  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (!url.includes('online-stopwatch.com') && url.match(/doubleclick|googlesyndication|googleads|adservice|amazon-adsystem|adsafeprotected|ad-score|btloader|confiant|ingage\.tech/)) {
      return route.abort()
    }
    return route.continue()
  })

  try {
    console.log('1️⃣  Loading game...')
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(6000)

    console.log('2️⃣  Waiting for game engine...')
    await page.waitForFunction(() => {
      const w = window as any
      return w.exportRoot && w.exportRoot.settings && w.exportRoot.timer && w.stage
    }, { timeout: 30000 })
    console.log('   ✅ Game engine ready!')

    // === OPEN SETTINGS ===
    console.log('3️⃣  Opening settings...')
    await page.evaluate(() => {
      const w = window as any
      const root = w.exportRoot

      // Open settings panel
      root.settings.visible = true

      // The settings gear dispatches to gotoSettings() 
      // which calls settings.show()
      // We simulate this by clicking the gear MovieClip
      const gear = root.settings
      const evt = new w.createjs.MouseEvent('mousedown', false, false, 0, 0, null, -1, true, 0, 0)
      evt.currentTarget = gear
      gear.dispatchEvent(evt)
    })
    await page.waitForTimeout(1500)

    // === SET TIMER DIGITS (12 seconds) - DON'T close settings yet ===
    console.log('3b️⃣  Setting timer digits to 12...')
    await page.evaluate(() => {
      const w = window as unknown as { exportRoot: any; createjs: any }
      const timer = w.exportRoot.settings.timer.oldWay

      // Click 1 then 2 to set 00:00:12 (but don't click Set yet - that closes settings)
      const clickEvents = ['mousedown', 'pressup', 'click']

      // Click btn1
      if (timer.btn1) {
        clickEvents.forEach(type => {
          timer.btn1.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }

      // Click btn2
      if (timer.btn2) {
        clickEvents.forEach(type => {
          timer.btn2.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
      // Don't click btnset here - we'll do that after setting names
    })
    await page.waitForTimeout(500)
    console.log('   ✅ Timer digits entered (will apply after names)')

    // === SET NAMES ===
    console.log('4️⃣  Switching to Names tab...')
    await page.evaluate(() => {
      const w = window as any
      const root = w.exportRoot
      const list = root.settings.list

      // list.tab1 = Names tab (name="tab1"), list.tab0 = Numbers tab (name="tab0")
      const tab1 = list.tab1
      if (tab1) {
        // Dispatch all event types for reliability
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          const evt = new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null)
          tab1.dispatchEvent(evt)
        })
        console.log('Dispatched tab1 (Names) click')
      } else {
        console.error('tab1 not found!')
      }
    })
    await page.waitForTimeout(1000)

    // KEY STEP: Click "Edit List" button to show the textarea
    console.log('4b️⃣  Clicking Edit List button (btn_editList)...')
    await page.evaluate(() => {
      const w = window as any
      const root = w.exportRoot
      const list = root.settings.list
      const btn_editList = list.btn_editList

      if (btn_editList) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          const evt = new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null)
          btn_editList.dispatchEvent(evt)
        })
        console.log('Dispatched btn_editList click')
      } else {
        console.error('btn_editList not found!')
      }
    })
    await page.waitForTimeout(1500) // Wait for textarea animation

    const textareaVisible = await page.evaluate(() => {
      const el = document.getElementById('namesList') as HTMLTextAreaElement
      const computed = el ? window.getComputedStyle(el) : null
      return {
        exists: !!el,
        display: computed?.display,
        visible: el ? el.offsetHeight > 0 : false,
        value: el?.value?.substring(0, 50) || 'empty',
      }
    })
    console.log('   Textarea state:', textareaVisible)

    console.log('5️⃣  Filling names in textarea...')
    await page.evaluate((namesText) => {
      const el = document.getElementById('namesList') as HTMLTextAreaElement
      const $ = (window as any).$
      if (el) {
        el.style.display = 'block'
        el.value = namesText
        if ($) $('#namesList').val(namesText).trigger('change').trigger('keyup')
      }
    }, names.join('\n'))
    await page.waitForTimeout(500)
    console.log('   ✅ Textarea filled')
    await page.screenshot({ path: 'tmp/test-01-names.png' })

    // KEY STEP: Click "Done" button to apply names and exit edit mode
    console.log('5b️⃣  Clicking Done button (btn_done) to apply names...')
    await page.evaluate(() => {
      const w = window as any
      const root = w.exportRoot
      const list = root.settings.list

      // btn_done saves the names from textarea
      const btn_done = list.btn_done
      if (btn_done) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          const evt = new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null)
          btn_done.dispatchEvent(evt)
        })
        console.log('Dispatched btn_done click')
      } else {
        console.error('btn_done not found!')
      }
    })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'tmp/test-01b-done-clicked.png' })

    // Apply timer settings now that we're done with names
    console.log('6️⃣  Clicking Set to apply timer settings...')
    await page.evaluate(() => {
      const w = window as any
      const timer = w.exportRoot.settings.timer.oldWay
      if (timer.btnset) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          timer.btnset.dispatchEvent(new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null))
        })
      }
    })
    await page.waitForTimeout(1000)

    // Close settings via back button
    console.log('6b️⃣  Closing settings via back button...')
    await page.evaluate(() => {
      const w = window as any
      const root = w.exportRoot
      const back = root.settings.back
      if (back) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          const evt = new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null)
          back.dispatchEvent(evt)
        })
        console.log('Dispatched back button click')
      }
    })
    await page.waitForTimeout(2000)

    // Click Shuffle Characters to force rebuild ducks with our names
    console.log('6b️⃣  Clicking Shuffle Characters to rebuild ducks...')
    await page.evaluate(() => {
      const w = window as any
      const root = w.exportRoot
      // The Shuffle Characters button rebuilds ducks from listCollector
      const shuffleBtn = root.timer?.bShuffle
      if (shuffleBtn) {
        ;['mousedown', 'pressup', 'click'].forEach(type => {
          const evt = new w.createjs.MouseEvent(type, true, true, 0, 0, null, 0, true, null)
          shuffleBtn.dispatchEvent(evt)
        })
        console.log('Dispatched Shuffle Characters click')
      } else {
        console.log('bShuffle not found, trying alternative...')
        // Try rebuilding characters directly
        if (root.rebuildCharacters) {
          root.rebuildCharacters()
        }
      }
    })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'tmp/test-02-ready.png' })

    // Check if ducks have our names
    const duckCheck = await page.evaluate(() => {
      const w = window as any
      const root = w.exportRoot
      // Check if any character has our names in bubbles
      const results: string[] = []
      if (root.trackStart?.children) {
        for (const child of root.trackStart.children) {
          if (child?.no?.txt?.text) {
            results.push(child.no.txt.text)
          }
        }
      }
      return results
    })
    console.log(`   Duck names on canvas: ${duckCheck.length > 0 ? duckCheck.join(', ') : 'none found'}`)

    // === Start race ===
    console.log('7️⃣  Starting race via bStart...')
    await page.evaluate(() => {
      const w = window as any
      const bStart = w.exportRoot.timer.bStart
      const evt = new w.createjs.MouseEvent('mousedown', false, false, 0, 0, null, -1, true, 0, 0)
      evt.currentTarget = bStart
      bStart.dispatchEvent(evt)
    })
    await page.waitForTimeout(1000)
    console.log('   ✅ Race started!')
    await page.screenshot({ path: 'tmp/test-03-racing.png' })

    // === Monitor ===
    console.log('🏁 Race in progress...')
    let finished = false
    const startTimeResult = Date.now()
    const CAPTURE_TIMESTAMPS = [0, 3, 5, 7, 11]
    const capturedTimestamps = new Set<number>()

    for (let i = 0; i < 60; i++) { // Increase loop count for better resolution
      await page.waitForTimeout(500)
      const elapsedTotal = (Date.now() - startTimeResult) / 1000

      // Check for commentary capture
      let targetTimestamp: number | null = null
      for (const t of CAPTURE_TIMESTAMPS) {
        if (Math.abs(elapsedTotal - t) < 0.8 && !capturedTimestamps.has(t)) {
          targetTimestamp = t
          break
        }
      }

      if (targetTimestamp !== null) {
        capturedTimestamps.add(targetTimestamp)
        console.log(`📸 Capturing commentary for ${targetTimestamp}s mark...`)
        try {
          const buffer = await page.screenshot({ type: 'jpeg', quality: 70 })
          const base64 = buffer.toString('base64')
          const comment = await generateZaiCommentary(base64, targetTimestamp, false)
          console.log(`  [${targetTimestamp}s] 🎙️ ${comment}`)
        } catch (e) {
          console.error('Commentary failed:', e)
        }
      }

      try {
        finished = await page.evaluate(() => {
          const w = window as any
          return w.exportRoot?.winOrder?.visible === true && w.exportRoot?.winOrder?.alpha > 0.5
        })
      } catch { }

      if (i % 10 === 0) console.log(`   ⏱️  ${elapsedTotal.toFixed(1)}s... ${finished ? 'FINISHED!' : 'racing...'}`)
      if (finished) break
    }

    if (finished) {
      console.log('🏁 Race finished! Generating end commentary...')
      try {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 70 })
        const base64 = buffer.toString('base64')
        const elapsed = (Date.now() - startTimeResult) / 1000
        const comment = await generateZaiCommentary(base64, Math.round(elapsed), true)
        console.log(`  [End] 🎙️ ${comment}`)
      } catch (e) {
        console.error('Final commentary failed:', e)
      }
    }

    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'tmp/test-04-result.png' })

    // === Show winner list ===
    console.log('🏆 Clicking trophy...')
    await page.evaluate(() => {
      const w = window as any
      const winOrder = w.exportRoot.winOrder
      if (winOrder) {
        const evt = new w.createjs.MouseEvent('mousedown', false, false, 0, 0, null, -1, true, 0, 0)
        evt.currentTarget = winOrder
        winOrder.dispatchEvent(evt)
      }
    })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'tmp/test-05-winners.png' })

    // === Extract ===
    const results = await page.evaluate(() => {
      const table = document.querySelector('#resultsTable')
      if (!table) return []
      return Array.from(table.querySelectorAll('tr')).map((row, i) => {
        const cells = row.querySelectorAll('td')
        return { rank: i + 1, position: cells[0]?.textContent?.trim(), name: cells[1]?.textContent?.trim() }
      })
    })
    console.log('\n📊 Final Results:')
    for (const r of results) console.log(`   ${r.position} - ${r.name}`)

    console.log('\n✅ === E2E TEST COMPLETE ===')
  } catch (error) {
    console.error('❌ Test failed:', error)
    try { await page.screenshot({ path: 'tmp/test-error.png', timeout: 5000 }) } catch { }
  } finally {
    console.log('\n⏳ Browser stays open 15s...')
    await page.waitForTimeout(15000)
    await browser.close()
  }
}

main()
