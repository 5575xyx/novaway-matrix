# 项目验证（E2E / 测试 / 类型检查）

模型可以在收尾前跑项目自己的验证命令，用结果决定"继续修"还是"交付"。

## 工具

`run_verification`

- `action=list`：列出探测到的命令
- `action=run`：执行；可用 `id` 指定具体命令，或 `kind` 选 `test` / `e2e` / `typecheck` / `lint` / `build`

## 命令来源

按项目现有配置自动探测，不内置任何框架：

| 来源           | 命令                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `package.json` | `test:e2e` / `e2e` / `test` / `test:unit` / `typecheck` / `lint` / `build` |
| `go.mod`       | `go test ./...`、`go vet ./...`                                            |
| `Cargo.toml`   | `cargo test`、`cargo check`                                                |
| Python 项目    | `python -m pytest -q`                                                      |
| `Makefile`     | `make test` / `make lint` / `make build`                                   |

包管理器按 lockfile 推断：bun / pnpm / yarn / npm。

## 结果

退出码决定成败。输出里能解析出通过/失败数量时一并返回，
支持 Jest、Vitest、Pytest、Cargo、Go 的常见格式；失败用例名最多列 10 条。

超时默认 10 分钟，可用 `timeout_ms` 覆盖；中止会话会终止子进程。

## E2E

E2E 走同一套机制：只要项目里存在 `test:e2e` 或 `e2e` 脚本，
`run_verification` 就会把它列为可选命令。需要浏览器时配合内置的浏览器工具做交互验证。
