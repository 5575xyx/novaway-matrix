import {
  AppBaseProviders,
  AssistantPanel,
  PlatformProvider,
  type AgentItem,
  type PetSkin,
  type PetNotification,
  type Task,
  type TaskEvent,
  type TaskGroup,
} from "@novaway/app"
import type {
  FloatingMiniGame,
  FloatingPetAccessory,
  FloatingPetAvatar,
  FloatingPetDifficulty,
  FloatingPetGame,
  FloatingPetReaction,
  FloatingPetRpsChoice,
  FloatingPetState,
} from "../preload/types"
import type { JSX } from "solid-js"
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import { initI18n, t } from "./i18n"
import { createPlatform, listenForDeepLinks } from "./platform"
import "@novaway/app/index.css"
import "./styles.css"
import logoUrl from "./novaway-icon.svg"

const root = document.getElementById("root")
const query = new URLSearchParams(window.location.search)
const panelOnly = query.has("panel")
const skinOnly = query.has("skin")
const initialPanelTab: "monitor" | "notifications" | "pet" =
  query.get("tab") === "notifications" ? "notifications" : query.get("tab") === "pet" ? "pet" : "monitor"
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

void initI18n()
listenForDeepLinks()

const skinOptions: Array<{ id: PetSkin; label: string; color: string }> = [
  { id: "snow", label: "雪白", color: "#f8fafc" },
  { id: "honey", label: "金橙", color: "#f59e0b" },
  { id: "ash", label: "银灰", color: "#94a3b8" },
  { id: "aurora", label: "翡翠", color: "#34d399" },
  { id: "violet", label: "紫罗兰", color: "#a78bfa" },
  { id: "crimson", label: "绯红", color: "#fb7185" },
]

const SkinMenu = (props: { skin: PetSkin; onChange: (skin: PetSkin) => void }) => (
  <div
    class="h-full w-full border p-3 shadow-2xl"
    style={{
      "background-color": "light-dark(#f8fbff,#0b1020)",
      "border-color": "light-dark(rgba(8,145,178,.24),#263249)",
    }}
  >
    <div class="pb-2.5 mb-2 border-b" style={{ "border-color": "light-dark(rgba(8,145,178,.18),#263249)" }}>
      <div class="text-12-medium text-text-strong">外观配色</div>
      <div class="mt-0.5 text-10-regular text-text-weak">科技挂饰与核心光效</div>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <For each={skinOptions}>
        {(skin) => (
          <button
            type="button"
            title={skin.label}
            class={`flex h-15 flex-col items-center justify-center gap-1 border text-10-medium transition-all ${props.skin === skin.id ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_10px_rgba(34,211,238,.16)]" : "border-border-weaker-base hover:border-cyan-400/60 hover:bg-surface-raised-base-hover"}`}
            onClick={() => props.onChange(skin.id)}
          >
            <span
              class="size-6 shrink-0 rounded-full border border-white/60"
              style={{ "background-color": skin.color, "box-shadow": `0 0 9px ${skin.color}` }}
            />
            <span class="max-w-full truncate px-1 text-text-base">{skin.label}</span>
          </button>
        )}
      </For>
      <label
        class="col-span-3 mt-1 flex h-10 items-center gap-3 border-t pt-2 text-11-medium text-text-strong cursor-pointer"
        style={{ "border-color": "light-dark(rgba(8,145,178,.18),#263249)" }}
      >
        <span class="flex-1">自定义颜色</span>
        <input
          type="color"
          class="size-8 shrink-0 cursor-pointer border border-white/50 bg-transparent p-0"
          value={props.skin.startsWith("#") ? props.skin : "#22d3ee"}
          onInput={(event) => props.onChange(event.currentTarget.value as PetSkin)}
        />
      </label>
    </div>
  </div>
)

const defaultPet: FloatingPetState = {
  satiety: 76,
  hydration: 78,
  mood: 82,
  energy: 80,
  coins: 0,
  xp: 0,
  lastUpdatedAt: 0,
}

const RPS_ANIMOJI: Record<FloatingPetRpsChoice, string> = { rock: "✊", paper: "✋", scissors: "✌️" }

type PetReactionName = "idle" | "feed" | "drink" | "play" | "rps" | "think" | "jump" | "win"

const PET_REACTIONS: Record<PetReactionName, { folder?: string; frames: number; label?: string; emoji?: string }> = {
  idle: { folder: "stand", frames: 4 },
  feed: { folder: "groom", frames: 8, label: "大口吃饭中…", emoji: "🍎" },
  drink: { folder: "pant", frames: 8, label: "咕噜咕噜喝水…", emoji: "💧" },
  play: { folder: "side-run", frames: 8, label: "出发玩耍！", emoji: "🎾" },
  rps: { folder: "tail", frames: 8, label: "认真出拳！", emoji: "✊" },
  think: { folder: "stand", frames: 4, label: "思考中…", emoji: "💭" },
  jump: { folder: "side-run", frames: 8, label: "跳！跳！跳！", emoji: "✨" },
  win: { folder: "tail", frames: 8, label: "太棒啦！", emoji: "🎉" },
}

function PetReaction(props: { reaction: PetReactionName; nonce: number }) {
  const [frame, setFrame] = createSignal(0)
  const [visible, setVisible] = createSignal(props.reaction !== "idle")
  let timer: ReturnType<typeof setInterval> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  const restart = () => {
    if (timer) clearInterval(timer)
    if (hideTimer) clearTimeout(hideTimer)
    const meta = PET_REACTIONS[props.reaction]
    setFrame(0)
    setVisible(props.reaction !== "idle")
    if (props.reaction === "idle") return
    let current = 0
    timer = setInterval(
      () => {
        current += 1
        if (current >= meta.frames) {
          if (timer) clearInterval(timer)
          timer = undefined
          setFrame(meta.frames - 1)
          hideTimer = setTimeout(() => setVisible(false), 850)
          return
        }
        setFrame(current)
      },
      props.reaction === "play" || props.reaction === "jump" ? 105 : 145,
    )
  }

  createEffect(() => {
    props.nonce
    props.reaction
    restart()
  })

  onCleanup(() => {
    if (timer) clearInterval(timer)
    if (hideTimer) clearTimeout(hideTimer)
  })

  const meta = () => PET_REACTIONS[props.reaction]
  return (
    <div class="nova-pet-reaction absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
      <Show when={visible()}>
        <div class="nova-pet-reaction-bubble absolute -top-1 right-0 rounded-full px-2 py-1 text-11-medium shadow-md">
          {meta().emoji} {meta().label}
        </div>
      </Show>
      <img
        class={`nova-pet-reaction-sprite h-24 w-24 object-contain ${visible() ? "nova-pet-reaction-active" : "opacity-0"}`}
        src={`/pets/${meta().folder ?? "stand"}/${props.reaction === "idle" ? frame() + 1 : frame() + 1}.png`}
        alt=""
        draggable={false}
      />
    </div>
  )
}

function GameModal(props: { title: string; icon: string; onClose: () => void; children: JSX.Element }) {
  return (
    <div
      class="nova-pet-game-backdrop absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-3"
      onClick={() => props.onClose()}
      role="presentation"
    >
      <div
        class="nova-pet-game-modal w-full max-w-[480px] max-h-full min-w-0 rounded-2xl border p-3 shadow-2xl flex flex-col overflow-hidden"
        style={{
          "background-color": "light-dark(#f8fbff,#0b1020)",
          "border-color": "light-dark(rgba(8,145,178,.34),#263249)",
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={props.title}
      >
        <div
          class="flex items-center justify-between pb-2 mb-2 border-b"
          style={{ "border-color": "light-dark(rgba(8,145,178,.18),#263249)" }}
        >
          <div class="flex items-center gap-2">
            <span class="text-lg" aria-hidden="true">
              {props.icon}
            </span>
            <span class="text-13-medium text-text-strong">{props.title}</span>
          </div>
          <button
            type="button"
            class="nova-pet-close rounded-md px-2 py-1 text-11-medium text-text-weak hover:bg-surface-raised-base-hover"
            onClick={() => props.onClose()}
          >
            关闭
          </button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">{props.children}</div>
      </div>
    </div>
  )
}

function RpsGame(props: {
  playing?: boolean
  onPlay: (choice: FloatingPetRpsChoice) => void
  lastResult?: { player: FloatingPetRpsChoice; petChoice: FloatingPetRpsChoice; outcome: "win" | "lose" | "draw" }
}) {
  const [revealing, setRevealing] = createSignal(false)
  const choose = (choice: FloatingPetRpsChoice) => {
    setRevealing(true)
    props.onPlay(choice)
    setTimeout(() => setRevealing(false), 520)
  }
  return (
    <div class="flex flex-col items-center gap-3 py-2">
      <div class="flex items-center gap-4">
        <div class="flex flex-col items-center gap-1">
          <span
            class={`nova-pet-rps-hand text-3xl ${revealing() ? "nova-pet-rps-shake" : ""}`}
            style={{ "animation-delay": "0ms" }}
          >
            {props.lastResult ? RPS_ANIMOJI[props.lastResult.player] : "❔"}
          </span>
          <span class="text-10-regular text-text-weak">你</span>
        </div>
        <span class="text-12-medium text-text-weak">VS</span>
        <div class="flex flex-col items-center gap-1">
          <span
            class={`nova-pet-rps-hand text-3xl ${revealing() ? "nova-pet-rps-shake" : ""}`}
            style={{ "animation-delay": "120ms" }}
          >
            {props.lastResult ? RPS_ANIMOJI[props.lastResult.petChoice] : "🐾"}
          </span>
          <span class="text-10-regular text-text-weak">宠物</span>
        </div>
      </div>
      <Show when={props.lastResult}>
        {(result) => (
          <div
            class={`nova-pet-result rounded-lg px-3 py-1.5 text-12-medium ${result().outcome === "win" ? "nova-pet-result-win" : result().outcome === "draw" ? "nova-pet-result-draw" : "nova-pet-result-lose"}`}
          >
            {result().outcome === "win" ? "你赢了 🎉" : result().outcome === "draw" ? "平局 🤝" : "宠物赢了 💪"}
          </div>
        )}
      </Show>
      <div class="grid w-full grid-cols-3 gap-2">
        <For each={["rock", "paper", "scissors"] as FloatingPetRpsChoice[]}>
          {(choice) => (
            <button
              type="button"
              disabled={props.playing}
              class="nova-pet-press rounded-lg bg-surface-raised-base px-2 py-3 text-13-medium hover:bg-cyan-400/10 active:bg-cyan-400/20 disabled:opacity-50"
              onClick={() => choose(choice)}
            >
              <span class="block text-xl">{RPS_ANIMOJI[choice]}</span>
              <span class="text-10-regular text-text-weak">
                {choice === "rock" ? "石头" : choice === "paper" ? "布" : "剪刀"}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function GomokuGame(props: {
  onReward: (settle: number | undefined) => void
  onReaction?: (reaction: FloatingPetReaction) => void
}) {
  const SIZE = 9
  const [board, setBoard] = createSignal<Array<"black" | "white" | undefined>>(Array(SIZE * SIZE).fill(undefined))
  const [lastMove, setLastMove] = createSignal<number>()
  const [status, setStatus] = createSignal("轮到你（黑棋）")
  const [finished, setFinished] = createSignal(false)
  const [nextTurn, setNextTurn] = createSignal(true)

  const winnerAt = (rows: Array<"black" | "white" | undefined>, index: number, color: "black" | "white") => {
    const row = Math.floor(index / SIZE)
    const col = index % SIZE
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]
    return dirs.some(([dx, dy]) => {
      let count = 1
      for (const sign of [-1, 1]) {
        let x = row + dx * sign
        let y = col + dy * sign
        while (x >= 0 && x < SIZE && y >= 0 && y < SIZE && rows[x * SIZE + y] === color) {
          count++
          x += dx * sign
          y += dy * sign
        }
      }
      return count >= 5
    })
  }

  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const

  const lineInfo = (
    rows: Array<"black" | "white" | undefined>,
    index: number,
    color: "black" | "white",
    dx: number,
    dy: number,
  ) => {
    const row = Math.floor(index / SIZE)
    const col = index % SIZE
    let count = 1
    let open = 0

    for (const sign of [-1, 1]) {
      let x = row + dx * sign
      let y = col + dy * sign
      while (x >= 0 && x < SIZE && y >= 0 && y < SIZE && rows[x * SIZE + y] === color) {
        count += 1
        x += dx * sign
        y += dy * sign
      }
      if (x >= 0 && x < SIZE && y >= 0 && y < SIZE && rows[x * SIZE + y] === undefined) open += 1
    }
    return { count, open }
  }

  const moveScore = (rows: Array<"black" | "white" | undefined>, index: number, color: "black" | "white") => {
    rows[index] = color
    let score = 0
    for (const [dx, dy] of directions) {
      const { count, open } = lineInfo(rows, index, color, dx, dy)
      if (count >= 5) score += 1_000_000
      else if (count === 4 && open === 2) score += 80_000
      else if (count === 4 && open === 1) score += 12_000
      else if (count === 3 && open === 2) score += 5_000
      else if (count === 3 && open === 1) score += 900
      else if (count === 2 && open === 2) score += 260
      else if (count === 2 && open === 1) score += 60
    }
    rows[index] = undefined
    return score
  }

  const chooseComputerMove = (rows: Array<"black" | "white" | undefined>) => {
    const occupied = rows.reduce((count, piece) => count + Number(piece !== undefined), 0)
    const candidates = rows
      .map((piece, index) => (piece ? -1 : index))
      .filter((index) => index >= 0)
      .filter((index) => {
        if (occupied < 2) return true
        const row = Math.floor(index / SIZE)
        const col = index % SIZE
        return rows.some((piece, other) => {
          if (!piece) return false
          const otherRow = Math.floor(other / SIZE)
          const otherCol = other % SIZE
          return Math.max(Math.abs(row - otherRow), Math.abs(col - otherCol)) <= 2
        })
      })
    const pool = candidates.length > 0 ? candidates : rows.map((_, index) => index).filter((index) => !rows[index])

    const winningMove = pool.find((index) => {
      rows[index] = "white"
      const wins = winnerAt(rows, index, "white")
      rows[index] = undefined
      return wins
    })
    if (winningMove !== undefined) return winningMove

    const blockingMove = pool.find((index) => {
      rows[index] = "black"
      const wins = winnerAt(rows, index, "black")
      rows[index] = undefined
      return wins
    })
    if (blockingMove !== undefined) return blockingMove

    if (pool.length === 0) return undefined
    return pool.reduce(
      (best, index) => {
        const attack = moveScore(rows, index, "white")
        const defense = moveScore(rows, index, "black")
        const row = Math.floor(index / SIZE)
        const col = index % SIZE
        const centerBonus = (SIZE - Math.abs(4 - row) - Math.abs(4 - col)) * 8
        const score = attack + defense * 1.18 + centerBonus
        return score > best.score ? { index, score } : best
      },
      { index: pool[0], score: Number.NEGATIVE_INFINITY },
    ).index
  }

  let computerTimer: ReturnType<typeof setTimeout> | undefined
  const computerMove = () => {
    computerTimer = undefined
    if (finished() || nextTurn()) return
    const next = [...board()]
    const place = chooseComputerMove(next)
    if (place === undefined) {
      setStatus("棋盘满了，平局！")
      setFinished(true)
      return
    }
    next[place] = "white"
    setBoard(next)
    setLastMove(place)
    if (winnerAt(next, place, "white")) {
      setStatus("宠物赢了，再来一局吧！")
      setFinished(true)
      props.onReward(0)
      return
    }
    if (next.every(Boolean)) {
      setStatus("棋盘满了，平局！")
      setFinished(true)
      return
    }
    setStatus("轮到你（黑棋）")
    setNextTurn(true)
  }

  const move = (index: number) => {
    if (finished() || !nextTurn() || board()[index]) return
    const next = [...board()]
    next[index] = "black"
    setBoard(next)
    setLastMove(index)
    setNextTurn(false)
    if (winnerAt(next, index, "black")) {
      setStatus("五连！你赢了 🎉")
      setFinished(true)
      props.onReward(1)
      return
    }
    setStatus("宠物思考中…")
    props.onReaction?.("think")
    if (computerTimer) clearTimeout(computerTimer)
    computerTimer = setTimeout(computerMove, 320)
  }

  const reset = () => {
    if (computerTimer) clearTimeout(computerTimer)
    computerTimer = undefined
    setBoard(Array(SIZE * SIZE).fill(undefined))
    setLastMove(undefined)
    setStatus("轮到你（黑棋）")
    setFinished(false)
    setNextTurn(true)
  }

  onCleanup(() => {
    if (computerTimer) clearTimeout(computerTimer)
  })

  return (
    <div class="flex flex-col items-center gap-2 py-2">
      <div class="text-11-regular text-text-weak">{status()}</div>
      <div
        class="nova-gomoku-board relative rounded-xl border bg-amber-100/70 p-4 dark:bg-amber-950/30"
        style={{ "border-color": "light-dark(#d6a85e,#6e4b22)" }}
      >
        <div class="absolute inset-4">
          <div
            class="absolute inset-0"
            style={{
              "background-image":
                "linear-gradient(to right, rgba(120, 74, 25, .72) 1px, transparent 1px), linear-gradient(to bottom, rgba(120, 74, 25, .72) 1px, transparent 1px)",
              "background-size": "12.5% 12.5%",
            }}
          />
          <For each={Array.from({ length: SIZE * SIZE })}>
            {(_, index) => {
              const cell = () => board()[index()]
              const row = Math.floor(index() / SIZE)
              const col = index() % SIZE
              return (
                <button
                  type="button"
                  disabled={finished() || Boolean(cell()) || !nextTurn()}
                  onClick={() => move(index())}
                  class="nova-gomoku-cell absolute z-10 size-9 rounded-full hover:bg-amber-300/30 disabled:cursor-default"
                  style={{ left: `${(col / (SIZE - 1)) * 100}%`, top: `${(row / (SIZE - 1)) * 100}%` }}
                  aria-label={`${row + 1}行${col + 1}列${cell() ? (cell() === "black" ? "黑棋" : "白棋") : "空位"}`}
                >
                  <Show when={cell()}>
                    {(piece) => (
                      <span
                        class="nova-pet-stone block size-[82%] rounded-full border shadow-md"
                        classList={{ "nova-pet-stone-last": lastMove() === index() }}
                        style={{
                          "background-color": piece() === "black" ? "#111827" : "#ffffff",
                          "border-color": piece() === "black" ? "#020617" : "#94a3b8",
                        }}
                      />
                    )}
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </div>
      <button
        type="button"
        class="nova-pet-press rounded-lg bg-surface-raised-base px-4 py-1.5 text-12-medium hover:bg-cyan-400/10"
        onClick={reset}
      >
        重开一局
      </button>
    </div>
  )
}

function MinesweeperGame(props: { onReward: (score: number) => void; difficulty?: FloatingPetDifficulty }) {
  const [difficulty, setDifficulty] = createSignal<FloatingPetDifficulty>(props.difficulty ?? "normal")
  const [mines, setMines] = createSignal<Set<number>>(new Set())
  const [revealed, setRevealed] = createSignal<Set<number>>(new Set())
  const [flags, setFlags] = createSignal<Set<number>>(new Set())
  const [mineStatus, setMineStatus] = createSignal<"ready" | "playing" | "won" | "lost">("ready")
  const [mineMessage, setMineMessage] = createSignal("点击开始，在安全格中找出所有地雷")
  const [mineTime, setMineTime] = createSignal(0)
  let mineTimer: ReturnType<typeof setInterval> | undefined

  const mineConfig = () =>
    difficulty() === "easy"
      ? { rows: 8, cols: 8, count: 10 }
      : difficulty() === "hard"
        ? { rows: 12, cols: 12, count: 30 }
        : { rows: 9, cols: 9, count: 12 }
  const mineRows = () => mineConfig().rows
  const mineCols = () => mineConfig().cols
  const mineCount = () => mineConfig().count
  const mineIndex = (row: number, col: number) => row * mineCols() + col
  const mineNeighbors = (index: number) => {
    const row = Math.floor(index / MINE_COLS)
    const col = index % mineCols()
    const result: number[] = []
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue
        const nextRow = row + dr
        const nextCol = col + dc
        if (nextRow >= 0 && nextRow < mineRows() && nextCol >= 0 && nextCol < mineCols()) {
          result.push(mineIndex(nextRow, nextCol))
        }
      }
    }
    return result
  }

  const countMines = (index: number, mineSet = mines()) =>
    mineNeighbors(index).filter((neighbor) => mineSet.has(neighbor)).length

  const resetMinesweeper = () => {
    if (mineTimer) clearInterval(mineTimer)
    mineTimer = undefined
    setMines(new Set<number>())
    setRevealed(new Set<number>())
    setFlags(new Set<number>())
    setMineStatus("ready")
    setMineTime(0)
    setMineMessage("点击任意格子开始；首格及周围区域保证安全")
  }

  const startMinesweeper = (firstIndex: number) => {
    if (mineTimer) clearInterval(mineTimer)
    const blocked = new Set([firstIndex, ...mineNeighbors(firstIndex)])
    const available = Array.from({ length: mineRows() * mineCols() }, (_, index) => index).filter(
      (index) => !blocked.has(index),
    )
    const mineSet = new Set<number>()
    while (mineSet.size < mineCount() && available.length > 0) {
      const pick = Math.floor(Math.random() * available.length)
      const [index] = available.splice(pick, 1)
      if (index !== undefined) mineSet.add(index)
    }
    setMines(mineSet)
    setRevealed(new Set<number>())
    setFlags(new Set<number>())
    setMineStatus("playing")
    setMineTime(0)
    setMineMessage("小心地雷！点击数字格可快速展开周围安全格，右键可以插旗")
    mineTimer = setInterval(() => setMineTime((value) => value + 1), 1000)
    reveal(firstIndex, mineSet, new Set<number>())
  }

  const reveal = (index: number, mineSet = mines(), visible = new Set(revealed())) => {
    if (mineStatus() !== "playing" || flags().has(index) || visible.has(index)) return false
    if (mineSet.has(index)) {
      setRevealed(
        new Set(Array.from({ length: mineRows() * mineCols() }, (_, cell) => cell).filter((cell) => mineSet.has(cell))),
      )
      setMineStatus("lost")
      setMineMessage("踩到地雷了，再试一次吧！")
      if (mineTimer) clearInterval(mineTimer)
      return false
    }
    const pending = [index]
    while (pending.length > 0) {
      const current = pending.pop()
      if (current === undefined || visible.has(current) || mineSet.has(current) || flags().has(current)) continue
      visible.add(current)
      if (countMines(current, mineSet) === 0) {
        for (const neighbor of mineNeighbors(current)) {
          if (!visible.has(neighbor) && !mineSet.has(neighbor) && !flags().has(neighbor)) pending.push(neighbor)
        }
      }
    }
    setRevealed(new Set(visible))
    const safeCount = mineRows() * mineCols() - mineSet.size
    if (visible.size >= safeCount) {
      setMineStatus("won")
      setMineMessage(`扫雷成功！用时 ${mineTime()} 秒 🎉`)
      if (mineTimer) clearInterval(mineTimer)
      props.onReward(Math.max(1, 100 - mineTime()))
    }
    return true
  }

  const clickMine = (index: number) => {
    if (mineStatus() === "ready") {
      startMinesweeper(index)
      return
    }
    if (mineStatus() === "won" || mineStatus() === "lost") return
    if (revealed().has(index)) {
      const mineSet = mines()
      const adjacent = mineNeighbors(index)
      const adjacentFlags = adjacent.filter((neighbor) => flags().has(neighbor)).length
      if (countMines(index, mineSet) === adjacentFlags) {
        for (const neighbor of adjacent) {
          if (!revealed().has(neighbor) && !flags().has(neighbor)) reveal(neighbor, mineSet)
        }
      }
      return
    }
    reveal(index)
  }

  const flagMine = (event: MouseEvent, index: number) => {
    event.preventDefault()
    if (mineStatus() !== "playing") return
    if (revealed().has(index)) return
    setFlags((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else if (next.size < mineCount()) next.add(index)
      return next
    })
  }

  onCleanup(() => {
    if (mineTimer) clearInterval(mineTimer)
  })

  return (
    <div class="flex flex-col items-center gap-3 py-2">
      <div class="flex w-full items-center gap-2">
        <div class="flex flex-1 items-center gap-1 rounded-lg bg-surface-raised-base p-1">
          <For each={(["easy", "normal", "hard"] as const)}>
            {(option) => (
              <button
                type="button"
                class={`flex-1 rounded-md px-1 py-0.5 text-11-medium transition-colors ${
                  difficulty() === option ? "bg-cyan-400/15 text-cyan-600 dark:text-cyan-300" : "text-text-weak hover:text-text-base"
                }`}
                onClick={() => {
                  if (difficulty() === option) return
                  setDifficulty(option)
                  resetMinesweeper()
                }}
              >
                {option === "easy" ? "简单" : option === "normal" ? "普通" : "困难"}
              </button>
            )}
          </For>
        </div>
        <span class="text-12-medium">💣 {mineCount() - flags().size}</span>
        <span class="text-12-medium">⏱ {mineTime()}s</span>
      </div>
      <div
        class="nova-minesweeper-board grid w-full gap-1 rounded-xl border p-2"
        style={{ "grid-template-columns": `repeat(${mineCols()},minmax(0,1fr))` }}
      >
        <For each={Array.from({ length: mineRows() * mineCols() })}>
          {(_, index) => {
            const isMine = () => mines().has(index())
            const isRevealed = () => revealed().has(index())
            const isFlagged = () => flags().has(index())
            const number = () => countMines(index())
            return (
              <button
                type="button"
                class="nova-minesweeper-cell flex aspect-square items-center justify-center rounded-md text-13-medium"
                classList={{
                  "nova-minesweeper-cell-hidden": !isRevealed(),
                  "nova-minesweeper-cell-revealed": isRevealed(),
                  "nova-minesweeper-mine": isRevealed() && isMine(),
                }}
                onClick={() => clickMine(index())}
                onContextMenu={(event) => flagMine(event, index())}
                aria-label={
                  isFlagged() ? "已插旗" : isRevealed() ? (isMine() ? "地雷" : `${number()} 个相邻地雷`) : "未翻开"
                }
              >
                <Show
                  when={isFlagged()}
                  fallback={
                    <Show
                      when={isRevealed() && isMine()}
                      fallback={<Show when={isRevealed() && number() > 0}>{number()}</Show>}
                    >
                      💣
                    </Show>
                  }
                >
                  🚩
                </Show>
              </button>
            )
          }}
        </For>
      </div>
      <div class="text-center text-11-regular text-text-weak">{mineMessage()}</div>
      <button
        type="button"
        class="nova-pet-press rounded-lg bg-surface-raised-base px-4 py-1.5 text-12-medium hover:bg-cyan-400/10"
        onClick={resetMinesweeper}
      >
        {mineStatus() === "playing" ? "重新开始" : "开始新游戏"}
      </button>
    </div>
  )
}

const SUDOKU_SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179"
  .split("")
  .map(Number)
const SUDOKU_PUZZLE = "530070000600195000098000060800060003400803001700020006060000280000419005000080079"
  .split("")
  .map(Number)

function SudokuGame(props: { onReward: (score: number) => void }) {
  const [cells, setCells] = createSignal([...SUDOKU_PUZZLE])
  const [selected, setSelected] = createSignal<number>()
  const [message, setMessage] = createSignal("点击空格选择位置，再用下方数字按钮填入")
  let completed = false
  const reset = () => {
    setCells([...SUDOKU_PUZZLE])
    setSelected(undefined)
    setMessage("点击空格选择位置，再用下方数字按钮填入")
    completed = false
  }
  const fill = (value: number) => {
    const index = selected()
    if (completed || index === undefined || SUDOKU_PUZZLE[index] !== 0) return
    const next = [...cells()]
    next[index] = value
    setCells(next)
    if (next.every((cell, cellIndex) => cell === SUDOKU_SOLUTION[cellIndex])) {
      completed = true
      setMessage("数独完成！🎉")
      props.onReward(100)
    } else if (value !== SUDOKU_SOLUTION[index]) setMessage("这个数字不对，再试试看")
    else setMessage("继续完成剩余空格")
  }
  return (
    <div class="flex flex-col items-center gap-3 py-2">
      <div class="nova-sudoku-grid grid grid-cols-9 overflow-hidden rounded-lg border-2 border-cyan-500/40">
        <For each={cells()}>
          {(cell, index) => (
            <button
              type="button"
              disabled={SUDOKU_PUZZLE[index()] !== 0}
              class="nova-sudoku-cell flex aspect-square items-center justify-center border text-12-medium"
              classList={{
                "nova-sudoku-selected": selected() === index(),
                "nova-sudoku-error": cell !== 0 && SUDOKU_PUZZLE[index()] === 0 && cell !== SUDOKU_SOLUTION[index()],
              }}
              onClick={() => setSelected(index())}
            >
              {cell || ""}
            </button>
          )}
        </For>
      </div>
      <div class="grid grid-cols-5 gap-1.5">
        <For each={[1, 2, 3, 4, 5, 6, 7, 8, 9]}>
          {(value) => (
            <button
              type="button"
              class="nova-pet-press size-8 rounded-md bg-surface-raised-base text-12-medium hover:bg-cyan-400/10"
              onClick={() => fill(value)}
            >
              {value}
            </button>
          )}
        </For>
      </div>
      <div class="text-center text-11-regular text-text-weak">{message()}</div>
      <button
        type="button"
        class="nova-pet-press rounded-lg bg-surface-raised-base px-4 py-1.5 text-12-medium hover:bg-cyan-400/10"
        onClick={reset}
      >
        重开一局
      </button>
    </div>
  )
}

const TETRIS_SHAPES: Array<{ cells: number[][]; color: string }> = [
  { cells: [[1, 1, 1, 1]], color: "#22d3ee" },
  {
    cells: [
      [1, 1],
      [1, 1],
    ],
    color: "#fbbf24",
  },
  {
    cells: [
      [0, 1, 0],
      [1, 1, 1],
    ],
    color: "#a78bfa",
  },
  {
    cells: [
      [1, 0, 0],
      [1, 1, 1],
    ],
    color: "#60a5fa",
  },
  {
    cells: [
      [0, 0, 1],
      [1, 1, 1],
    ],
    color: "#fb923c",
  },
  {
    cells: [
      [0, 1, 1],
      [1, 1, 0],
    ],
    color: "#34d399",
  },
  {
    cells: [
      [1, 1, 0],
      [0, 1, 1],
    ],
    color: "#fb7185",
  },
]

type TetrisPiece = { cells: number[][]; color: string; x: number; y: number }
const newTetrisPiece = (): TetrisPiece => {
  const shape = TETRIS_SHAPES[Math.floor(Math.random() * TETRIS_SHAPES.length)]!
  return { ...shape, x: 3, y: 0 }
}

function TetrisGame(props: { onReward: (score: number) => void }) {
  const WIDTH = 10
  const HEIGHT = 16
  const [board, setBoard] = createSignal<Array<string | undefined>>(Array(WIDTH * HEIGHT).fill(undefined))
  const [piece, setPiece] = createSignal<TetrisPiece>(newTetrisPiece())
  const [score, setScore] = createSignal(0)
  const [lines, setLines] = createSignal(0)
  const [status, setStatus] = createSignal<"playing" | "over">("playing")
  let timer: ReturnType<typeof setInterval> | undefined
  let gameRoot: HTMLDivElement | undefined
  const collides = (current: TetrisPiece, x = current.x, y = current.y, cells = current.cells, target = board()) =>
    cells.some((row, rowIndex) =>
      row.some((filled, colIndex) => {
        if (!filled) return false
        const nextX = x + colIndex
        const nextY = y + rowIndex
        return nextX < 0 || nextX >= WIDTH || nextY >= HEIGHT || (nextY >= 0 && target[nextY * WIDTH + nextX])
      }),
    )
  const finish = (nextScore: number) => {
    setStatus("over")
    setScore(nextScore)
    if (timer) clearInterval(timer)
    props.onReward(nextScore)
  }
  const lock = (current: TetrisPiece) => {
    const merged = [...board()]
    current.cells.forEach((row, rowIndex) =>
      row.forEach((filled, colIndex) => {
        if (filled && current.y + rowIndex >= 0)
          merged[(current.y + rowIndex) * WIDTH + current.x + colIndex] = current.color
      }),
    )
    const remaining: Array<string | undefined> = []
    for (let row = 0; row < HEIGHT; row += 1)
      if (merged.slice(row * WIDTH, row * WIDTH + WIDTH).some((cell) => !cell))
        remaining.push(...merged.slice(row * WIDTH, row * WIDTH + WIDTH))
    const cleared = HEIGHT - remaining.length / WIDTH
    while (remaining.length < WIDTH * HEIGHT) remaining.unshift(...Array(WIDTH).fill(undefined))
    const nextScore = score() + cleared * cleared * 100
    setBoard(remaining)
    setLines((value) => value + cleared)
    const next = newTetrisPiece()
    setPiece(next)
    if (collides(next, next.x, next.y, next.cells, remaining)) finish(nextScore)
    else setScore(nextScore)
  }
  const drop = () => {
    if (status() !== "playing") return
    const current = piece()
    if (!collides(current, current.x, current.y + 1)) setPiece({ ...current, y: current.y + 1 })
    else lock(current)
  }
  const move = (dx: number) => {
    if (status() !== "playing") return
    const current = piece()
    if (!collides(current, current.x + dx)) setPiece({ ...current, x: current.x + dx })
  }
  const rotate = () => {
    if (status() !== "playing") return
    const current = piece()
    const cells = current.cells[0]!.map((_, col) => current.cells.map((row) => row[col]).reverse())
    if (!collides(current, current.x, current.y, cells)) setPiece({ ...current, cells })
  }
  const reset = () => {
    setBoard(Array(WIDTH * HEIGHT).fill(undefined))
    setPiece(newTetrisPiece())
    setScore(0)
    setLines(0)
    setStatus("playing")
    gameRoot?.focus()
  }
  const blockAt = (index: number) => {
    const current = piece()
    const row = Math.floor(index / WIDTH)
    const col = index % WIDTH
    const localRow = row - current.y
    const localCol = col - current.x
    return board()[index] ?? (current.cells[localRow]?.[localCol] ? current.color : undefined)
  }
  onMount(() => {
    gameRoot?.focus()
    timer = setInterval(drop, 550)
    const keydown = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " "].includes(event.key)) event.preventDefault()
      if (event.key === "ArrowLeft") move(-1)
      else if (event.key === "ArrowRight") move(1)
      else if (event.key === "ArrowDown") drop()
      else if (event.key === "ArrowUp") rotate()
      else if (event.key === " ") {
        while (status() === "playing" && !collides(piece(), piece().x, piece().y + 1))
          setPiece((current) => ({ ...current, y: current.y + 1 }))
        drop()
      }
    }
    window.addEventListener("keydown", keydown)
    onCleanup(() => {
      if (timer) clearInterval(timer)
      window.removeEventListener("keydown", keydown)
    })
  })
  return (
    <div ref={gameRoot} tabIndex={0} class="flex flex-col items-center gap-2 py-2 outline-none">
      <div class="flex w-full justify-between text-11-regular text-text-weak">
        <span>分数 {score()}</span>
        <span>消行 {lines()}</span>
        <span>{status() === "playing" ? "← ↓ → 移动 · ↑ 旋转" : "游戏结束"}</span>
      </div>
      <div class="nova-tetris-board grid grid-cols-10 gap-0.5 rounded-lg border p-1">
        {Array.from({ length: WIDTH * HEIGHT }, (_, index) => (
          <div
            class="nova-tetris-cell aspect-square rounded-sm"
            style={{ "background-color": blockAt(index) ?? "rgba(148,163,184,.12)" }}
          />
        ))}
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="nova-pet-press rounded bg-surface-raised-base px-3 py-1 text-12-medium"
          onClick={() => move(-1)}
        >
          ←
        </button>
        <button
          type="button"
          class="nova-pet-press rounded bg-surface-raised-base px-3 py-1 text-12-medium"
          onClick={rotate}
        >
          ↻
        </button>
        <button
          type="button"
          class="nova-pet-press rounded bg-surface-raised-base px-3 py-1 text-12-medium"
          onClick={() => move(1)}
        >
          →
        </button>
        <button
          type="button"
          class="nova-pet-press rounded bg-surface-raised-base px-3 py-1 text-12-medium"
          onClick={drop}
        >
          ↓
        </button>
      </div>
      <button
        type="button"
        class="nova-pet-press rounded-lg bg-surface-raised-base px-4 py-1.5 text-12-medium hover:bg-cyan-400/10"
        onClick={reset}
      >
        重开一局
      </button>
    </div>
  )
}

function Game2048(props: { onReward: (score: number) => void }) {
  const [tiles, setTiles] = createSignal<number[]>([])
  const [score, setScore] = createSignal(0)
  const [status, setStatus] = createSignal<"playing" | "won" | "over">("playing")
  let rewarded = false
  const addTile = (current: number[]) => {
    const empty = current.map((value, index) => (value === 0 ? index : -1)).filter((index) => index >= 0)
    if (empty.length) current[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4
    return current
  }
  const reset = () => {
    setTiles(addTile(addTile(Array(16).fill(0))))
    setScore(0)
    setStatus("playing")
    rewarded = false
  }
  const slide = (line: number[]) => {
    const values = line.filter(Boolean)
    const result: number[] = []
    let gained = 0
    for (let index = 0; index < values.length; index += 1) {
      if (values[index] === values[index + 1]) {
        const merged = values[index]! * 2
        result.push(merged)
        gained += merged
        index += 1
      } else result.push(values[index]!)
    }
    while (result.length < 4) result.push(0)
    return { result, gained }
  }
  const move = (direction: "left" | "right" | "up" | "down") => {
    if (status() !== "playing") return
    const current = [...tiles()]
    const next = Array(16).fill(0)
    let gained = 0
    for (let line = 0; line < 4; line += 1) {
      const indexes =
        direction === "left"
          ? [0, 1, 2, 3].map((offset) => line * 4 + offset)
          : direction === "right"
            ? [3, 2, 1, 0].map((offset) => line * 4 + offset)
            : direction === "up"
              ? [0, 1, 2, 3].map((offset) => offset * 4 + line)
              : [3, 2, 1, 0].map((offset) => offset * 4 + line)
      const result = slide(indexes.map((index) => current[index]!))
      gained += result.gained
      result.result.forEach((value, offset) => {
        next[indexes[offset]!] = value
      })
    }
    if (next.every((value, index) => value === current[index])) return
    const withTile = addTile(next)
    const nextScore = score() + gained
    setTiles(withTile)
    setScore(nextScore)
    if (withTile.some((value) => value >= 2048)) {
      setStatus("won")
      if (!rewarded) {
        rewarded = true
        props.onReward(nextScore)
      }
    } else if (!canMove(withTile)) {
      setStatus("over")
    }
  }
  const canMove = (current: number[]) =>
    current.some(
      (value, index) =>
        value === 0 || (index % 4 < 3 && value === current[index + 1]) || (index < 12 && value === current[index + 4]),
    )
  onMount(() => {
    reset()
    const keydown = (event: KeyboardEvent) => {
      const map: Record<string, "left" | "right" | "up" | "down"> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      }
      const direction = map[event.key]
      if (direction) {
        event.preventDefault()
        move(direction)
      }
    }
    window.addEventListener("keydown", keydown)
    onCleanup(() => window.removeEventListener("keydown", keydown))
  })
  const color = (value: number) =>
    value === 0
      ? "rgba(148,163,184,.12)"
      : value <= 4
        ? "#e0f2fe"
        : value <= 32
          ? "#a5f3fc"
          : value <= 256
            ? "#67e8f9"
            : "#22d3ee"
  return (
    <div class="flex flex-col items-center gap-3 py-2">
      <div class="flex w-full items-center justify-between text-12-medium text-text-strong">
        <span>分数 {score()}</span>
        <span>{status() === "won" ? "达成 2048！🎉" : status() === "over" ? "没有可移动的格子" : "方向键移动"}</span>
      </div>
      <div class="nova-2048-board grid grid-cols-4 gap-1.5 rounded-xl border p-2">
        {tiles().map((value) => (
          <div
            class="flex aspect-square items-center justify-center rounded-lg text-13-medium"
            style={{ "background-color": color(value), color: value > 32 ? "white" : "#164e63" }}
          >
            {value || ""}
          </div>
        ))}
      </div>
      <button
        type="button"
        class="nova-pet-press rounded-lg bg-surface-raised-base px-4 py-1.5 text-12-medium hover:bg-cyan-400/10"
        onClick={reset}
      >
        重开一局
      </button>
    </div>
  )
}

function PetPanel(props: {
  pet: FloatingPetState
  onAction: (action: "feed" | "drink" | "play") => void
  onRps: (choice: FloatingPetRpsChoice) => void
  onGame: (game: FloatingPetGame, score: number) => void
  onReaction?: (reaction: FloatingPetReaction) => void
  message?: string
  playing?: boolean
  rpsResult?: { player: FloatingPetRpsChoice; petChoice: FloatingPetRpsChoice; outcome: "win" | "lose" | "draw" }
}) {
  const gauges: Array<{
    key: keyof Pick<FloatingPetState, "satiety" | "hydration" | "mood" | "energy">
    label: string
    icon: string
    color: string
  }> = [
    { key: "satiety", label: "饱食", icon: "🍎", color: "#fb923c" },
    { key: "hydration", label: "水分", icon: "💧", color: "#38bdf8" },
    { key: "mood", label: "心情", icon: "✨", color: "#fbbf24" },
    { key: "energy", label: "精力", icon: "⚡", color: "#a78bfa" },
  ]
  const [game, setGame] = createSignal<FloatingMiniGame>()

  const openGame = (next: FloatingMiniGame) => {
    setGame(next)
  }

  return (
    <div class="h-full overflow-y-auto p-3 space-y-3" style={{ "background-color": "light-dark(#f8fbff,#0b1020)" }}>
      <div class="rounded-xl border p-3" style={{ "border-color": "light-dark(rgba(8,145,178,.2),#263249)" }}>
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-14-medium text-text-strong">Nova 宠物屋</div>
            <div class="mt-0.5 text-11-regular text-text-weak">陪你完成工作，也陪你放松一会儿</div>
          </div>
          <div class="rounded-lg bg-amber-400/15 px-2 py-1 text-12-medium text-amber-500">⭐ {props.pet.coins}</div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <For each={gauges}>
            {(gauge) => (
              <div class="rounded-lg bg-surface-raised-base p-2">
                <div class="flex items-center justify-between text-10-regular text-text-weak">
                  <span>
                    {gauge.icon} {gauge.label}
                  </span>
                  <span>{props.pet[gauge.key]}</span>
                </div>
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10">
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    style={{ width: `${props.pet[gauge.key]}%`, "background-color": gauge.color }}
                  />
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2">
        <button
          type="button"
          class="nova-pet-press rounded-xl border p-2 text-12-medium hover:bg-orange-400/10"
          onClick={() => props.onAction("feed")}
        >
          🍎
          <br />
          喂食
        </button>
        <button
          type="button"
          class="nova-pet-press rounded-xl border p-2 text-12-medium hover:bg-cyan-400/10"
          onClick={() => props.onAction("drink")}
        >
          💧
          <br />
          喝水
        </button>
        <button
          type="button"
          class="nova-pet-press rounded-xl border p-2 text-12-medium hover:bg-violet-400/10"
          onClick={() => props.onAction("play")}
        >
          🎾
          <br />
          玩耍
        </button>
      </div>

      <div class="rounded-xl border p-3" style={{ "border-color": "light-dark(rgba(8,145,178,.2),#263249)" }}>
        <div class="flex items-center justify-between">
          <span class="text-13-medium text-text-strong">和小 Nova 玩</span>
          <span class="text-10-regular text-text-weak">胜利可得星星币</span>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            type="button"
            class="nova-pet-press rounded-lg bg-surface-raised-base px-2 py-3 text-12-medium hover:bg-cyan-400/10"
            onClick={() => openGame("rps")}
          >
            ✊ 猜拳
          </button>
          <button
            type="button"
            class="nova-pet-press rounded-lg bg-surface-raised-base px-2 py-3 text-12-medium hover:bg-cyan-400/10"
            onClick={() => openGame("gomoku")}
          >
            ⚫ 五子棋
          </button>
          <button
            type="button"
            class="nova-pet-press rounded-lg bg-surface-raised-base px-2 py-3 text-12-medium hover:bg-cyan-400/10"
            onClick={() => openGame("minesweeper")}
          >
            💣 扫雷
          </button>
          <button
            type="button"
            class="nova-pet-press rounded-lg bg-surface-raised-base px-2 py-3 text-12-medium hover:bg-cyan-400/10"
            onClick={() => openGame("sudoku")}
          >
            🔢 数独
          </button>
          <button
            type="button"
            class="nova-pet-press rounded-lg bg-surface-raised-base px-2 py-3 text-12-medium hover:bg-cyan-400/10"
            onClick={() => openGame("tetris")}
          >
            🧱 方块
          </button>
          <button
            type="button"
            class="nova-pet-press rounded-lg bg-surface-raised-base px-2 py-3 text-12-medium hover:bg-cyan-400/10"
            onClick={() => openGame("2048")}
          >
            🔢 2048
          </button>
        </div>
      </div>
      <Show when={props.message}>
        <div
          class="rounded-lg bg-cyan-400/10 px-3 py-2 text-12-medium text-cyan-700 dark:text-cyan-300"
          style={{ animation: "nova-pet-slide-in 240ms ease-out both" }}
        >
          {props.message}
        </div>
      </Show>

      <Show when={game() === "rps"}>
        <GameModal title="猜拳小游戏" icon="✊" onClose={() => setGame(undefined)}>
          <RpsGame playing={props.playing} onPlay={props.onRps} lastResult={props.rpsResult} />
        </GameModal>
      </Show>
      <Show when={game() === "gomoku"}>
        <GameModal title="五子棋 · 人机对局" icon="⚫" onClose={() => setGame(undefined)}>
          <GomokuGame
            onReaction={props.onReaction}
            onReward={(score) => score !== undefined && props.onGame("gomoku", score)}
          />
        </GameModal>
      </Show>
      <Show when={game() === "minesweeper"}>
        <GameModal title="扫雷小游戏" icon="💣" onClose={() => setGame(undefined)}>
          <MinesweeperGame onReward={(score) => props.onGame("minesweeper", score)} />
        </GameModal>
      </Show>
      <Show when={game() === "sudoku"}>
        <GameModal title="数独小游戏" icon="🔢" onClose={() => setGame(undefined)}>
          <SudokuGame onReward={(score) => props.onGame("sudoku", score)} />
        </GameModal>
      </Show>
      <Show when={game() === "tetris"}>
        <GameModal title="俄罗斯方块" icon="🧱" onClose={() => setGame(undefined)}>
          <TetrisGame onReward={(score) => props.onGame("tetris", score)} />
        </GameModal>
      </Show>
      <Show when={game() === "2048"}>
        <GameModal title="2048 小游戏" icon="🔢" onClose={() => setGame(undefined)}>
          <Game2048 onReward={(score) => props.onGame("2048", score)} />
        </GameModal>
      </Show>
    </div>
  )
}

render(() => {
  const platform = createPlatform()
  const [sidecar] = createResource(() => window.api.awaitInitialization(() => undefined))
  let panelVisible = false
  const [panelOpening, setPanelOpening] = createSignal(false)
  const [skinMenuOpening, setSkinMenuOpening] = createSignal(false)
  const [currentAgent, setCurrentAgent] = createSignal<string | undefined>(undefined)
  const [agents, setAgents] = createSignal<AgentItem[]>([])
  const [tasks, setTasks] = createSignal<Task[]>([])
  const [taskGroups, setTaskGroups] = createSignal<TaskGroup[]>([])
  const [currentTaskGroupID, setCurrentTaskGroupID] = createSignal<string | undefined>(undefined)
  const [taskEvents, setTaskEvents] = createSignal<TaskEvent[]>([])
  const [notifications, setNotifications] = createSignal<PetNotification[]>([])
  const [petSkin, setPetSkin] = createSignal<PetSkin>("snow")
  const [pet, setPet] = createSignal<FloatingPetState>(defaultPet)
  const [petMessage, setPetMessage] = createSignal<string>()
  const [petPlaying, setPetPlaying] = createSignal(false)
  const [petRpsResult, setPetRpsResult] = createSignal<{
    player: FloatingPetRpsChoice
    petChoice: FloatingPetRpsChoice
    outcome: "win" | "lose" | "draw"
  }>()
  const [petReaction, setPetReaction] = createSignal<{ name: FloatingPetReaction; id: number }>({ name: "feed", id: 0 })
  const [activePet, setActivePet] = createSignal(false)
  const [hoverPetHouse, setHoverPetHouse] = createSignal(false)
  const [widgetVisible, setWidgetVisible] = createSignal(false)
  const [widgetListenersReady, setWidgetListenersReady] = createSignal(false)
  const [panelTab, setPanelTab] = createSignal<"monitor" | "notifications" | "pet">(initialPanelTab)
  const [minimalMode, setMinimalMode] = createSignal<boolean>(false)

  let hasActiveTasks = false
  let userDismissedActiveTasks = false
  let petHouseClickAt = 0

  const applyState = (state: Awaited<ReturnType<typeof window.api.getFloatingAgentState>>) => {
    setCurrentAgent(state.current)
    setAgents(state.agents)
    setTasks((state.tasks as Task[] | undefined) ?? [])
    setTaskGroups((state.taskGroups as TaskGroup[] | undefined) ?? [])
    setCurrentTaskGroupID(state.currentTaskGroupID)
    setTaskEvents((state.taskEvents as TaskEvent[] | undefined) ?? [])
    setNotifications((state.notifications as PetNotification[] | undefined) ?? [])
    setPetSkin(state.petSkin ?? "snow")
    setPet(state.pet ?? defaultPet)
    if (state.petReaction) {
      setPetReaction({ name: state.petReaction.name, id: state.petReaction.id })
    }
    const activeTasks = ((state.taskGroups?.flatMap((group) => group.tasks) ?? state.tasks ?? []) as Task[]).some(
      (task) => task.status !== "completed" && task.status !== "cancelled",
    )
    if (!activeTasks) userDismissedActiveTasks = false
    if (!panelOnly && !skinOnly && activeTasks && !hasActiveTasks && !userDismissedActiveTasks) {
      panelVisible = true
      setPanelOpening(true)
      void window.api.setFloatingExpanded(true)
    }
    hasActiveTasks = activeTasks
  }

  const refreshState = async () => {
    applyState(await window.api.getFloatingAgentState())
  }

  onMount(() => {
    void refreshState()

    const cleanupAgent = window.api.onFloatingAgentChange?.((state) => {
      applyState(state)
    })
    const cleanupExpanded = window.api.onFloatingExpandedChange?.((expanded) => {
      if (panelOnly) return
      panelVisible = expanded
      if (!expanded && hasActiveTasks) userDismissedActiveTasks = true
      setPanelOpening(false)
    })
    const cleanupPanelTab = window.api.onFloatingPanelTabChange?.((tab) => {
      if (!panelOnly) return
      setPanelTab(tab)
    })
    const cleanupSkinMenu = window.api.onFloatingSkinMenuChange?.(() => {
      if (skinOnly) return
      setSkinMenuOpening(false)
    })
    const cleanupVisibility = window.api.onFloatingVisibilityChange?.((visible) => {
      if (panelOnly || skinOnly) return
      setWidgetVisible(visible)
    })
    const cleanupModeChange = window.api.onFloatingModeChange?.((mode: "full" | "minimal") => {
      if (panelOnly || skinOnly) return
      setMinimalMode(mode === "minimal")
    })
    setWidgetListenersReady(true)

    // 命中与穿透由主进程轮询；进入热区时切换抓取光标
    const applyCursor = (active: boolean) => {
      const value = active ? "grab" : ""
      document.documentElement.style.cursor = value
      document.body.style.cursor = value
      root?.style.setProperty("cursor", value)
    }
    const cleanupCursor = window.api.onFloatingCursorActive?.((active) => {
      applyCursor(active)
      setActivePet(active)
    })

    onCleanup(() => {
      cleanupAgent?.()
      cleanupExpanded?.()
      cleanupPanelTab?.()
      cleanupSkinMenu?.()
      cleanupVisibility?.()
      cleanupModeChange?.()
      cleanupCursor?.()
      applyCursor(false)
    })
  })

  createEffect(() => {
    if (panelOnly || skinOnly || !widgetListenersReady() || !sidecar()) return
    window.api.floatingWidgetReady?.()
  })

  const current = () => agents().find((item) => item.name === currentAgent())
  const orderedTaskGroups = () =>
    [...taskGroups()].sort(
      (a, b) =>
        Number(b.id === currentTaskGroupID()) - Number(a.id === currentTaskGroupID()) ||
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    )
  const monitorSummary = () => {
    const activeGroups = orderedTaskGroups().filter((group) =>
      group.tasks.some((task) => task.status !== "completed" && task.status !== "cancelled"),
    )
    if (activeGroups.length === 0) return undefined
    const all = activeGroups.flatMap((group) => group.tasks)
    const active = all.filter((task) => task.status === "in_progress").length
    const pending = all.filter((task) => task.status === "pending").length
    const completed = all.filter((task) => task.status === "completed").length
    return t("assistant.thought.taskStatus", { active, pending, completed, total: all.length })
  }
  const applyPetSkin = (skin: PetSkin) => {
    setPetSkin(skin)
    void window.api.setFloatingPetSkin(skin)
  }
  const unreadNotifications = () => notifications().filter((notification) => !notification.read).length
  const markNotificationsRead = (ids?: string[]) => {
    void window.api.markFloatingNotificationsRead?.(ids)
  }
  const clearReadNotifications = () => {
    void window.api.clearFloatingNotifications()
  }
  const openNotification = (notification: PetNotification) => {
    void window.api.openFloatingNotification(notification.id)
  }
  const runPetAction = async (action: "feed" | "drink" | "play") => {
    setPetReaction({ name: action, id: petReaction().id + 1 })
    const result = await window.api.petAction(action)
    setPet(result.pet)
    setPetMessage(`${result.message}${result.reward ? ` +${result.reward} 星星币` : ""}`)
  }
  const playRps = async (choice: FloatingPetRpsChoice) => {
    setPetPlaying(true)
    try {
      const result = await window.api.playFloatingPetRps(choice)
      setPet(result.pet)
      setPetRpsResult({ player: result.player, petChoice: result.petChoice, outcome: result.outcome })
      setPetMessage(`${result.message}${result.reward ? ` +${result.reward} 星星币` : ""}`)
    } finally {
      setPetPlaying(false)
    }
  }
  const claimGameReward = async (game: FloatingPetGame, score: number) => {
    const result = await window.api.claimFloatingPetGameReward(game, score)
    setPet(result.pet)
    setPetMessage(result.message)
  }
  const handlePetHousePointerDown = (event: PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    petHouseClickAt = Date.now()
    panelVisible = true
    setPanelOpening(true)
    void window.api.setFloatingExpanded(true, "pet")
  }

  const handlePetHouseClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const handleMinimalClick = () => {
    if (!minimalMode()) return
    void window.api.setFloatingExpanded(true)
  }

  const toggleExpand = () => {
    if (Date.now() - petHouseClickAt < 500) return
    if (panelOnly) {
      void window.api.setFloatingExpanded(false)
      return
    }

    panelVisible = !panelVisible
    if (!panelVisible && hasActiveTasks) userDismissedActiveTasks = true
    if (panelVisible) userDismissedActiveTasks = false
    setPanelOpening(panelVisible)
    void window.api.setFloatingExpanded(panelVisible)
  }

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <Show when={sidecar()}>
          <Show when={minimalMode()}>
            <div
              class="w-full h-full flex items-center justify-center"
              onClick={handleMinimalClick}
              title="打开 NovaWay"
            >
              <div class="size-10 rounded-full bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center hover:bg-cyan-500/30 transition-colors">
                <img src={logoUrl} alt="NovaWay" class="size-7 object-contain" draggable={false} />
              </div>
            </div>
          </Show>
          <Show when={!minimalMode()}>
            <div
              class={
                skinOnly || panelOnly
                  ? "relative w-full h-full"
                  : `relative w-full h-full bg-transparent flex items-end justify-center p-4 ${
                      widgetVisible() ? "nova-floating-widget-enter" : "nova-floating-widget-pending"
                    }`
              }
            >
              <Show
                when={skinOnly}
                fallback={
                  <Show
                    when={panelOnly && panelTab() === "pet"}
                    fallback={
                      <AssistantPanel
                        class={panelOnly ? "" : "relative"}
                        currentAgent={current()}
                        agents={agents()}
                        tasks={tasks()}
                        taskGroups={orderedTaskGroups()}
                        currentTaskGroupID={currentTaskGroupID()}
                        monitorSummary={monitorSummary()}
                        taskEvents={taskEvents()}
                        notifications={notifications()}
                        onNotificationsRead={markNotificationsRead}
                        onNotificationsClearRead={clearReadNotifications}
                        onNotificationOpen={openNotification}
                        initialTab={
                          panelOnly ? (panelTab() === "notifications" ? "notifications" : "monitor") : undefined
                        }
                        expanded={panelOnly}
                        onExpandToggle={toggleExpand}
                        onAgentChange={(name) => {
                          void window.api.setFloatingAgent(name)
                          setCurrentAgent(name)
                        }}
                        petSkin={petSkin()}
                        onPetSkinChange={applyPetSkin}
                        onSkinMenuToggle={() => {
                          setSkinMenuOpening(true)
                          void window.api.toggleFloatingSkinMenu()
                        }}
                        opening={panelOpening() || skinMenuOpening()}
                        onDragStart={(pointerX, pointerY) => {
                          if (panelOnly) return
                          window.api.beginFloatingWidgetDrag?.(pointerX, pointerY)
                        }}
                        onDragMove={(pointerX, pointerY) => {
                          if (panelOnly) return
                          if (!("beginFloatingWidgetDrag" in window.api)) return
                          window.api.moveFloatingWidget(pointerX, pointerY)
                        }}
                        onDragEnd={() => {
                          if (panelOnly) return
                          void window.api.saveFloatingWidgetBounds()
                        }}
                        title={t("assistant.title")}
                        hasInProgressTask={hasActiveTasks}
                        unreadNotifications={unreadNotifications()}
                        draggable={!panelOnly}
                        panelOnly={panelOnly}
                        petReaction={petReaction()}
                      />
                    }
                  >
                    <PetPanel
                      pet={pet()}
                      onAction={runPetAction}
                      onRps={playRps}
                      onGame={claimGameReward}
                      onReaction={(reaction) => setPetReaction({ name: reaction, id: petReaction().id + 1 })}
                      message={petMessage()}
                      playing={petPlaying()}
                      rpsResult={petRpsResult()}
                    />
                  </Show>
                }
              >
                <SkinMenu skin={petSkin()} onChange={applyPetSkin} />
              </Show>
              <Show
                when={!panelOnly && !skinOnly && !minimalMode() && widgetVisible() && (activePet() || hoverPetHouse())}
              >
                <button
                  type="button"
                  class="nova-pet-house pointer-events-auto absolute z-[100] rounded-full border bg-background-base/95 px-3 py-1.5 text-11-medium text-text-strong shadow-lg hover:bg-cyan-400/10 transition-all duration-200"
                  style={{ left: "calc(50% + 5.5rem)", bottom: "1.5rem" }}
                  title="打开宠物屋"
                  data-no-drag
                  onPointerDown={handlePetHousePointerDown}
                  onPointerUp={(event) => event.stopPropagation()}
                  onMouseEnter={() => setHoverPetHouse(true)}
                  onMouseLeave={() => setHoverPetHouse(false)}
                  onClick={handlePetHouseClick}
                >
                  🐾 宠物屋
                </button>
              </Show>
            </div>
          </Show>
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
