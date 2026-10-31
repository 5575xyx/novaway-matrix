/**
 * 扩展目录的「代数」。
 *
 * 扩展与技能列表都是按实例缓存的首个快照（`InstanceState`）。后台自动安装
 * （见 ./provision.ts）发生在服务启动之后，装完如果不通知缓存，用户会一直看到
 * 「没装」的旧列表，要等重启。这里用一个进程内计数器解决：
 *
 * - 任何写盘操作结束后调用 `bump()`；
 * - 读取方在取缓存前比较 `current()`，不一致就作废重读。
 *
 * 不监听文件系统事件：只在「我们自己改了目录」时失效，成本为零。
 */
let revision = 0

export function bump() {
  revision += 1
  return revision
}

export function current() {
  return revision
}
