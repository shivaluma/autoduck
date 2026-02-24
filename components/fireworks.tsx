'use client'

import { useEffect, useRef } from 'react'

export function Fireworks() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let particles: Particle[] = []
    let rockets: Rocket[] = []
    let animationId: number

    // GGD Color palette
    const colors = [
      '#5ee8b7', // mint
      '#ffc857', // gold
      '#ff6b4a', // orange
      '#ff8fab', // pink
      '#7ec8e3', // sky
      '#9b8ec4', // lavender
      '#f0e6d3', // cream
    ]

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    window.addEventListener('resize', resize)
    resize()

    class Rocket {
      x: number
      y: number
      vx: number
      vy: number
      color: string

      constructor() {
        this.x = Math.random() * canvas!.width
        this.y = canvas!.height
        this.vx = (Math.random() - 0.5) * 4
        this.vy = -(Math.random() * 5 + 10)
        this.color = colors[Math.floor(Math.random() * colors.length)]
      }

      draw() {
        if (!ctx) return
        ctx.fillStyle = this.color
        ctx.beginPath()
        ctx.arc(this.x, this.y, 3, 0, Math.PI * 2)
        ctx.fill()
      }

      update() {
        this.x += this.vx
        this.y += this.vy
        this.vy += 0.2

        if (this.vy >= -2) {
          for (let i = 0; i < 50; i++) {
            particles.push(new Particle(this.x, this.y, this.color))
          }
          return false
        }
        return true
      }
    }

    class Particle {
      x: number
      y: number
      vx: number
      vy: number
      alpha: number
      color: string
      size: number

      constructor(x: number, y: number, color: string) {
        this.x = x
        this.y = y
        const angle = Math.random() * Math.PI * 2
        const speed = Math.random() * 5 + 2
        this.vx = Math.cos(angle) * speed
        this.vy = Math.sin(angle) * speed
        this.alpha = 1
        this.color = color
        this.size = Math.random() * 3 + 1
      }

      draw() {
        if (!ctx) return
        ctx.globalAlpha = this.alpha
        ctx.fillStyle = this.color
        // Draw little star shapes for some particles
        if (this.size > 2) {
          ctx.font = `${this.size * 4}px serif`
          ctx.fillText('✦', this.x, this.y)
        } else {
          ctx.beginPath()
          ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      update() {
        this.x += this.vx
        this.y += this.vy
        this.vy += 0.1
        this.vx *= 0.95
        this.vy *= 0.95
        this.alpha -= 0.02
        return this.alpha > 0
      }
    }

    const loop = () => {
      if (!ctx || !canvas) return

      // Trail effect with purple tint
      ctx.fillStyle = 'rgba(26, 18, 53, 0.2)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      if (Math.random() < 0.05) {
        rockets.push(new Rocket())
      }

      rockets = rockets.filter(r => {
        r.draw()
        return r.update()
      })

      particles = particles.filter(p => {
        p.draw()
        return p.update()
      })

      animationId = requestAnimationFrame(loop)
    }

    loop()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50"
      style={{ mixBlendMode: 'screen' }}
    />
  )
}
