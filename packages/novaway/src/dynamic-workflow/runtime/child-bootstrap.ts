/**
 * 沙箱内运行的引导脚本。
 *
 * 为什么是字符串而不是一个可以用 `toString()` 内嵌的函数：入口文件必须**自包含**，而
 * `toString()` 在 `minify + keepNames` 的构建下会把内层函数改写成 `__name(fn, "x")`，
 * 那个 helper 在模块作用域里，内嵌出去就是 ReferenceError——只在压缩过的发布产物里坏，
 * 源码测试全绿。字符串没有这个风险：它在任何构建形态下都是同一段文本。
 *
 * 代价是这段代码不参与类型检查。所以它刻意写得短、只用 ES5 语法、不引用任何外部绑定，
 * 并且由 `runtime.test.ts` 真的跑一遍。
 *
 * 三个约束（改的时候别破坏）：
 *   1. **没有反引号、没有 `${`**。它以 String.raw 模板承载，那两个字符会结束或插值模板。
 *   2. **不引用任何模块作用域的绑定**。运行它的 vm context 里只有下面这些全局。
 *   3. **只用 var / function / class**。没有 `let`/`const` 的问题，但保持风格一致更省事。
 *
 * 它建立的全局：`__host`、`__deliver`、`__execute`、`__checkStalled`；读取的宿主全局：
 * `__send(string)`、`__argsJson(string)`。
 */

export const CHILD_BOOTSTRAP = String.raw`
"use strict";

var __nextLocal = 0;
var __nextReq = 0;
var __pending = new Map();

function __emit(obj) {
  __send(JSON.stringify(obj));
}

function __createActor(siteId, name, persona) {
  // 同步造 child-local 句柄并即发即忘 create-actor；父进程据 stdio FIFO 在后续 ask 前完成映射。
  var localId = "local#" + (++__nextLocal);
  __emit({ kind: "create-actor", localId: localId, siteId: siteId, name: name, persona: persona });
  return localId;
}

function __request(type, payload) {
  var id = "r" + (++__nextReq);
  return new Promise(function (resolve, reject) {
    __pending.set(id, { resolve: resolve, reject: reject });
    var message = { kind: "request", id: id, type: type };
    for (var key in payload) message[key] = payload[key];
    __emit(message);
  });
}

function __ask(siteId, actor, instructions) {
  return __request("ask", { siteId: siteId, actor: actor, instructions: instructions });
}

function __worldRead(siteId, op, args) {
  // args 是 lowering 打包好的位置实参数组：原样透传，不看 op、不校验元数（归驱动）。
  return __request("world-read", { siteId: siteId, op: op, args: args });
}

function __report(siteId, item) {
  // 即发即忘：脚本从不 await 它，所以走事件通道。item 里若有环，这里的 JSON.stringify
  // 会抛错——就在 report() 的调用点上，脚本要么 catch 要么让 run 失败。
  __emit({ kind: "event", type: "report", siteId: siteId, item: item });
}

function __enterPhase(name) {
  __emit({ kind: "event", type: "phase-entered", name: String(name) });
}

function __log(message) {
  __emit({ kind: "event", type: "log", message: String(message) });
}

// —— 运行实参 ——
// 与其余 host 值一样在 context **内**用 JSON.parse 构造，脚本拿到的是 context-native 对象，
// 外层 realm 的 intrinsics 一点都不掺进来。
// Object.freeze 是**浅**冻结：嵌套对象未冻结，脚本仍能改动 args.foo.bar。这与门面声明里的
// Readonly<Record<string, unknown>> 对上——它挡的是「手滑重新赋值 args」，不是安全边界。
var __args = Object.freeze(JSON.parse(__argsJson));

globalThis.__host = {
  args: __args,
  createActor: __createActor,
  ask: __ask,
  worldRead: __worldRead,
  report: __report,
  log: __log,
  enterPhase: __enterPhase,
};

// —— 入站 response 消费（由外层以行字符串调用）——
globalThis.__deliver = function (line) {
  var msg = JSON.parse(line);
  if (msg.kind !== "response") return;
  var waiter = __pending.get(msg.id);
  if (!waiter) return;
  __pending.delete(msg.id);
  if (msg.ok) {
    waiter.resolve(msg.value);
    return;
  }
  // 拒绝以 context-native Error 过界，带上 code 供脚本 try/catch 结构化处理。
  var e = msg.error || {};
  var err = new Error(e.message || "workflow host error");
  if (e.name) err.name = e.name;
  if (e.code !== undefined) err.code = e.code;
  waiter.reject(err);
};

// run 是否已发出 complete。停滞检测也读写它。
var __settled = false;

function __complete(ok, payload) {
  if (__settled) return;
  __settled = true;
  if (ok) {
    __emit({ kind: "complete", ok: true, value: payload });
    return;
  }
  var wire;
  if (payload instanceof Error) {
    wire = { name: payload.name, message: payload.message, stack: payload.stack, code: payload.code };
  } else {
    wire = { name: "Error", message: String(payload) };
  }
  __emit({ kind: "complete", ok: false, error: wire });
}

// 外层调用它跑脚本；始终 resolve（错误已转成 complete 消息），便于外层收尾。
globalThis.__execute = async function (runFn) {
  try {
    var value = await runFn(globalThis.__host);
    __complete(true, value);
  } catch (e) {
    __complete(false, e);
  }
};

// —— 运行期禁令（belt；编译期诊断是 suspenders）——
// 三条都是不确定性的来源：恢复要求同一份脚本逐字节重放到同一个输入，而时间与随机数会让
// 两次生命走出不同的分支。挡住它们，purity 才是真的。
var __NativeDate = Date;
class __WorkflowDate extends __NativeDate {
  constructor() {
    if (arguments.length === 0) throw new Error("argless new Date() is disabled in workflows");
    super(...arguments);
  }
  static now() {
    throw new Error("Date.now() is disabled in workflows");
  }
  static parse(value) {
    return __NativeDate.parse(value);
  }
  static UTC() {
    return __NativeDate.UTC.apply(__NativeDate, arguments);
  }
}
globalThis.Date = __WorkflowDate;
Math.random = function () {
  throw new Error("Math.random() is disabled in workflows");
};

// —— 停滞检测 ——
// cell 没有定时器、没有 I/O：能唤醒挂起脚本的只有 host response。于是「没有在飞请求、微任务
// 已排空、脚本未完成」就等价于「永远不会再有任何事发生」。外层在每条 response 投递之后与
// 脚本起步之后各调一次（setImmediate，在微任务之后），命中即以 error-complete 结束 run，
// 而不是让 run 永远挂着。
globalThis.__checkStalled = function () {
  if (__settled || __pending.size > 0) return false;
  var err = new Error(
    "Stalled: the script is suspended with no request in flight, so nothing can ever resolve what it awaits (a promise that is never settled)."
  );
  err.name = "ScriptStalled";
  err.code = "ScriptStalled";
  __complete(false, err);
  return true;
};
`
