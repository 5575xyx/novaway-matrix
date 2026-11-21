const shardCount = Number(process.env.NOVAWAY_HTTPAPI_EFFECT_SHARDS ?? "4")
if (!Number.isInteger(shardCount) || shardCount < 1) {
  throw new Error(`invalid NOVAWAY_HTTPAPI_EFFECT_SHARDS: ${process.env.NOVAWAY_HTTPAPI_EFFECT_SHARDS}`)
}

async function runShard(shard: number) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "script/httpapi-exercise.ts",
        "--mode",
        "effect",
        "--fail-on-missing",
        "--fail-on-skip",
        "--shard",
        String(shard),
        "--shards",
        String(shardCount),
      ],
      {
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      },
    )
    const exitCode = await child.exited
    if (exitCode === 0) return 0
    if (attempt < 2) console.error(`HTTP effect shard ${shard} failed; retrying once`)
  }
  return 1
}

const exitCodes: number[] = []
for (let shard = 0; shard < shardCount; shard++) exitCodes.push(await runShard(shard))
const failures = exitCodes.filter((code) => code !== 0)
if (failures.length > 0) {
  throw new Error(`${failures.length}/${shardCount} HTTP effect shards failed after one retry`)
}
