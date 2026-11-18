# NovaWay 官方插件市场验收

当前官方市场不再发布 Smoke 测试插件。官方完整验收对象是 `com.novaway.office-suite@0.2.0`。

## Office Workbench

- 真实 ZIP 由 `NOVAWAY_OFFICE_PLUGIN_ARCHIVE` 提供给 `test/plugin/office-marketplace.test.ts`；
- 安装、SHA-256、Plugin Host v2 发现和激活通过后，注册 9 个 Agent、10 个 Skill、1 个 Tool、1 个 Command；
- `office-suite_ppt-master` 位于 Office Suite 包内，单独 `com.novaway.ppt-master` 不再存在；
- Creova/forge 在不切换办公工作台的情况下可以发现并调用已激活的 Office 贡献；
- 停用和卸载会释放办公工作台、Agent、Skill、Tool、Command 和 PPT Master 资源。

## 运行

```bash
cd packages/novaway
NOVAWAY_OFFICE_PLUGIN_ARCHIVE=../../novaway-plugins/dist/com.novaway.office-suite-0.2.0.zip bun test test/plugin/office-marketplace.test.ts
```
