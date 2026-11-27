/*
 * confetti-canvas.js
 * Motor Canvas 2D independiente para SHOW SCORE.
 * Adaptación JavaScript del disparo lateral usado en myRockomix.party.
 */
(() => {
  "use strict";

  const DEFAULTS = {
    particleCount: 500,       // Partículas por disparo (izquierda y derecha).
    spread: 100,              // Dispersión angular, en grados.
    startVelocity: 40,        // Velocidad inicial inspirada en canvas-confetti.
    gravity: 0.15,            // Gravedad: menor valor = caída más lenta.
    ticks: 420,               // Vida aproximada de cada partícula a 60 FPS.
    scalar: 1,
    colors: ["#fff2a8", "#ff6eb6", "#6ee7ff", "#bba2ff", "#ffffff", "#7dffb3"],
    zIndex: 2,
  };

  class ConfettiCanvas {
    constructor(container, options = {}) {
      if (!container) throw new Error("ConfettiCanvas necesita un contenedor válido.");

      this.container = container;
      this.options = { ...DEFAULTS, ...options };
      this.particles = [];
      this.frameId = null;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "score-confetti-canvas";
      this.canvas.setAttribute("aria-hidden", "true");
      this.canvas.style.cssText = [
        "position:absolute", "inset:0", "display:block", "width:100%", "height:100%",
        "pointer-events:none", `z-index:${this.options.zIndex}`
      ].join(";");
      this.context = this.canvas.getContext("2d", { alpha: true });
      this.container.append(this.canvas);
      this.resizeObserver = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => this.resize())
        : null;
      this.resizeObserver?.observe(this.container);
      this.resize();
    }

    resize() {
      const rect = this.container.getBoundingClientRect();
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.width * this.pixelRatio);
      this.canvas.height = Math.round(this.height * this.pixelRatio);
      this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    }

    // Dispara dos ráfagas laterales que apuntan hacia el centro.
    fire() {
      this.stop();
      this.resize();
      const count = Math.max(1, Math.floor(this.options.particleCount));
      this.createShot(-0.2, 20, count);
      this.createShot(1.2, 160, count);
      this.animate();
    }

    createShot(originX, angle, count) {
      const spreadRadians = (this.options.spread * Math.PI) / 180;
      const baseAngle = (angle * Math.PI) / 180;
      const velocityScale = Math.min(this.width, this.height) / 700;
      const baseVelocity = this.options.startVelocity * Math.max(0.65, velocityScale);

      for (let index = 0; index < count; index += 1) {
        const particleAngle = baseAngle + (Math.random() - 0.5) * spreadRadians;
        const velocity = baseVelocity * (0.72 + Math.random() * 0.56);
        const size = (5 + Math.random() * 7) * this.options.scalar;
        this.particles.push({
          x: originX * this.width,
          y: this.height * 0.5,
          vx: Math.cos(particleAngle) * velocity,
          vy: -Math.sin(particleAngle) * velocity,
          gravity: this.options.gravity * (0.75 + Math.random() * 0.5),
          drag: 0.985 + Math.random() * 0.01,
          width: size * (0.65 + Math.random() * 0.7),
          height: size,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.24,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.04 + Math.random() * 0.08,
          color: this.options.colors[Math.floor(Math.random() * this.options.colors.length)],
          life: this.options.ticks,
          maxLife: this.options.ticks,
          opacity: 1,
        });
      }
    }

    animate() {
      if (!this.context) return;
      this.context.clearRect(0, 0, this.width, this.height);
      const remaining = [];

      for (const particle of this.particles) {
        particle.vx *= particle.drag;
        particle.vy = particle.vy * particle.drag + particle.gravity;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += particle.rotationSpeed;
        particle.wobble += particle.wobbleSpeed;
        particle.life -= 1;
        particle.opacity = Math.min(1, particle.life / 28);

        if (particle.life <= 0 || particle.y > this.height + 40 ||
            particle.x < -this.width * 0.5 || particle.x > this.width * 1.5) continue;

        this.context.save();
        this.context.globalAlpha = particle.opacity;
        this.context.fillStyle = particle.color;
        this.context.translate(particle.x, particle.y);
        this.context.rotate(particle.rotation + Math.sin(particle.wobble) * 0.18);
        // Aplanamiento alternado: da sensación de papel girando en el aire.
        const flip = Math.abs(Math.cos(particle.wobble));
        this.context.fillRect(-particle.width / 2, -particle.height * flip / 2,
          particle.width, Math.max(1, particle.height * flip));
        this.context.restore();
        remaining.push(particle);
      }

      this.particles = remaining;
      if (this.particles.length) {
        this.frameId = window.requestAnimationFrame(() => this.animate());
      } else {
        this.frameId = null;
        this.context.clearRect(0, 0, this.width, this.height);
      }
    }

    // Detiene la animación y limpia el lienzo.
    stop() {
      if (this.frameId !== null) window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
      this.particles = [];
      if (this.context) this.context.clearRect(0, 0, this.width || 1, this.height || 1);
    }

    destroy() {
      this.stop();
      this.resizeObserver?.disconnect();
      this.canvas.remove();
    }
  }

  // API global pequeña para que SHOW SCORE pueda reutilizar el motor.
  window.showConfettiCanvas = {
    create(container, options) {
      return new ConfettiCanvas(container, options);
    },
  };
})();
