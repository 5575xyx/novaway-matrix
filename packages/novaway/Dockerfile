FROM node:22-alpine

# 运行期依赖：ripgrep 由 CLI 直接调用。
RUN apk add --no-cache ripgrep

# 安装主包；平台二进制包会按 os/cpu 自动选中（见 script/publish.ts 的 optionalDependencies）。
ARG NOVAWAY_VERSION=latest
RUN npm install -g "xymt-novaway@${NOVAWAY_VERSION}"

RUN novaway --version
ENTRYPOINT ["novaway"]
