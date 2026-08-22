import { For, type Component } from "solid-js"
import { APP_MODES, type AppMode } from "@/context/layout"
import { Mark } from "@novaway/ui/logo"
import { ModeBadge, modeGradient, modeGlow } from "@/components/mode-visual"

export const ModeHomePage: Component<{ onSelect: (mode: AppMode) => void }> = (props) => (
  <div class="mode-home-root relative h-full w-full overflow-hidden">
    <style>{`
      @keyframes mode-home-drift {
        0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
        50% { transform: translate3d(24px, -18px, 0) scale(1.08); }
      }
      @keyframes mode-card-rise {
        from { transform: translateY(18px) scale(0.98); opacity: 0; }
        to { transform: translateY(var(--mode-card-y, 0)) rotate(var(--mode-card-rotate, 0deg)); opacity: 1; }
      }
      @keyframes mode-grid-scan {
        from { transform: translateX(-18%); opacity: 0.18; }
        50% { opacity: 0.34; }
        to { transform: translateX(18%); opacity: 0.18; }
      }
      @keyframes mode-ripple {
        0% { transform: translate(-50%, -50%) scale(0.25); opacity: 0; }
        35% { opacity: 0.42; }
        100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
      }
      .mode-home-root {
        color: #0f172a;
        background:
          radial-gradient(circle at 50% 14%, rgba(255, 255, 255, 0.95), transparent 32%),
          linear-gradient(135deg, rgba(238, 249, 252, 0.98), rgba(225, 232, 252, 0.96));
      }
      .mode-home-title {
        color: #0f172a;
      }
      .mode-home-copy {
        color: rgba(71, 85, 105, 0.92);
      }
      .mode-home-kicker {
        color: #075985;
        background: rgba(255, 255, 255, 0.42);
        border-color: rgba(125, 211, 252, 0.45);
        box-shadow: 0 10px 40px rgba(56, 189, 248, 0.16);
      }
      .mode-home-orb {
        animation: mode-home-drift 12s ease-in-out infinite;
      }
      .mode-home-card {
        animation: mode-card-rise 520ms ease-out both;
        background:
          linear-gradient(145deg, color-mix(in srgb, var(--mode-color) 18%, #ffffff), rgba(255,255,255,0.68) 58%, color-mix(in srgb, var(--mode-color) 8%, #ffffff));
        border-color: rgba(255, 255, 255, 0.7);
        box-shadow: 0 22px 80px rgba(45, 75, 120, 0.16);
        transform: translateY(var(--mode-card-y, 0)) rotate(var(--mode-card-rotate, 0deg));
      }
      .mode-home-card::before {
        content: "";
        position: absolute;
        inset: -1px;
        border-radius: inherit;
        opacity: 0;
        background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--mode-color) 38%, transparent), transparent 58%);
        filter: blur(18px);
        transition: opacity 260ms ease, transform 260ms ease;
        transform: scale(0.92);
      }
      .mode-home-card::after {
        content: "";
        position: absolute;
        left: var(--ripple-x, 74%);
        top: var(--ripple-y, 22%);
        width: 220px;
        height: 220px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--mode-color) 48%, transparent);
        box-shadow: 0 0 42px color-mix(in srgb, var(--mode-color) 18%, transparent);
        pointer-events: none;
        opacity: 0;
      }
      .mode-home-card:hover {
        box-shadow: 0 32px 110px color-mix(in srgb, var(--mode-color) 24%, rgba(45, 75, 120, 0.16));
        transform: translateY(calc(var(--mode-card-y, 0) - 10px)) rotate(0deg) scale(1.025);
      }
      .mode-home-card:hover::before {
        opacity: 1;
        transform: scale(1.08);
      }
      .mode-home-card:hover::after {
        animation: mode-ripple 1400ms ease-out infinite;
      }
      .mode-home-card-title {
        color: #0f172a;
      }
      .mode-home-card-copy {
        color: rgba(71, 85, 105, 0.92);
      }
      .mode-home-card-action {
        color: rgba(71, 85, 105, 0.95);
      }
      .mode-home-grid::before {
        content: "";
        position: absolute;
        inset: -20%;
        background-image:
          linear-gradient(rgba(74, 144, 217, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(74, 144, 217, 0.08) 1px, transparent 1px);
        background-size: 48px 48px;
        mask-image: radial-gradient(circle at 50% 42%, black 0%, transparent 62%);
        animation: mode-grid-scan 16s ease-in-out infinite alternate;
      }
      html[data-color-scheme="dark"] .mode-home-root {
        color: rgba(255, 255, 255, 0.92);
        background:
          radial-gradient(circle at 50% 7%, rgba(54, 84, 125, 0.34), transparent 32%),
          radial-gradient(circle at 12% 76%, rgba(20, 184, 166, 0.12), transparent 28%),
          radial-gradient(circle at 88% 70%, rgba(124, 58, 237, 0.13), transparent 32%),
          linear-gradient(135deg, #06101f 0%, #0a1020 46%, #111827 100%);
      }
      html[data-color-scheme="dark"] .mode-home-title {
        color: rgba(255, 255, 255, 0.94);
      }
      html[data-color-scheme="dark"] .mode-home-copy {
        color: rgba(226, 232, 240, 0.76);
      }
      html[data-color-scheme="dark"] .mode-home-kicker {
        color: rgba(207, 250, 254, 0.92);
        background: rgba(255, 255, 255, 0.055);
        border-color: rgba(103, 232, 249, 0.22);
        box-shadow: 0 10px 44px rgba(6, 182, 212, 0.12);
      }
      html[data-color-scheme="dark"] .mode-home-card {
        background:
          linear-gradient(145deg, color-mix(in srgb, var(--mode-color) 26%, rgba(10, 18, 34, 0.9)), rgba(10, 18, 34, 0.78) 56%, color-mix(in srgb, var(--mode-color) 12%, rgba(15, 23, 42, 0.86)));
        border-color: rgba(255, 255, 255, 0.12);
        box-shadow: 0 26px 90px rgba(0, 0, 0, 0.34);
      }
      html[data-color-scheme="dark"] .mode-home-card:hover {
        border-color: color-mix(in srgb, var(--mode-color) 42%, rgba(255, 255, 255, 0.18));
        box-shadow:
          0 34px 120px rgba(0, 0, 0, 0.5),
          0 0 56px color-mix(in srgb, var(--mode-color) 24%, transparent);
      }
      html[data-color-scheme="dark"] .mode-home-card-title {
        color: rgba(255, 255, 255, 0.94);
      }
      html[data-color-scheme="dark"] .mode-home-card-copy {
        color: rgba(226, 232, 240, 0.78);
      }
      html[data-color-scheme="dark"] .mode-home-card-action {
        color: rgba(226, 232, 240, 0.82);
      }
      html[data-color-scheme="dark"] .mode-home-card-glass {
        background: linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.025));
      }
      html[data-color-scheme="dark"] .mode-home-grid::before {
        background-image:
          linear-gradient(rgba(125, 211, 252, 0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(125, 211, 252, 0.12) 1px, transparent 1px);
      }
    `}</style>
    <div class="mode-home-orb absolute -left-24 top-10 size-80 rounded-full bg-sky-300/34 blur-3xl" />
    <div class="mode-home-orb absolute right-12 top-20 size-72 rounded-full bg-indigo-300/22 blur-3xl [animation-delay:1.2s]" />
    <div class="mode-home-orb absolute -right-20 bottom-8 size-96 rounded-full bg-fuchsia-300/22 blur-3xl [animation-delay:1.8s]" />
    <div class="mode-home-grid absolute inset-0" />
    <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/80 to-transparent" />

    <div class="relative z-10 flex h-full flex-col items-center justify-center gap-11 overflow-y-auto px-6 py-12">
      <div class="flex max-w-4xl flex-col items-center gap-4 text-center">
        <div class="grid size-16 place-items-center">
          <Mark class="size-12" />
        </div>
        <div class="space-y-3">
          <div class="mode-home-kicker mx-auto w-fit rounded-full border px-3 py-1 text-11-medium tracking-[0.28em] backdrop-blur-xl">
            NOVAWAY MODE HUB
          </div>
          <h1 class="mode-home-title text-30-medium">选择你的 AI 工作模式</h1>
          <p class="mode-home-copy text-15-regular leading-relaxed">
            你的全能AI工作舱，五种模式无缝切换，从代码到创意，从办公到运营，一个平台搞定一切。
          </p>
        </div>
      </div>

      <div class="grid w-full max-w-7xl grid-cols-1 gap-5 md:grid-cols-5 md:items-center">
        <For each={APP_MODES}>
          {(mode, index) => (
            <button
              type="button"
              class="mode-home-card group relative min-h-64 overflow-hidden rounded-[30px] border p-6 text-left backdrop-blur-2xl transition-all duration-300"
              style={{
                "animation-delay": `${index() * 70}ms`,
                "--mode-color": mode.color,
                "--mode-card-y": `${[18, -12, 10, -18, 14][index()] ?? 0}px`,
                "--mode-card-rotate": `${[-2.4, 1.6, -0.8, 2.2, -1.4][index()] ?? 0}deg`,
                "--ripple-x": `${[82, 68, 74, 64, 78][index()] ?? 74}%`,
                "--ripple-y": `${[24, 18, 28, 20, 24][index()] ?? 22}%`,
              }}
              onClick={() => props.onSelect(mode.id)}
            >
              <div
                class="absolute inset-x-0 top-0 h-1.5"
                style={{ background: modeGradient(mode), "box-shadow": modeGlow(mode) }}
              />
              <div
                class="absolute -right-12 -top-12 size-36 rounded-full opacity-60 blur-2xl transition-transform duration-500 group-hover:scale-125"
                style={{ background: `color-mix(in srgb, ${mode.color} 32%, transparent)` }}
              />
              <div class="mode-home-card-glass absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.58),rgba(255,255,255,0.16))]" />
              <div class="relative z-10 flex h-full flex-col justify-between gap-7">
                <ModeBadge mode={mode} />
                <div class="space-y-2">
                  <div class="mode-home-card-title text-18-medium">{mode.name}</div>
                  <div class="mode-home-card-copy text-14-regular leading-relaxed">{mode.description}</div>
                </div>
                <div class="mode-home-card-action flex items-center justify-between text-13-medium">
                  <span>进入{mode.shortName}模式</span>
                  <span class="transition-transform group-hover:translate-x-1">→</span>
                </div>
              </div>
            </button>
          )}
        </For>
      </div>
    </div>
  </div>
)
