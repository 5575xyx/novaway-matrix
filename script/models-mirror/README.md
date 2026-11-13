# models.dev 自建镜像

本目录是 fork `sst/models.dev`（已转移至 `anomalyco/models.dev`，旧地址自动重定向）后要加进去的文件模板。镜像只发布 `api.json` 和供应商 logos（GitHub Pages），不部署网站。

注意：上游 Bedrock 模型文件名含冒号（`...-v1:0.toml`），Windows 无法完整检出该仓库。本地克隆只能做只读参考，workflow 构建在 Linux CI 上跑，不受影响。

本项目运行时默认源已指向 `https://5575xyx.github.io/models.dev`（见 `packages/core/src/models-dev.ts` 的 `DEFAULT_MODELS_URL`），仍可用 `NOVAWAY_MODELS_URL` 覆盖。

## 搭建步骤

1. 在 GitHub 上 fork `sst/models.dev`（默认分支是 `dev`）。
2. fork 仓库 Settings → Actions → General：把继承来的上游 workflows 全部禁用（Disable actions 后再单独启用本 workflow，或直接删掉 `.github/workflows/` 里上游的文件，只留 `sync-upstream.yml`）。上游的自动同步/自动修 issue 任务不该在 fork 上跑。
3. 把本目录的文件复制进 fork：
   - `sync-upstream.yml` → `.github/workflows/sync-upstream.yml`
   - `generate-api.ts` → `script/generate-api.ts`
4. fork 仓库 Settings → Pages：Source 选 **GitHub Actions**。
5. Actions 页手动触发一次 `sync-upstream`，成功后验证：
   - `https://<账号>.github.io/models.dev/api.json`
   - `https://<账号>.github.io/models.dev/logos/openai.svg`

## 日常运行

- 每天 02:00 UTC（北京 10:00）自动合并上游 `dev` → `bun validate` 校验 → 生成并发布。
- 合并冲突时 CI 会失败（自定义供应商是新增文件，正常不会冲突）：本地 `git fetch upstream && git merge upstream/dev` 解决后推送，再手动触发 workflow。
- 上游数据结构要求见 fork 里的 `AGENTS.md`（TOML schema = 2、logo 规范、价格 USD 等）。

## 添加自定义供应商

在 fork 里新增 `providers/<provider-id>/`：

```
providers/novaway/
  provider.toml    # name / npm / env / api 等
  logo.svg         # currentColor、无固定宽高，规范见上游 AGENTS.md
  models/**/*.toml # schema = 2；非自研模型用 base_model 指向 models/ 下的厂商档案
```

提交推送后手动触发 workflow（或等每日同步）即可生效。改完本地可先跑 `bun validate` 自检。

## 许可

上游 MIT，保留 fork 中的 `LICENSE` 即可。
