var Ye = Object.create
var Ie = Object.defineProperty
var Ze = Object.getOwnPropertyDescriptor
var Qe = Object.getOwnPropertyNames
var er = Object.getPrototypeOf,
  rr = Object.prototype.hasOwnProperty
var tr = (t, e) => () => (t && (e = t((t = 0))), e)
var ne = (t, e) => () => (e || t((e = { exports: {} }).exports, e), e.exports)
var nr = (t, e, r, n) => {
  if ((e && typeof e == "object") || typeof e == "function")
    for (let i of Qe(e))
      !rr.call(t, i) && i !== r && Ie(t, i, { get: () => e[i], enumerable: !(n = Ze(e, i)) || n.enumerable })
  return t
}
var ir = (t, e, r) => (
  (r = t != null ? Ye(er(t)) : {}),
  nr(e || !t || !t.__esModule ? Ie(r, "default", { value: t, enumerable: !0 }) : r, t)
)
var Be = ne((z) => {
  "use strict"
  B()
  z.byteLength = sr
  z.toByteArray = fr
  z.fromByteArray = dr
  var T = [],
    k = [],
    or = typeof Uint8Array < "u" ? Uint8Array : Array,
    ie = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  for (N = 0, Ee = ie.length; N < Ee; ++N) ((T[N] = ie[N]), (k[ie.charCodeAt(N)] = N))
  var N, Ee
  k[45] = 62
  k[95] = 63
  function Ae(t) {
    var e = t.length
    if (e % 4 > 0) throw new Error("Invalid string. Length must be a multiple of 4")
    var r = t.indexOf("=")
    r === -1 && (r = e)
    var n = r === e ? 0 : 4 - (r % 4)
    return [r, n]
  }
  function sr(t) {
    var e = Ae(t),
      r = e[0],
      n = e[1]
    return ((r + n) * 3) / 4 - n
  }
  function cr(t, e, r) {
    return ((e + r) * 3) / 4 - r
  }
  function fr(t) {
    var e,
      r = Ae(t),
      n = r[0],
      i = r[1],
      o = new or(cr(t, n, i)),
      s = 0,
      u = i > 0 ? n - 4 : n,
      x
    for (x = 0; x < u; x += 4)
      ((e =
        (k[t.charCodeAt(x)] << 18) |
        (k[t.charCodeAt(x + 1)] << 12) |
        (k[t.charCodeAt(x + 2)] << 6) |
        k[t.charCodeAt(x + 3)]),
        (o[s++] = (e >> 16) & 255),
        (o[s++] = (e >> 8) & 255),
        (o[s++] = e & 255))
    return (
      i === 2 && ((e = (k[t.charCodeAt(x)] << 2) | (k[t.charCodeAt(x + 1)] >> 4)), (o[s++] = e & 255)),
      i === 1 &&
        ((e = (k[t.charCodeAt(x)] << 10) | (k[t.charCodeAt(x + 1)] << 4) | (k[t.charCodeAt(x + 2)] >> 2)),
        (o[s++] = (e >> 8) & 255),
        (o[s++] = e & 255)),
      o
    )
  }
  function ar(t) {
    return T[(t >> 18) & 63] + T[(t >> 12) & 63] + T[(t >> 6) & 63] + T[t & 63]
  }
  function ur(t, e, r) {
    for (var n, i = [], o = e; o < r; o += 3)
      ((n = ((t[o] << 16) & 16711680) + ((t[o + 1] << 8) & 65280) + (t[o + 2] & 255)), i.push(ar(n)))
    return i.join("")
  }
  function dr(t) {
    for (var e, r = t.length, n = r % 3, i = [], o = 16383, s = 0, u = r - n; s < u; s += o)
      i.push(ur(t, s, s + o > u ? u : s + o))
    return (
      n === 1
        ? ((e = t[r - 1]), i.push(T[e >> 2] + T[(e << 4) & 63] + "=="))
        : n === 2 && ((e = (t[r - 2] << 8) + t[r - 1]), i.push(T[e >> 10] + T[(e >> 4) & 63] + T[(e << 2) & 63] + "=")),
      i.join("")
    )
  }
})
var Fe = ne((oe) => {
  B()
  oe.read = function (t, e, r, n, i) {
    var o,
      s,
      u = i * 8 - n - 1,
      x = (1 << u) - 1,
      d = x >> 1,
      p = -7,
      l = r ? i - 1 : 0,
      I = r ? -1 : 1,
      b = t[e + l]
    for (l += I, o = b & ((1 << -p) - 1), b >>= -p, p += u; p > 0; o = o * 256 + t[e + l], l += I, p -= 8);
    for (s = o & ((1 << -p) - 1), o >>= -p, p += n; p > 0; s = s * 256 + t[e + l], l += I, p -= 8);
    if (o === 0) o = 1 - d
    else {
      if (o === x) return s ? NaN : (b ? -1 : 1) * (1 / 0)
      ;((s = s + Math.pow(2, n)), (o = o - d))
    }
    return (b ? -1 : 1) * s * Math.pow(2, o - n)
  }
  oe.write = function (t, e, r, n, i, o) {
    var s,
      u,
      x,
      d = o * 8 - i - 1,
      p = (1 << d) - 1,
      l = p >> 1,
      I = i === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0,
      b = n ? 0 : o - 1,
      f = n ? 1 : -1,
      a = e < 0 || (e === 0 && 1 / e < 0) ? 1 : 0
    for (
      e = Math.abs(e),
        isNaN(e) || e === 1 / 0
          ? ((u = isNaN(e) ? 1 : 0), (s = p))
          : ((s = Math.floor(Math.log(e) / Math.LN2)),
            e * (x = Math.pow(2, -s)) < 1 && (s--, (x *= 2)),
            s + l >= 1 ? (e += I / x) : (e += I * Math.pow(2, 1 - l)),
            e * x >= 2 && (s++, (x /= 2)),
            s + l >= p
              ? ((u = 0), (s = p))
              : s + l >= 1
                ? ((u = (e * x - 1) * Math.pow(2, i)), (s = s + l))
                : ((u = e * Math.pow(2, l - 1) * Math.pow(2, i)), (s = 0)));
      i >= 8;
      t[r + b] = u & 255, b += f, u /= 256, i -= 8
    );
    for (s = (s << i) | u, d += i; d > 0; t[r + b] = s & 255, b += f, s /= 256, d -= 8);
    t[r + b - f] |= a * 128
  }
})
var $e = ne((G) => {
  "use strict"
  B()
  var se = Be(),
    $ = Fe(),
    Ue =
      typeof Symbol == "function" && typeof Symbol.for == "function" ? Symbol.for("nodejs.util.inspect.custom") : null
  G.Buffer = c
  G.SlowBuffer = gr
  G.INSPECT_MAX_BYTES = 50
  var X = 2147483647
  G.kMaxLength = X
  c.TYPED_ARRAY_SUPPORT = hr()
  !c.TYPED_ARRAY_SUPPORT &&
    typeof console < "u" &&
    typeof console.error == "function" &&
    console.error(
      "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support.",
    )
  function hr() {
    try {
      let t = new Uint8Array(1),
        e = {
          foo: function () {
            return 42
          },
        }
      return (Object.setPrototypeOf(e, Uint8Array.prototype), Object.setPrototypeOf(t, e), t.foo() === 42)
    } catch {
      return !1
    }
  }
  Object.defineProperty(c.prototype, "parent", {
    enumerable: !0,
    get: function () {
      if (c.isBuffer(this)) return this.buffer
    },
  })
  Object.defineProperty(c.prototype, "offset", {
    enumerable: !0,
    get: function () {
      if (c.isBuffer(this)) return this.byteOffset
    },
  })
  function _(t) {
    if (t > X) throw new RangeError('The value "' + t + '" is invalid for option "size"')
    let e = new Uint8Array(t)
    return (Object.setPrototypeOf(e, c.prototype), e)
  }
  function c(t, e, r) {
    if (typeof t == "number") {
      if (typeof e == "string")
        throw new TypeError('The "string" argument must be of type string. Received type number')
      return ue(t)
    }
    return ke(t, e, r)
  }
  c.poolSize = 8192
  function ke(t, e, r) {
    if (typeof t == "string") return pr(t, e)
    if (ArrayBuffer.isView(t)) return xr(t)
    if (t == null)
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " +
          typeof t,
      )
    if (
      D(t, ArrayBuffer) ||
      (t && D(t.buffer, ArrayBuffer)) ||
      (typeof SharedArrayBuffer < "u" && (D(t, SharedArrayBuffer) || (t && D(t.buffer, SharedArrayBuffer))))
    )
      return fe(t, e, r)
    if (typeof t == "number")
      throw new TypeError('The "value" argument must not be of type number. Received type number')
    let n = t.valueOf && t.valueOf()
    if (n != null && n !== t) return c.from(n, e, r)
    let i = wr(t)
    if (i) return i
    if (typeof Symbol < "u" && Symbol.toPrimitive != null && typeof t[Symbol.toPrimitive] == "function")
      return c.from(t[Symbol.toPrimitive]("string"), e, r)
    throw new TypeError(
      "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " +
        typeof t,
    )
  }
  c.from = function (t, e, r) {
    return ke(t, e, r)
  }
  Object.setPrototypeOf(c.prototype, Uint8Array.prototype)
  Object.setPrototypeOf(c, Uint8Array)
  function Ce(t) {
    if (typeof t != "number") throw new TypeError('"size" argument must be of type number')
    if (t < 0) throw new RangeError('The value "' + t + '" is invalid for option "size"')
  }
  function lr(t, e, r) {
    return (Ce(t), t <= 0 ? _(t) : e !== void 0 ? (typeof r == "string" ? _(t).fill(e, r) : _(t).fill(e)) : _(t))
  }
  c.alloc = function (t, e, r) {
    return lr(t, e, r)
  }
  function ue(t) {
    return (Ce(t), _(t < 0 ? 0 : de(t) | 0))
  }
  c.allocUnsafe = function (t) {
    return ue(t)
  }
  c.allocUnsafeSlow = function (t) {
    return ue(t)
  }
  function pr(t, e) {
    if (((typeof e != "string" || e === "") && (e = "utf8"), !c.isEncoding(e)))
      throw new TypeError("Unknown encoding: " + e)
    let r = Te(t, e) | 0,
      n = _(r),
      i = n.write(t, e)
    return (i !== r && (n = n.slice(0, i)), n)
  }
  function ce(t) {
    let e = t.length < 0 ? 0 : de(t.length) | 0,
      r = _(e)
    for (let n = 0; n < e; n += 1) r[n] = t[n] & 255
    return r
  }
  function xr(t) {
    if (D(t, Uint8Array)) {
      let e = new Uint8Array(t)
      return fe(e.buffer, e.byteOffset, e.byteLength)
    }
    return ce(t)
  }
  function fe(t, e, r) {
    if (e < 0 || t.byteLength < e) throw new RangeError('"offset" is outside of buffer bounds')
    if (t.byteLength < e + (r || 0)) throw new RangeError('"length" is outside of buffer bounds')
    let n
    return (
      e === void 0 && r === void 0
        ? (n = new Uint8Array(t))
        : r === void 0
          ? (n = new Uint8Array(t, e))
          : (n = new Uint8Array(t, e, r)),
      Object.setPrototypeOf(n, c.prototype),
      n
    )
  }
  function wr(t) {
    if (c.isBuffer(t)) {
      let e = de(t.length) | 0,
        r = _(e)
      return (r.length === 0 || t.copy(r, 0, 0, e), r)
    }
    if (t.length !== void 0) return typeof t.length != "number" || le(t.length) ? _(0) : ce(t)
    if (t.type === "Buffer" && Array.isArray(t.data)) return ce(t.data)
  }
  function de(t) {
    if (t >= X)
      throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + X.toString(16) + " bytes")
    return t | 0
  }
  function gr(t) {
    return (+t != t && (t = 0), c.alloc(+t))
  }
  c.isBuffer = function (e) {
    return e != null && e._isBuffer === !0 && e !== c.prototype
  }
  c.compare = function (e, r) {
    if (
      (D(e, Uint8Array) && (e = c.from(e, e.offset, e.byteLength)),
      D(r, Uint8Array) && (r = c.from(r, r.offset, r.byteLength)),
      !c.isBuffer(e) || !c.isBuffer(r))
    )
      throw new TypeError('The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array')
    if (e === r) return 0
    let n = e.length,
      i = r.length
    for (let o = 0, s = Math.min(n, i); o < s; ++o)
      if (e[o] !== r[o]) {
        ;((n = e[o]), (i = r[o]))
        break
      }
    return n < i ? -1 : i < n ? 1 : 0
  }
  c.isEncoding = function (e) {
    switch (String(e).toLowerCase()) {
      case "hex":
      case "utf8":
      case "utf-8":
      case "ascii":
      case "latin1":
      case "binary":
      case "base64":
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return !0
      default:
        return !1
    }
  }
  c.concat = function (e, r) {
    if (!Array.isArray(e)) throw new TypeError('"list" argument must be an Array of Buffers')
    if (e.length === 0) return c.alloc(0)
    let n
    if (r === void 0) for (r = 0, n = 0; n < e.length; ++n) r += e[n].length
    let i = c.allocUnsafe(r),
      o = 0
    for (n = 0; n < e.length; ++n) {
      let s = e[n]
      if (D(s, Uint8Array))
        o + s.length > i.length
          ? (c.isBuffer(s) || (s = c.from(s)), s.copy(i, o))
          : Uint8Array.prototype.set.call(i, s, o)
      else if (c.isBuffer(s)) s.copy(i, o)
      else throw new TypeError('"list" argument must be an Array of Buffers')
      o += s.length
    }
    return i
  }
  function Te(t, e) {
    if (c.isBuffer(t)) return t.length
    if (ArrayBuffer.isView(t) || D(t, ArrayBuffer)) return t.byteLength
    if (typeof t != "string")
      throw new TypeError(
        'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof t,
      )
    let r = t.length,
      n = arguments.length > 2 && arguments[2] === !0
    if (!n && r === 0) return 0
    let i = !1
    for (;;)
      switch (e) {
        case "ascii":
        case "latin1":
        case "binary":
          return r
        case "utf8":
        case "utf-8":
          return ae(t).length
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return r * 2
        case "hex":
          return r >>> 1
        case "base64":
          return Je(t).length
        default:
          if (i) return n ? -1 : ae(t).length
          ;((e = ("" + e).toLowerCase()), (i = !0))
      }
  }
  c.byteLength = Te
  function yr(t, e, r) {
    let n = !1
    if (
      ((e === void 0 || e < 0) && (e = 0),
      e > this.length ||
        ((r === void 0 || r > this.length) && (r = this.length), r <= 0) ||
        ((r >>>= 0), (e >>>= 0), r <= e))
    )
      return ""
    for (t || (t = "utf8"); ; )
      switch (t) {
        case "hex":
          return Sr(this, e, r)
        case "utf8":
        case "utf-8":
          return De(this, e, r)
        case "ascii":
          return Ur(this, e, r)
        case "latin1":
        case "binary":
          return Rr(this, e, r)
        case "base64":
          return Br(this, e, r)
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return Lr(this, e, r)
        default:
          if (n) throw new TypeError("Unknown encoding: " + t)
          ;((t = (t + "").toLowerCase()), (n = !0))
      }
  }
  c.prototype._isBuffer = !0
  function P(t, e, r) {
    let n = t[e]
    ;((t[e] = t[r]), (t[r] = n))
  }
  c.prototype.swap16 = function () {
    let e = this.length
    if (e % 2 !== 0) throw new RangeError("Buffer size must be a multiple of 16-bits")
    for (let r = 0; r < e; r += 2) P(this, r, r + 1)
    return this
  }
  c.prototype.swap32 = function () {
    let e = this.length
    if (e % 4 !== 0) throw new RangeError("Buffer size must be a multiple of 32-bits")
    for (let r = 0; r < e; r += 4) (P(this, r, r + 3), P(this, r + 1, r + 2))
    return this
  }
  c.prototype.swap64 = function () {
    let e = this.length
    if (e % 8 !== 0) throw new RangeError("Buffer size must be a multiple of 64-bits")
    for (let r = 0; r < e; r += 8)
      (P(this, r, r + 7), P(this, r + 1, r + 6), P(this, r + 2, r + 5), P(this, r + 3, r + 4))
    return this
  }
  c.prototype.toString = function () {
    let e = this.length
    return e === 0 ? "" : arguments.length === 0 ? De(this, 0, e) : yr.apply(this, arguments)
  }
  c.prototype.toLocaleString = c.prototype.toString
  c.prototype.equals = function (e) {
    if (!c.isBuffer(e)) throw new TypeError("Argument must be a Buffer")
    return this === e ? !0 : c.compare(this, e) === 0
  }
  c.prototype.inspect = function () {
    let e = "",
      r = G.INSPECT_MAX_BYTES
    return (
      (e = this.toString("hex", 0, r)
        .replace(/(.{2})/g, "$1 ")
        .trim()),
      this.length > r && (e += " ... "),
      "<Buffer " + e + ">"
    )
  }
  Ue && (c.prototype[Ue] = c.prototype.inspect)
  c.prototype.compare = function (e, r, n, i, o) {
    if ((D(e, Uint8Array) && (e = c.from(e, e.offset, e.byteLength)), !c.isBuffer(e)))
      throw new TypeError('The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof e)
    if (
      (r === void 0 && (r = 0),
      n === void 0 && (n = e ? e.length : 0),
      i === void 0 && (i = 0),
      o === void 0 && (o = this.length),
      r < 0 || n > e.length || i < 0 || o > this.length)
    )
      throw new RangeError("out of range index")
    if (i >= o && r >= n) return 0
    if (i >= o) return -1
    if (r >= n) return 1
    if (((r >>>= 0), (n >>>= 0), (i >>>= 0), (o >>>= 0), this === e)) return 0
    let s = o - i,
      u = n - r,
      x = Math.min(s, u),
      d = this.slice(i, o),
      p = e.slice(r, n)
    for (let l = 0; l < x; ++l)
      if (d[l] !== p[l]) {
        ;((s = d[l]), (u = p[l]))
        break
      }
    return s < u ? -1 : u < s ? 1 : 0
  }
  function Oe(t, e, r, n, i) {
    if (t.length === 0) return -1
    if (
      (typeof r == "string"
        ? ((n = r), (r = 0))
        : r > 2147483647
          ? (r = 2147483647)
          : r < -2147483648 && (r = -2147483648),
      (r = +r),
      le(r) && (r = i ? 0 : t.length - 1),
      r < 0 && (r = t.length + r),
      r >= t.length)
    ) {
      if (i) return -1
      r = t.length - 1
    } else if (r < 0)
      if (i) r = 0
      else return -1
    if ((typeof e == "string" && (e = c.from(e, n)), c.isBuffer(e))) return e.length === 0 ? -1 : Re(t, e, r, n, i)
    if (typeof e == "number")
      return (
        (e = e & 255),
        typeof Uint8Array.prototype.indexOf == "function"
          ? i
            ? Uint8Array.prototype.indexOf.call(t, e, r)
            : Uint8Array.prototype.lastIndexOf.call(t, e, r)
          : Re(t, [e], r, n, i)
      )
    throw new TypeError("val must be string, number or Buffer")
  }
  function Re(t, e, r, n, i) {
    let o = 1,
      s = t.length,
      u = e.length
    if (
      n !== void 0 &&
      ((n = String(n).toLowerCase()), n === "ucs2" || n === "ucs-2" || n === "utf16le" || n === "utf-16le")
    ) {
      if (t.length < 2 || e.length < 2) return -1
      ;((o = 2), (s /= 2), (u /= 2), (r /= 2))
    }
    function x(p, l) {
      return o === 1 ? p[l] : p.readUInt16BE(l * o)
    }
    let d
    if (i) {
      let p = -1
      for (d = r; d < s; d++)
        if (x(t, d) === x(e, p === -1 ? 0 : d - p)) {
          if ((p === -1 && (p = d), d - p + 1 === u)) return p * o
        } else (p !== -1 && (d -= d - p), (p = -1))
    } else
      for (r + u > s && (r = s - u), d = r; d >= 0; d--) {
        let p = !0
        for (let l = 0; l < u; l++)
          if (x(t, d + l) !== x(e, l)) {
            p = !1
            break
          }
        if (p) return d
      }
    return -1
  }
  c.prototype.includes = function (e, r, n) {
    return this.indexOf(e, r, n) !== -1
  }
  c.prototype.indexOf = function (e, r, n) {
    return Oe(this, e, r, n, !0)
  }
  c.prototype.lastIndexOf = function (e, r, n) {
    return Oe(this, e, r, n, !1)
  }
  function mr(t, e, r, n) {
    r = Number(r) || 0
    let i = t.length - r
    n ? ((n = Number(n)), n > i && (n = i)) : (n = i)
    let o = e.length
    n > o / 2 && (n = o / 2)
    let s
    for (s = 0; s < n; ++s) {
      let u = parseInt(e.substr(s * 2, 2), 16)
      if (le(u)) return s
      t[r + s] = u
    }
    return s
  }
  function br(t, e, r, n) {
    return Y(ae(e, t.length - r), t, r, n)
  }
  function Ir(t, e, r, n) {
    return Y(Or(e), t, r, n)
  }
  function Er(t, e, r, n) {
    return Y(Je(e), t, r, n)
  }
  function Ar(t, e, r, n) {
    return Y(Dr(e, t.length - r), t, r, n)
  }
  c.prototype.write = function (e, r, n, i) {
    if (r === void 0) ((i = "utf8"), (n = this.length), (r = 0))
    else if (n === void 0 && typeof r == "string") ((i = r), (n = this.length), (r = 0))
    else if (isFinite(r))
      ((r = r >>> 0), isFinite(n) ? ((n = n >>> 0), i === void 0 && (i = "utf8")) : ((i = n), (n = void 0)))
    else throw new Error("Buffer.write(string, encoding, offset[, length]) is no longer supported")
    let o = this.length - r
    if (((n === void 0 || n > o) && (n = o), (e.length > 0 && (n < 0 || r < 0)) || r > this.length))
      throw new RangeError("Attempt to write outside buffer bounds")
    i || (i = "utf8")
    let s = !1
    for (;;)
      switch (i) {
        case "hex":
          return mr(this, e, r, n)
        case "utf8":
        case "utf-8":
          return br(this, e, r, n)
        case "ascii":
        case "latin1":
        case "binary":
          return Ir(this, e, r, n)
        case "base64":
          return Er(this, e, r, n)
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return Ar(this, e, r, n)
        default:
          if (s) throw new TypeError("Unknown encoding: " + i)
          ;((i = ("" + i).toLowerCase()), (s = !0))
      }
  }
  c.prototype.toJSON = function () {
    return { type: "Buffer", data: Array.prototype.slice.call(this._arr || this, 0) }
  }
  function Br(t, e, r) {
    return e === 0 && r === t.length ? se.fromByteArray(t) : se.fromByteArray(t.slice(e, r))
  }
  function De(t, e, r) {
    r = Math.min(t.length, r)
    let n = [],
      i = e
    for (; i < r; ) {
      let o = t[i],
        s = null,
        u = o > 239 ? 4 : o > 223 ? 3 : o > 191 ? 2 : 1
      if (i + u <= r) {
        let x, d, p, l
        switch (u) {
          case 1:
            o < 128 && (s = o)
            break
          case 2:
            ;((x = t[i + 1]), (x & 192) === 128 && ((l = ((o & 31) << 6) | (x & 63)), l > 127 && (s = l)))
            break
          case 3:
            ;((x = t[i + 1]),
              (d = t[i + 2]),
              (x & 192) === 128 &&
                (d & 192) === 128 &&
                ((l = ((o & 15) << 12) | ((x & 63) << 6) | (d & 63)), l > 2047 && (l < 55296 || l > 57343) && (s = l)))
            break
          case 4:
            ;((x = t[i + 1]),
              (d = t[i + 2]),
              (p = t[i + 3]),
              (x & 192) === 128 &&
                (d & 192) === 128 &&
                (p & 192) === 128 &&
                ((l = ((o & 15) << 18) | ((x & 63) << 12) | ((d & 63) << 6) | (p & 63)),
                l > 65535 && l < 1114112 && (s = l)))
        }
      }
      ;(s === null
        ? ((s = 65533), (u = 1))
        : s > 65535 && ((s -= 65536), n.push(((s >>> 10) & 1023) | 55296), (s = 56320 | (s & 1023))),
        n.push(s),
        (i += u))
    }
    return Fr(n)
  }
  var Se = 4096
  function Fr(t) {
    let e = t.length
    if (e <= Se) return String.fromCharCode.apply(String, t)
    let r = "",
      n = 0
    for (; n < e; ) r += String.fromCharCode.apply(String, t.slice(n, (n += Se)))
    return r
  }
  function Ur(t, e, r) {
    let n = ""
    r = Math.min(t.length, r)
    for (let i = e; i < r; ++i) n += String.fromCharCode(t[i] & 127)
    return n
  }
  function Rr(t, e, r) {
    let n = ""
    r = Math.min(t.length, r)
    for (let i = e; i < r; ++i) n += String.fromCharCode(t[i])
    return n
  }
  function Sr(t, e, r) {
    let n = t.length
    ;((!e || e < 0) && (e = 0), (!r || r < 0 || r > n) && (r = n))
    let i = ""
    for (let o = e; o < r; ++o) i += _r[t[o]]
    return i
  }
  function Lr(t, e, r) {
    let n = t.slice(e, r),
      i = ""
    for (let o = 0; o < n.length - 1; o += 2) i += String.fromCharCode(n[o] + n[o + 1] * 256)
    return i
  }
  c.prototype.slice = function (e, r) {
    let n = this.length
    ;((e = ~~e),
      (r = r === void 0 ? n : ~~r),
      e < 0 ? ((e += n), e < 0 && (e = 0)) : e > n && (e = n),
      r < 0 ? ((r += n), r < 0 && (r = 0)) : r > n && (r = n),
      r < e && (r = e))
    let i = this.subarray(e, r)
    return (Object.setPrototypeOf(i, c.prototype), i)
  }
  function U(t, e, r) {
    if (t % 1 !== 0 || t < 0) throw new RangeError("offset is not uint")
    if (t + e > r) throw new RangeError("Trying to access beyond buffer length")
  }
  c.prototype.readUintLE = c.prototype.readUIntLE = function (e, r, n) {
    ;((e = e >>> 0), (r = r >>> 0), n || U(e, r, this.length))
    let i = this[e],
      o = 1,
      s = 0
    for (; ++s < r && (o *= 256); ) i += this[e + s] * o
    return i
  }
  c.prototype.readUintBE = c.prototype.readUIntBE = function (e, r, n) {
    ;((e = e >>> 0), (r = r >>> 0), n || U(e, r, this.length))
    let i = this[e + --r],
      o = 1
    for (; r > 0 && (o *= 256); ) i += this[e + --r] * o
    return i
  }
  c.prototype.readUint8 = c.prototype.readUInt8 = function (e, r) {
    return ((e = e >>> 0), r || U(e, 1, this.length), this[e])
  }
  c.prototype.readUint16LE = c.prototype.readUInt16LE = function (e, r) {
    return ((e = e >>> 0), r || U(e, 2, this.length), this[e] | (this[e + 1] << 8))
  }
  c.prototype.readUint16BE = c.prototype.readUInt16BE = function (e, r) {
    return ((e = e >>> 0), r || U(e, 2, this.length), (this[e] << 8) | this[e + 1])
  }
  c.prototype.readUint32LE = c.prototype.readUInt32LE = function (e, r) {
    return (
      (e = e >>> 0),
      r || U(e, 4, this.length),
      (this[e] | (this[e + 1] << 8) | (this[e + 2] << 16)) + this[e + 3] * 16777216
    )
  }
  c.prototype.readUint32BE = c.prototype.readUInt32BE = function (e, r) {
    return (
      (e = e >>> 0),
      r || U(e, 4, this.length),
      this[e] * 16777216 + ((this[e + 1] << 16) | (this[e + 2] << 8) | this[e + 3])
    )
  }
  c.prototype.readBigUInt64LE = H(function (e) {
    ;((e = e >>> 0), V(e, "offset"))
    let r = this[e],
      n = this[e + 7]
    ;(r === void 0 || n === void 0) && W(e, this.length - 8)
    let i = r + this[++e] * 2 ** 8 + this[++e] * 2 ** 16 + this[++e] * 2 ** 24,
      o = this[++e] + this[++e] * 2 ** 8 + this[++e] * 2 ** 16 + n * 2 ** 24
    return BigInt(i) + (BigInt(o) << BigInt(32))
  })
  c.prototype.readBigUInt64BE = H(function (e) {
    ;((e = e >>> 0), V(e, "offset"))
    let r = this[e],
      n = this[e + 7]
    ;(r === void 0 || n === void 0) && W(e, this.length - 8)
    let i = r * 2 ** 24 + this[++e] * 2 ** 16 + this[++e] * 2 ** 8 + this[++e],
      o = this[++e] * 2 ** 24 + this[++e] * 2 ** 16 + this[++e] * 2 ** 8 + n
    return (BigInt(i) << BigInt(32)) + BigInt(o)
  })
  c.prototype.readIntLE = function (e, r, n) {
    ;((e = e >>> 0), (r = r >>> 0), n || U(e, r, this.length))
    let i = this[e],
      o = 1,
      s = 0
    for (; ++s < r && (o *= 256); ) i += this[e + s] * o
    return ((o *= 128), i >= o && (i -= Math.pow(2, 8 * r)), i)
  }
  c.prototype.readIntBE = function (e, r, n) {
    ;((e = e >>> 0), (r = r >>> 0), n || U(e, r, this.length))
    let i = r,
      o = 1,
      s = this[e + --i]
    for (; i > 0 && (o *= 256); ) s += this[e + --i] * o
    return ((o *= 128), s >= o && (s -= Math.pow(2, 8 * r)), s)
  }
  c.prototype.readInt8 = function (e, r) {
    return ((e = e >>> 0), r || U(e, 1, this.length), this[e] & 128 ? (255 - this[e] + 1) * -1 : this[e])
  }
  c.prototype.readInt16LE = function (e, r) {
    ;((e = e >>> 0), r || U(e, 2, this.length))
    let n = this[e] | (this[e + 1] << 8)
    return n & 32768 ? n | 4294901760 : n
  }
  c.prototype.readInt16BE = function (e, r) {
    ;((e = e >>> 0), r || U(e, 2, this.length))
    let n = this[e + 1] | (this[e] << 8)
    return n & 32768 ? n | 4294901760 : n
  }
  c.prototype.readInt32LE = function (e, r) {
    return (
      (e = e >>> 0),
      r || U(e, 4, this.length),
      this[e] | (this[e + 1] << 8) | (this[e + 2] << 16) | (this[e + 3] << 24)
    )
  }
  c.prototype.readInt32BE = function (e, r) {
    return (
      (e = e >>> 0),
      r || U(e, 4, this.length),
      (this[e] << 24) | (this[e + 1] << 16) | (this[e + 2] << 8) | this[e + 3]
    )
  }
  c.prototype.readBigInt64LE = H(function (e) {
    ;((e = e >>> 0), V(e, "offset"))
    let r = this[e],
      n = this[e + 7]
    ;(r === void 0 || n === void 0) && W(e, this.length - 8)
    let i = this[e + 4] + this[e + 5] * 2 ** 8 + this[e + 6] * 2 ** 16 + (n << 24)
    return (BigInt(i) << BigInt(32)) + BigInt(r + this[++e] * 2 ** 8 + this[++e] * 2 ** 16 + this[++e] * 2 ** 24)
  })
  c.prototype.readBigInt64BE = H(function (e) {
    ;((e = e >>> 0), V(e, "offset"))
    let r = this[e],
      n = this[e + 7]
    ;(r === void 0 || n === void 0) && W(e, this.length - 8)
    let i = (r << 24) + this[++e] * 2 ** 16 + this[++e] * 2 ** 8 + this[++e]
    return (BigInt(i) << BigInt(32)) + BigInt(this[++e] * 2 ** 24 + this[++e] * 2 ** 16 + this[++e] * 2 ** 8 + n)
  })
  c.prototype.readFloatLE = function (e, r) {
    return ((e = e >>> 0), r || U(e, 4, this.length), $.read(this, e, !0, 23, 4))
  }
  c.prototype.readFloatBE = function (e, r) {
    return ((e = e >>> 0), r || U(e, 4, this.length), $.read(this, e, !1, 23, 4))
  }
  c.prototype.readDoubleLE = function (e, r) {
    return ((e = e >>> 0), r || U(e, 8, this.length), $.read(this, e, !0, 52, 8))
  }
  c.prototype.readDoubleBE = function (e, r) {
    return ((e = e >>> 0), r || U(e, 8, this.length), $.read(this, e, !1, 52, 8))
  }
  function S(t, e, r, n, i, o) {
    if (!c.isBuffer(t)) throw new TypeError('"buffer" argument must be a Buffer instance')
    if (e > i || e < o) throw new RangeError('"value" argument is out of bounds')
    if (r + n > t.length) throw new RangeError("Index out of range")
  }
  c.prototype.writeUintLE = c.prototype.writeUIntLE = function (e, r, n, i) {
    if (((e = +e), (r = r >>> 0), (n = n >>> 0), !i)) {
      let u = Math.pow(2, 8 * n) - 1
      S(this, e, r, n, u, 0)
    }
    let o = 1,
      s = 0
    for (this[r] = e & 255; ++s < n && (o *= 256); ) this[r + s] = (e / o) & 255
    return r + n
  }
  c.prototype.writeUintBE = c.prototype.writeUIntBE = function (e, r, n, i) {
    if (((e = +e), (r = r >>> 0), (n = n >>> 0), !i)) {
      let u = Math.pow(2, 8 * n) - 1
      S(this, e, r, n, u, 0)
    }
    let o = n - 1,
      s = 1
    for (this[r + o] = e & 255; --o >= 0 && (s *= 256); ) this[r + o] = (e / s) & 255
    return r + n
  }
  c.prototype.writeUint8 = c.prototype.writeUInt8 = function (e, r, n) {
    return ((e = +e), (r = r >>> 0), n || S(this, e, r, 1, 255, 0), (this[r] = e & 255), r + 1)
  }
  c.prototype.writeUint16LE = c.prototype.writeUInt16LE = function (e, r, n) {
    return (
      (e = +e),
      (r = r >>> 0),
      n || S(this, e, r, 2, 65535, 0),
      (this[r] = e & 255),
      (this[r + 1] = e >>> 8),
      r + 2
    )
  }
  c.prototype.writeUint16BE = c.prototype.writeUInt16BE = function (e, r, n) {
    return (
      (e = +e),
      (r = r >>> 0),
      n || S(this, e, r, 2, 65535, 0),
      (this[r] = e >>> 8),
      (this[r + 1] = e & 255),
      r + 2
    )
  }
  c.prototype.writeUint32LE = c.prototype.writeUInt32LE = function (e, r, n) {
    return (
      (e = +e),
      (r = r >>> 0),
      n || S(this, e, r, 4, 4294967295, 0),
      (this[r + 3] = e >>> 24),
      (this[r + 2] = e >>> 16),
      (this[r + 1] = e >>> 8),
      (this[r] = e & 255),
      r + 4
    )
  }
  c.prototype.writeUint32BE = c.prototype.writeUInt32BE = function (e, r, n) {
    return (
      (e = +e),
      (r = r >>> 0),
      n || S(this, e, r, 4, 4294967295, 0),
      (this[r] = e >>> 24),
      (this[r + 1] = e >>> 16),
      (this[r + 2] = e >>> 8),
      (this[r + 3] = e & 255),
      r + 4
    )
  }
  function _e(t, e, r, n, i) {
    Pe(e, n, i, t, r, 7)
    let o = Number(e & BigInt(4294967295))
    ;((t[r++] = o), (o = o >> 8), (t[r++] = o), (o = o >> 8), (t[r++] = o), (o = o >> 8), (t[r++] = o))
    let s = Number((e >> BigInt(32)) & BigInt(4294967295))
    return ((t[r++] = s), (s = s >> 8), (t[r++] = s), (s = s >> 8), (t[r++] = s), (s = s >> 8), (t[r++] = s), r)
  }
  function ve(t, e, r, n, i) {
    Pe(e, n, i, t, r, 7)
    let o = Number(e & BigInt(4294967295))
    ;((t[r + 7] = o), (o = o >> 8), (t[r + 6] = o), (o = o >> 8), (t[r + 5] = o), (o = o >> 8), (t[r + 4] = o))
    let s = Number((e >> BigInt(32)) & BigInt(4294967295))
    return ((t[r + 3] = s), (s = s >> 8), (t[r + 2] = s), (s = s >> 8), (t[r + 1] = s), (s = s >> 8), (t[r] = s), r + 8)
  }
  c.prototype.writeBigUInt64LE = H(function (e, r = 0) {
    return _e(this, e, r, BigInt(0), BigInt("0xffffffffffffffff"))
  })
  c.prototype.writeBigUInt64BE = H(function (e, r = 0) {
    return ve(this, e, r, BigInt(0), BigInt("0xffffffffffffffff"))
  })
  c.prototype.writeIntLE = function (e, r, n, i) {
    if (((e = +e), (r = r >>> 0), !i)) {
      let x = Math.pow(2, 8 * n - 1)
      S(this, e, r, n, x - 1, -x)
    }
    let o = 0,
      s = 1,
      u = 0
    for (this[r] = e & 255; ++o < n && (s *= 256); )
      (e < 0 && u === 0 && this[r + o - 1] !== 0 && (u = 1), (this[r + o] = (((e / s) >> 0) - u) & 255))
    return r + n
  }
  c.prototype.writeIntBE = function (e, r, n, i) {
    if (((e = +e), (r = r >>> 0), !i)) {
      let x = Math.pow(2, 8 * n - 1)
      S(this, e, r, n, x - 1, -x)
    }
    let o = n - 1,
      s = 1,
      u = 0
    for (this[r + o] = e & 255; --o >= 0 && (s *= 256); )
      (e < 0 && u === 0 && this[r + o + 1] !== 0 && (u = 1), (this[r + o] = (((e / s) >> 0) - u) & 255))
    return r + n
  }
  c.prototype.writeInt8 = function (e, r, n) {
    return (
      (e = +e),
      (r = r >>> 0),
      n || S(this, e, r, 1, 127, -128),
      e < 0 && (e = 255 + e + 1),
      (this[r] = e & 255),
      r + 1
    )
  }
  c.prototype.writeInt16LE = function (e, r, n) {
    return (
      (e = +e),
      (r = r >>> 0),
      n || S(this, e, r, 2, 32767, -32768),
      (this[r] = e & 255),
      (this[r + 1] = e >>> 8),
      r + 2
    )
  }
  c.prototype.writeInt16BE = function (e, r, n) {
    return (
      (e = +e),
      (r = r >>> 0),
      n || S(this, e, r, 2, 32767, -32768),
      (this[r] = e >>> 8),
      (this[r + 1] = e & 255),
      r + 2
    )
  }
  c.prototype.writeInt32LE = function (e, r, n) {
    return (
      (e = +e),
      (r = r >>> 0),
      n || S(this, e, r, 4, 2147483647, -2147483648),
      (this[r] = e & 255),
      (this[r + 1] = e >>> 8),
      (this[r + 2] = e >>> 16),
      (this[r + 3] = e >>> 24),
      r + 4
    )
  }
  c.prototype.writeInt32BE = function (e, r, n) {
    return (
      (e = +e),
      (r = r >>> 0),
      n || S(this, e, r, 4, 2147483647, -2147483648),
      e < 0 && (e = 4294967295 + e + 1),
      (this[r] = e >>> 24),
      (this[r + 1] = e >>> 16),
      (this[r + 2] = e >>> 8),
      (this[r + 3] = e & 255),
      r + 4
    )
  }
  c.prototype.writeBigInt64LE = H(function (e, r = 0) {
    return _e(this, e, r, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"))
  })
  c.prototype.writeBigInt64BE = H(function (e, r = 0) {
    return ve(this, e, r, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"))
  })
  function He(t, e, r, n, i, o) {
    if (r + n > t.length) throw new RangeError("Index out of range")
    if (r < 0) throw new RangeError("Index out of range")
  }
  function Me(t, e, r, n, i) {
    return (
      (e = +e),
      (r = r >>> 0),
      i || He(t, e, r, 4, 34028234663852886e22, -34028234663852886e22),
      $.write(t, e, r, n, 23, 4),
      r + 4
    )
  }
  c.prototype.writeFloatLE = function (e, r, n) {
    return Me(this, e, r, !0, n)
  }
  c.prototype.writeFloatBE = function (e, r, n) {
    return Me(this, e, r, !1, n)
  }
  function Ne(t, e, r, n, i) {
    return (
      (e = +e),
      (r = r >>> 0),
      i || He(t, e, r, 8, 17976931348623157e292, -17976931348623157e292),
      $.write(t, e, r, n, 52, 8),
      r + 8
    )
  }
  c.prototype.writeDoubleLE = function (e, r, n) {
    return Ne(this, e, r, !0, n)
  }
  c.prototype.writeDoubleBE = function (e, r, n) {
    return Ne(this, e, r, !1, n)
  }
  c.prototype.copy = function (e, r, n, i) {
    if (!c.isBuffer(e)) throw new TypeError("argument should be a Buffer")
    if (
      (n || (n = 0),
      !i && i !== 0 && (i = this.length),
      r >= e.length && (r = e.length),
      r || (r = 0),
      i > 0 && i < n && (i = n),
      i === n || e.length === 0 || this.length === 0)
    )
      return 0
    if (r < 0) throw new RangeError("targetStart out of bounds")
    if (n < 0 || n >= this.length) throw new RangeError("Index out of range")
    if (i < 0) throw new RangeError("sourceEnd out of bounds")
    ;(i > this.length && (i = this.length), e.length - r < i - n && (i = e.length - r + n))
    let o = i - n
    return (
      this === e && typeof Uint8Array.prototype.copyWithin == "function"
        ? this.copyWithin(r, n, i)
        : Uint8Array.prototype.set.call(e, this.subarray(n, i), r),
      o
    )
  }
  c.prototype.fill = function (e, r, n, i) {
    if (typeof e == "string") {
      if (
        (typeof r == "string"
          ? ((i = r), (r = 0), (n = this.length))
          : typeof n == "string" && ((i = n), (n = this.length)),
        i !== void 0 && typeof i != "string")
      )
        throw new TypeError("encoding must be a string")
      if (typeof i == "string" && !c.isEncoding(i)) throw new TypeError("Unknown encoding: " + i)
      if (e.length === 1) {
        let s = e.charCodeAt(0)
        ;((i === "utf8" && s < 128) || i === "latin1") && (e = s)
      }
    } else typeof e == "number" ? (e = e & 255) : typeof e == "boolean" && (e = Number(e))
    if (r < 0 || this.length < r || this.length < n) throw new RangeError("Out of range index")
    if (n <= r) return this
    ;((r = r >>> 0), (n = n === void 0 ? this.length : n >>> 0), e || (e = 0))
    let o
    if (typeof e == "number") for (o = r; o < n; ++o) this[o] = e
    else {
      let s = c.isBuffer(e) ? e : c.from(e, i),
        u = s.length
      if (u === 0) throw new TypeError('The value "' + e + '" is invalid for argument "value"')
      for (o = 0; o < n - r; ++o) this[o + r] = s[o % u]
    }
    return this
  }
  var J = {}
  function he(t, e, r) {
    J[t] = class extends r {
      constructor() {
        ;(super(),
          Object.defineProperty(this, "message", { value: e.apply(this, arguments), writable: !0, configurable: !0 }),
          (this.name = `${this.name} [${t}]`),
          this.stack,
          delete this.name)
      }
      get code() {
        return t
      }
      set code(i) {
        Object.defineProperty(this, "code", { configurable: !0, enumerable: !0, value: i, writable: !0 })
      }
      toString() {
        return `${this.name} [${t}]: ${this.message}`
      }
    }
  }
  he(
    "ERR_BUFFER_OUT_OF_BOUNDS",
    function (t) {
      return t ? `${t} is outside of buffer bounds` : "Attempt to access memory outside buffer bounds"
    },
    RangeError,
  )
  he(
    "ERR_INVALID_ARG_TYPE",
    function (t, e) {
      return `The "${t}" argument must be of type number. Received type ${typeof e}`
    },
    TypeError,
  )
  he(
    "ERR_OUT_OF_RANGE",
    function (t, e, r) {
      let n = `The value of "${t}" is out of range.`,
        i = r
      return (
        Number.isInteger(r) && Math.abs(r) > 2 ** 32
          ? (i = Le(String(r)))
          : typeof r == "bigint" &&
            ((i = String(r)),
            (r > BigInt(2) ** BigInt(32) || r < -(BigInt(2) ** BigInt(32))) && (i = Le(i)),
            (i += "n")),
        (n += ` It must be ${e}. Received ${i}`),
        n
      )
    },
    RangeError,
  )
  function Le(t) {
    let e = "",
      r = t.length,
      n = t[0] === "-" ? 1 : 0
    for (; r >= n + 4; r -= 3) e = `_${t.slice(r - 3, r)}${e}`
    return `${t.slice(0, r)}${e}`
  }
  function kr(t, e, r) {
    ;(V(e, "offset"), (t[e] === void 0 || t[e + r] === void 0) && W(e, t.length - (r + 1)))
  }
  function Pe(t, e, r, n, i, o) {
    if (t > r || t < e) {
      let s = typeof e == "bigint" ? "n" : "",
        u
      throw (
        o > 3
          ? e === 0 || e === BigInt(0)
            ? (u = `>= 0${s} and < 2${s} ** ${(o + 1) * 8}${s}`)
            : (u = `>= -(2${s} ** ${(o + 1) * 8 - 1}${s}) and < 2 ** ${(o + 1) * 8 - 1}${s}`)
          : (u = `>= ${e}${s} and <= ${r}${s}`),
        new J.ERR_OUT_OF_RANGE("value", u, t)
      )
    }
    kr(n, i, o)
  }
  function V(t, e) {
    if (typeof t != "number") throw new J.ERR_INVALID_ARG_TYPE(e, "number", t)
  }
  function W(t, e, r) {
    throw Math.floor(t) !== t
      ? (V(t, r), new J.ERR_OUT_OF_RANGE(r || "offset", "an integer", t))
      : e < 0
        ? new J.ERR_BUFFER_OUT_OF_BOUNDS()
        : new J.ERR_OUT_OF_RANGE(r || "offset", `>= ${r ? 1 : 0} and <= ${e}`, t)
  }
  var Cr = /[^+/0-9A-Za-z-_]/g
  function Tr(t) {
    if (((t = t.split("=")[0]), (t = t.trim().replace(Cr, "")), t.length < 2)) return ""
    for (; t.length % 4 !== 0; ) t = t + "="
    return t
  }
  function ae(t, e) {
    e = e || 1 / 0
    let r,
      n = t.length,
      i = null,
      o = []
    for (let s = 0; s < n; ++s) {
      if (((r = t.charCodeAt(s)), r > 55295 && r < 57344)) {
        if (!i) {
          if (r > 56319) {
            ;(e -= 3) > -1 && o.push(239, 191, 189)
            continue
          } else if (s + 1 === n) {
            ;(e -= 3) > -1 && o.push(239, 191, 189)
            continue
          }
          i = r
          continue
        }
        if (r < 56320) {
          ;((e -= 3) > -1 && o.push(239, 191, 189), (i = r))
          continue
        }
        r = (((i - 55296) << 10) | (r - 56320)) + 65536
      } else i && (e -= 3) > -1 && o.push(239, 191, 189)
      if (((i = null), r < 128)) {
        if ((e -= 1) < 0) break
        o.push(r)
      } else if (r < 2048) {
        if ((e -= 2) < 0) break
        o.push((r >> 6) | 192, (r & 63) | 128)
      } else if (r < 65536) {
        if ((e -= 3) < 0) break
        o.push((r >> 12) | 224, ((r >> 6) & 63) | 128, (r & 63) | 128)
      } else if (r < 1114112) {
        if ((e -= 4) < 0) break
        o.push((r >> 18) | 240, ((r >> 12) & 63) | 128, ((r >> 6) & 63) | 128, (r & 63) | 128)
      } else throw new Error("Invalid code point")
    }
    return o
  }
  function Or(t) {
    let e = []
    for (let r = 0; r < t.length; ++r) e.push(t.charCodeAt(r) & 255)
    return e
  }
  function Dr(t, e) {
    let r,
      n,
      i,
      o = []
    for (let s = 0; s < t.length && !((e -= 2) < 0); ++s)
      ((r = t.charCodeAt(s)), (n = r >> 8), (i = r % 256), o.push(i), o.push(n))
    return o
  }
  function Je(t) {
    return se.toByteArray(Tr(t))
  }
  function Y(t, e, r, n) {
    let i
    for (i = 0; i < n && !(i + r >= e.length || i >= t.length); ++i) e[i + r] = t[i]
    return i
  }
  function D(t, e) {
    return (
      t instanceof e ||
      (t != null && t.constructor != null && t.constructor.name != null && t.constructor.name === e.name)
    )
  }
  function le(t) {
    return t !== t
  }
  var _r = (function () {
    let t = "0123456789abcdef",
      e = new Array(256)
    for (let r = 0; r < 16; ++r) {
      let n = r * 16
      for (let i = 0; i < 16; ++i) e[n + i] = t[r] + t[i]
    }
    return e
  })()
  function H(t) {
    return typeof BigInt > "u" ? vr : t
  }
  function vr() {
    throw new Error("BigInt not supported")
  }
})
var O,
  B = tr(() => {
    "use strict"
    O = ir($e(), 1)
  })
B()
B()
var q = "pa99d3189286f4fa191b597bd1a1f227d.genoffice-xlsx"
function Ve(t) {
  let e = t.split(".").pop()?.toLowerCase()
  if (e === "docx" || e === "xlsx" || e === "pptx" || e === "pdf") return e
  if (e === "csv") return "xlsx"
  throw new Error("\u8BF7\u9009\u62E9 DOCX\u3001XLSX\u3001CSV\u3001PPTX \u6216 PDF \u6587\u4EF6\u3002")
}
function j(t, e) {
  if (typeof t != "string") throw new Error("\u8BF7\u8F93\u5165\u6587\u4EF6\u540D\u79F0\u3002")
  let r = t.trim().replace(new RegExp(`\\.${e}$`, "i"), "")
  if (!r || r.length > 100 || /[\\/:*?"<>|\x00-\x1f]/.test(r) || /[. ]$/.test(r))
    throw new Error(
      "\u540D\u79F0\u5E94\u4E3A 1\u2013100 \u4E2A\u5B57\u7B26\uFF0C\u4E0D\u80FD\u5305\u542B\u8DEF\u5F84\u6216\u7279\u6B8A\u5B57\u7B26\u3002",
    )
  return `${r}.${e}`
}
function Hr(t) {
  if (t === null || (typeof t == "object" && !Array.isArray(t) && Object.keys(t).length === 0))
    return { schema: 1, documents: [] }
  if (typeof t != "object" || Array.isArray(t) || t.schema !== 1 || !Array.isArray(t.documents))
    throw new Error(
      "Office \u6587\u6863\u5E93\u683C\u5F0F\u65E0\u6CD5\u8BC6\u522B\u3002\u539F\u6570\u636E\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u6062\u590D\u517C\u5BB9\u7248\u672C\u3002",
    )
  let e = t,
    r = new Set()
  for (let n of e.documents) {
    if (
      !n ||
      typeof n.id != "string" ||
      r.has(n.id) ||
      typeof n.name != "string" ||
      !["docx", "xlsx", "pptx", "pdf"].includes(n.kind) ||
      !Number.isSafeInteger(n.revision) ||
      !Array.isArray(n.versions) ||
      !n.versions.length ||
      n.versions.some((i) => !i || typeof i.id != "string" || !i.file || typeof i.file.id != "string")
    )
      throw new Error("Office \u6587\u6863\u5E93\u5DF2\u635F\u574F\u3002\u539F\u6570\u636E\u5DF2\u4FDD\u7559\u3002")
    r.add(n.id)
  }
  return structuredClone(e)
}
var Z = class {
  constructor(e) {
    this.ports = e
  }
  queue = Promise.resolve()
  execute(e, r = {}) {
    let n = this.queue.then(() => this.apply(e, r))
    return ((this.queue = n.catch(() => {})), n)
  }
  async apply(e, r) {
    let n = Hr(await this.ports.get())
    if (e === "list") return n
    if (e.startsWith("preferences.")) {
      if (r.key !== "pdfSignatures") throw new Error("\u4E0D\u652F\u6301\u7684\u8BBE\u7F6E\u9879\u3002")
      if (e === "preferences.get") return n.preferences?.pdfSignatures ?? null
      if (e !== "preferences.set" || !("value" in r)) throw new Error("\u8BBE\u7F6E\u53C2\u6570\u65E0\u6548\u3002")
      if (new TextEncoder().encode(JSON.stringify(r.value)).length > 64 * 1024)
        throw new Error(
          "\u7B7E\u540D\u6536\u85CF\u8D85\u8FC7 64 KB\uFF0C\u8BF7\u5220\u9664\u4E0D\u518D\u9700\u8981\u7684\u7B7E\u540D\u3002",
        )
      if (
        ((n.preferences = { ...n.preferences, pdfSignatures: r.value }),
        new TextEncoder().encode(JSON.stringify(n)).length > 240 * 1024)
      )
        throw new Error("\u6587\u6863\u5E93\u7D22\u5F15\u5DF2\u6EE1\u3002")
      return (await this.ports.set(n), r.value)
    }
    let i = Date.now(),
      o = [],
      s = null
    if (e === "add") {
      if (r.sourceId !== void 0 && (typeof r.sourceId != "string" || !/^[a-f0-9]{64}$/.test(r.sourceId)))
        throw new Error("\u6587\u4EF6\u6765\u6E90\u6807\u8BC6\u65E0\u6548\u3002")
      if (r.sourceHash !== void 0 && (typeof r.sourceHash != "string" || !/^[a-f0-9]{64}$/.test(r.sourceHash)))
        throw new Error("\u6587\u4EF6\u6765\u6E90\u6821\u9A8C\u65E0\u6548\u3002")
      let d = r.sourceId && n.documents.find((I) => I.sourceId === r.sourceId)
      if (d) {
        if (d.trashedAt !== null)
          throw new Error(
            "\u6B64\u6587\u4EF6\u7684\u6587\u6863\u5E93\u526F\u672C\u5728\u56DE\u6536\u7AD9\u4E2D\uFF0C\u8BF7\u5148\u6062\u590D\u3002",
          )
        if (
          typeof r.resourceId == "string" &&
          !n.documents.some((I) => I.versions.some((b) => b.file.id === r.resourceId))
        ) {
          let I = (await this.ports.files()).find((b) => b.id === r.resourceId)
          I && (await this.ports.release(I).catch(() => {}))
        }
        return d
      }
      if (n.documents.length >= 240)
        throw new Error(
          "\u6587\u6863\u5E93\u5DF2\u8FBE\u5230 240 \u4E2A\u6587\u4EF6\uFF0C\u8BF7\u5148\u5BFC\u51FA\u5E76\u6574\u7406\u56DE\u6536\u7AD9\u3002",
        )
      let p = (await this.ports.files()).find((I) => I.id === r.resourceId)
      if (!p) throw new Error("\u6587\u4EF6\u6388\u6743\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u5165\u3002")
      let l = Ve(p.name)
      ;((s = {
        id: crypto.randomUUID(),
        name: j(r.name ?? p.name, l),
        kind: l,
        revision: 1,
        createdAt: i,
        updatedAt: i,
        openedAt: i,
        favorite: !1,
        trashedAt: null,
        versions: [{ id: crypto.randomUUID(), file: p, createdAt: i, label: "\u521D\u59CB\u7248\u672C" }],
      }),
        typeof r.sourceId == "string" && (s.sourceId = r.sourceId),
        typeof r.sourceHash == "string" && (s.sourceHash = r.sourceHash),
        n.documents.unshift(s))
    } else {
      let d = n.documents.find((p) => p.id === r.id)
      if (!d) throw new Error("\u6587\u6863\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5237\u65B0\u6587\u6863\u5E93\u3002")
      if (
        ((s = d),
        (r.revision !== void 0 || e === "save" || e === "restoreVersion" || e === "delete") &&
          d.revision !== r.revision)
      )
        throw new Error(
          "\u6587\u6863\u5DF2\u5728\u5176\u4ED6\u9875\u9762\u4FEE\u6539\u3002\u8BF7\u91CD\u65B0\u6253\u5F00\u6700\u65B0\u7248\u672C\uFF0C\u6216\u5C06\u5F53\u524D\u5185\u5BB9\u53E6\u5B58\u4E3A\u3002",
        )
      if (d.trashedAt !== null && !["restore", "delete"].includes(e))
        throw new Error("\u6587\u6863\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C\u8BF7\u5148\u6062\u590D\u3002")
      switch (e) {
        case "opened":
          d.openedAt = i
          break
        case "rename":
          d.name = j(r.name, d.kind)
          break
        case "favorite":
          d.favorite = r.value === !0
          break
        case "trash":
          ;((d.trashedAt = i), d.revision++)
          break
        case "restore":
          ;((d.trashedAt = null), d.revision++)
          break
        case "save": {
          let p = (await this.ports.files()).find((l) => l.id === r.resourceId)
          if (!p)
            throw new Error(
              "\u4FDD\u5B58\u7684\u6587\u4EF6\u5DF2\u5931\u6548\uFF0C\u5F53\u524D\u7F16\u8F91\u5185\u5BB9\u4ECD\u4FDD\u7559\u3002",
            )
          if (Ve(p.name) !== d.kind)
            throw new Error(
              "\u4FDD\u5B58\u5185\u5BB9\u7684\u6587\u4EF6\u7C7B\u578B\u4E0E\u6587\u6863\u4E0D\u4E00\u81F4\u3002",
            )
          ;(d.versions.unshift({
            id: crypto.randomUUID(),
            file: p,
            createdAt: i,
            label: typeof r.label == "string" ? r.label.slice(0, 40) : "\u81EA\u52A8\u4FDD\u5B58",
          }),
            o.push(...d.versions.splice(12).map((l) => l.file)),
            d.revision++,
            (d.updatedAt = i))
          break
        }
        case "restoreVersion": {
          let p = d.versions.find((l) => l.id === r.versionId)
          if (!p) throw new Error("\u6B64\u7248\u672C\u5DF2\u4E0D\u5B58\u5728\u3002")
          ;(d.versions.unshift({
            ...p,
            id: crypto.randomUUID(),
            createdAt: i,
            label: "\u6062\u590D\u5386\u53F2\u7248\u672C",
          }),
            o.push(...d.versions.splice(12).map((l) => l.file)),
            d.revision++,
            (d.updatedAt = i))
          break
        }
        case "duplicate": {
          if (n.documents.length >= 240)
            throw new Error("\u6587\u6863\u5E93\u5DF2\u8FBE\u5230 240 \u4E2A\u6587\u4EF6\u3002")
          ;((s = {
            ...structuredClone(d),
            id: crypto.randomUUID(),
            name: j(r.name ?? `${d.name.replace(/\.[^.]+$/, "")} \u526F\u672C`, d.kind),
            revision: 1,
            createdAt: i,
            updatedAt: i,
            openedAt: i,
            favorite: !1,
            versions: [{ ...d.versions[0], id: crypto.randomUUID(), createdAt: i, label: "\u590D\u5236\u6587\u6863" }],
          }),
            delete s.sourceId,
            delete s.sourceHash,
            n.documents.unshift(s))
          break
        }
        case "delete": {
          if (d.trashedAt === null)
            throw new Error("\u8BF7\u5148\u5C06\u6587\u6863\u79FB\u5165\u56DE\u6536\u7AD9\u3002")
          ;((n.documents = n.documents.filter((p) => p.id !== d.id)),
            o.push(...d.versions.map((p) => p.file)),
            (s = null))
          break
        }
        default:
          throw new Error("\u4E0D\u652F\u6301\u7684\u6587\u6863\u64CD\u4F5C\u3002")
      }
    }
    let u = n
    if (new TextEncoder().encode(JSON.stringify(u)).length > 240 * 1024)
      throw new Error(
        "\u6587\u6863\u5E93\u7D22\u5F15\u5DF2\u6EE1\uFF0C\u8BF7\u5BFC\u51FA\u5E76\u6574\u7406\u4E0D\u518D\u9700\u8981\u7684\u6587\u4EF6\u3002",
      )
    await this.ports.set(u)
    let x = new Set(n.documents.flatMap((d) => d.versions.map((p) => p.file.id)))
    for (let d of o) x.has(d.id) || (await this.ports.release(d).catch(() => {}))
    return (await this.ports.publish().catch(() => {}), s)
  }
}
B()
B()
B()
B()
B()
function Mr(t) {
  return t instanceof Uint8Array || (ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array")
}
function pe(t, e, r = "") {
  let n = Mr(t),
    i = t?.length,
    o = e !== void 0
  if (!n || (o && i !== e)) {
    let s = r && `"${r}" `,
      u = o ? ` of length ${e}` : "",
      x = n ? `length=${i}` : `type=${typeof t}`
    throw new Error(s + "expected Uint8Array" + u + ", got " + x)
  }
  return t
}
function xe(t, e = !0) {
  if (t.destroyed) throw new Error("Hash instance has been destroyed")
  if (e && t.finished) throw new Error("Hash#digest() has already been called")
}
function Ge(t, e) {
  pe(t, void 0, "digestInto() output")
  let r = e.outputLen
  if (t.length < r) throw new Error('"digestInto() output" expected to be of length >=' + r)
}
function K(...t) {
  for (let e = 0; e < t.length; e++) t[e].fill(0)
}
function Q(t) {
  return new DataView(t.buffer, t.byteOffset, t.byteLength)
}
function C(t, e) {
  return (t << (32 - e)) | (t >>> e)
}
function je(t, e = {}) {
  let r = (i, o) => t(o).update(i).digest(),
    n = t(void 0)
  return (
    (r.outputLen = n.outputLen),
    (r.blockLen = n.blockLen),
    (r.create = (i) => t(i)),
    Object.assign(r, e),
    Object.freeze(r)
  )
}
var qe = (t) => ({ oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, t]) })
function We(t, e, r) {
  return (t & e) ^ (~t & r)
}
function Ke(t, e, r) {
  return (t & e) ^ (t & r) ^ (e & r)
}
var ee = class {
    blockLen
    outputLen
    padOffset
    isLE
    buffer
    view
    finished = !1
    length = 0
    pos = 0
    destroyed = !1
    constructor(e, r, n, i) {
      ;((this.blockLen = e),
        (this.outputLen = r),
        (this.padOffset = n),
        (this.isLE = i),
        (this.buffer = new Uint8Array(e)),
        (this.view = Q(this.buffer)))
    }
    update(e) {
      ;(xe(this), pe(e))
      let { view: r, buffer: n, blockLen: i } = this,
        o = e.length
      for (let s = 0; s < o; ) {
        let u = Math.min(i - this.pos, o - s)
        if (u === i) {
          let x = Q(e)
          for (; i <= o - s; s += i) this.process(x, s)
          continue
        }
        ;(n.set(e.subarray(s, s + u), this.pos),
          (this.pos += u),
          (s += u),
          this.pos === i && (this.process(r, 0), (this.pos = 0)))
      }
      return ((this.length += e.length), this.roundClean(), this)
    }
    digestInto(e) {
      ;(xe(this), Ge(e, this), (this.finished = !0))
      let { buffer: r, view: n, blockLen: i, isLE: o } = this,
        { pos: s } = this
      ;((r[s++] = 128), K(this.buffer.subarray(s)), this.padOffset > i - s && (this.process(n, 0), (s = 0)))
      for (let l = s; l < i; l++) r[l] = 0
      ;(n.setBigUint64(i - 8, BigInt(this.length * 8), o), this.process(n, 0))
      let u = Q(e),
        x = this.outputLen
      if (x % 4) throw new Error("_sha2: outputLen must be aligned to 32bit")
      let d = x / 4,
        p = this.get()
      if (d > p.length) throw new Error("_sha2: outputLen bigger than state")
      for (let l = 0; l < d; l++) u.setUint32(4 * l, p[l], o)
    }
    digest() {
      let { buffer: e, outputLen: r } = this
      this.digestInto(e)
      let n = e.slice(0, r)
      return (this.destroy(), n)
    }
    _cloneInto(e) {
      ;((e ||= new this.constructor()), e.set(...this.get()))
      let { blockLen: r, buffer: n, length: i, finished: o, destroyed: s, pos: u } = this
      return ((e.destroyed = s), (e.finished = o), (e.length = i), (e.pos = u), i % r && e.buffer.set(n), e)
    }
    clone() {
      return this._cloneInto()
    }
  },
  v = Uint32Array.from([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225])
var Nr = Uint32Array.from([
    1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080,
    310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078,
    604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671,
    3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051,
    2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909,
    275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222,
    2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298,
  ]),
  M = new Uint32Array(64),
  we = class extends ee {
    constructor(e) {
      super(64, e, 8, !1)
    }
    get() {
      let { A: e, B: r, C: n, D: i, E: o, F: s, G: u, H: x } = this
      return [e, r, n, i, o, s, u, x]
    }
    set(e, r, n, i, o, s, u, x) {
      ;((this.A = e | 0),
        (this.B = r | 0),
        (this.C = n | 0),
        (this.D = i | 0),
        (this.E = o | 0),
        (this.F = s | 0),
        (this.G = u | 0),
        (this.H = x | 0))
    }
    process(e, r) {
      for (let l = 0; l < 16; l++, r += 4) M[l] = e.getUint32(r, !1)
      for (let l = 16; l < 64; l++) {
        let I = M[l - 15],
          b = M[l - 2],
          f = C(I, 7) ^ C(I, 18) ^ (I >>> 3),
          a = C(b, 17) ^ C(b, 19) ^ (b >>> 10)
        M[l] = (a + M[l - 7] + f + M[l - 16]) | 0
      }
      let { A: n, B: i, C: o, D: s, E: u, F: x, G: d, H: p } = this
      for (let l = 0; l < 64; l++) {
        let I = C(u, 6) ^ C(u, 11) ^ C(u, 25),
          b = (p + I + We(u, x, d) + Nr[l] + M[l]) | 0,
          a = ((C(n, 2) ^ C(n, 13) ^ C(n, 22)) + Ke(n, i, o)) | 0
        ;((p = d), (d = x), (x = u), (u = (s + b) | 0), (s = o), (o = i), (i = n), (n = (b + a) | 0))
      }
      ;((n = (n + this.A) | 0),
        (i = (i + this.B) | 0),
        (o = (o + this.C) | 0),
        (s = (s + this.D) | 0),
        (u = (u + this.E) | 0),
        (x = (x + this.F) | 0),
        (d = (d + this.G) | 0),
        (p = (p + this.H) | 0),
        this.set(n, i, o, s, u, x, d, p))
    }
    roundClean() {
      K(M)
    }
    destroy() {
      ;(this.set(0, 0, 0, 0, 0, 0, 0, 0), K(this.buffer))
    }
  },
  ge = class extends we {
    A = v[0] | 0
    B = v[1] | 0
    C = v[2] | 0
    D = v[3] | 0
    E = v[4] | 0
    F = v[5] | 0
    G = v[6] | 0
    H = v[7] | 0
    constructor() {
      super(32)
    }
  }
var ze = je(() => new ge(), qe(1))
var Pr = 24e3
function Jr(t) {
  return Array.from(ze(t), (e) => e.toString(16).padStart(2, "0")).join("")
}
function $r(t) {
  return Jr(new TextEncoder().encode(t))
}
function re(t) {
  return {
    ...t,
    text: t.locator.kind === "text" && (t.textLength ?? t.text.length) <= Pr ? t.text : "",
    textDigest: t.textDigest ?? $r(t.text),
    textLength: t.textLength ?? t.text.length,
  }
}
var Vr = `${q}.editor-bridge`,
  F = (t) => (t !== null && typeof t == "object" && !Array.isArray(t) ? t : null),
  ye = (t) => {
    if (t === void 0 || t === "") return {}
    let e = F(typeof t == "string" ? JSON.parse(t) : t)
    if (!e) throw new Error("input \u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002")
    return e
  },
  me = (t) => ({
    documentId: t.id,
    name: t.name,
    kind: t.kind,
    revision: t.revision,
    documentVersion: t.versions[0].id,
    favorite: t.favorite,
    trashed: t.trashedAt !== null,
    updatedAt: t.updatedAt,
    size: t.versions[0].file.size,
  })
function Gr(t, e, r) {
  let n = F(t),
    i = n && F(n.reference),
    o = e ?? i?.text
  if (
    !n ||
    typeof n.documentId != "string" ||
    typeof n.documentVersion != "string" ||
    !n.documentVersion ||
    typeof n.sessionId != "string" ||
    !i ||
    typeof o != "string" ||
    typeof i.label != "string" ||
    typeof i.version != "string" ||
    !F(i.locator)
  )
    throw new Error(
      "\u5F15\u7528\u7F3A\u5C11 Office \u6587\u6863\u5B9A\u4F4D\uFF0C\u8BF7\u91CD\u65B0\u5F15\u7528\u539F\u6587\u3002",
    )
  if (n.state !== void 0 && n.state !== "saved" && n.state !== "session")
    throw new Error("\u5F15\u7528\u7684\u6765\u6E90\u72B6\u6001\u65E0\u6548\u3002")
  return {
    state: n.state ?? "saved",
    ...(typeof n.revision == "string" ? { revision: n.revision } : {}),
    documentId: n.documentId,
    documentVersion: n.documentVersion,
    sessionId: n.sessionId,
    reference: {
      label: i.label,
      text: o,
      ...(r?.textDigest ? { textDigest: r.textDigest, textLength: r.textLength } : {}),
      locator: i.locator,
      version: i.version,
    },
  }
}
function Xe(t, e) {
  let r = new Map(),
    n = new Map(),
    i = new Map(),
    o = new Map()
  t.subscriptions.add(
    t.commands.register(Vr, ({ arguments: f }) => {
      let a = F(f)
      if (!a || typeof a.sessionId != "string") throw new Error("\u7F16\u8F91\u5668\u6D88\u606F\u65E0\u6548\u3002")
      if (a.type === "ready" && typeof a.documentId == "string") {
        let h = { sessionId: a.sessionId, documentId: a.documentId }
        ;(r.set(h.sessionId, h), o.get(h.sessionId)?.resolve(h))
      } else if (a.type === "failed")
        o.get(a.sessionId)?.reject(
          new Error(typeof a.error == "string" ? a.error : "\u6587\u6863\u6253\u5F00\u5931\u8D25\u3002"),
        )
      else if (a.type === "closed") {
        r.delete(a.sessionId)
        for (let h of n.values())
          h.sessionId === a.sessionId &&
            h.finish(
              void 0,
              new Error(
                "\u6587\u6863\u7F16\u8F91\u4F1A\u8BDD\u5DF2\u5173\u95ED\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u76EE\u6807\u3002",
              ),
            )
        for (let [h, w] of i) w.sessionId === a.sessionId && i.delete(h)
      } else if (a.type === "reply" && typeof a.requestId == "string") {
        let h = n.get(a.requestId)
        if (h?.sessionId === a.sessionId) h.finish(a.value, typeof a.error == "string" ? new Error(a.error) : void 0)
        else {
          let w = F(a.value)
          if (Array.isArray(w?.images))
            for (let g of w.images) {
              let y = F(g)
              typeof y?.id == "string" && t.resources.release({ id: y.id }).catch(() => {})
            }
        }
      }
      return null
    }),
  )
  let s = (f, a, h, w, g = 3e4) => {
      w.throwIfAborted()
      let y = crypto.randomUUID()
      return new Promise((m, A) => {
        let E = () => {
            ;(t.views.broadcast({ type: "office-agent-cancel", sessionId: f.sessionId, requestId: y }).catch(() => {}),
              L(void 0, w.reason instanceof Error ? w.reason : new Error("\u64CD\u4F5C\u5DF2\u53D6\u6D88\u3002")))
          },
          R = setTimeout(() => {
            ;(t.views.broadcast({ type: "office-agent-cancel", sessionId: f.sessionId, requestId: y }).catch(() => {}),
              L(
                void 0,
                new Error(
                  "\u7F16\u8F91\u5668\u54CD\u5E94\u8D85\u65F6\u3002\u8BF7\u5148\u68C0\u67E5\u6587\u6863\u4E2D\u7684\u5B9E\u9645\u5185\u5BB9\uFF0C\u518D\u91CD\u65B0\u8BFB\u53D6\uFF1B\u4E0D\u8981\u76F4\u63A5\u91CD\u8BD5\u5199\u5165\u6216\u65B0\u5EFA\u3002",
                ),
              ))
          }, g),
          L = (te, be) => {
            n.delete(y) && (clearTimeout(R), w.removeEventListener("abort", E), be ? A(be) : m(te ?? null))
          }
        ;(n.set(y, { sessionId: f.sessionId, finish: L }),
          w.addEventListener("abort", E, { once: !0 }),
          t.views
            .broadcast({
              type: "office-agent-request",
              sessionId: f.sessionId,
              documentId: f.documentId,
              requestId: y,
              operation: a,
              ...h,
            })
            .catch((te) => L(void 0, te)),
          w.aborted && E())
      })
    },
    u = async (f, a) => {
      a.throwIfAborted()
      let h = crypto.randomUUID(),
        w = await new Promise((g, y) => {
          let m = (R, L) => {
              ;(clearTimeout(E), a.removeEventListener("abort", A), o.delete(h), L ? y(L) : g(R))
            },
            A = () =>
              m(
                void 0,
                new Error(
                  "\u7B49\u5F85\u6587\u6863\u6253\u5F00\u5DF2\u53D6\u6D88\u3002\u65B0\u5EFA\u64CD\u4F5C\u53EF\u80FD\u5DF2\u5B8C\u6210\uFF0C\u8BF7\u5148\u67E5\u8BE2\u6587\u6863\u5E93\uFF0C\u4E0D\u8981\u91CD\u590D\u65B0\u5EFA\u3002",
                ),
              ),
            E = setTimeout(
              () =>
                m(
                  void 0,
                  new Error(
                    "\u6587\u6863\u672A\u80FD\u6253\u5F00\u3002\u8BF7\u68C0\u67E5 Office \u6587\u6863\u5E93\uFF0C\u52FF\u76F4\u63A5\u91CD\u8BD5\u65B0\u5EFA\u3002",
                  ),
                ),
              45e3,
            )
          ;(o.set(h, { resolve: (R) => m(R), reject: (R) => m(void 0, R) }),
            a.addEventListener("abort", A, { once: !0 }),
            t.views.open(`${q}.editor`, { state: { ...f, agentSessionId: h } }).catch((R) => m(void 0, R)),
            a.aborted && A())
        })
      return (a.throwIfAborted(), w)
    },
    x = async (f, a, h) => {
      let w = [...r.values()]
        .filter((g) => g.documentId === f)
        .sort((g, y) => +(y.sessionId === a) - +(g.sessionId === a))
      for (let g of w)
        try {
          return (await s(g, "ping", {}, h, 2e3), g)
        } catch {
          ;(h.throwIfAborted(), r.delete(g.sessionId))
        }
      return u({ documentId: f }, h)
    },
    d = async (f, a, h) => {
      if (typeof f != "string")
        throw new Error(
          "\u8BF7\u5148\u5217\u51FA\u4EFB\u52A1\u4E2D\u7684 Office \u5F15\u7528\u5E76\u4F7F\u7528\u8FD4\u56DE\u7684 referenceId\u3002",
        )
      if (h !== void 0 && (typeof h != "string" || !h))
        throw new Error("sourceMessageId \u5FC5\u987B\u4F7F\u7528 references \u8FD4\u56DE\u7684\u6D88\u606F ID\u3002")
      let w = await a.references.resolve(f, typeof h == "string" ? { sourceMessageId: h } : void 0)
      if (w.locator?.version !== 1 && w.locator?.version !== 2)
        throw new Error(
          "\u6B64\u5F15\u7528\u7248\u672C\u4E0D\u53D7\u652F\u6301\uFF0C\u8BF7\u91CD\u65B0\u5F15\u7528\u3002",
        )
      return w
    },
    p = async (f, a) => {
      let h = typeof f.targetId == "string" ? i.get(f.targetId) : void 0
      if (
        !h ||
        h.expires < Date.now() ||
        h.taskId !== a.scope.taskId ||
        h.branchId !== a.scope.branchId ||
        h.runId !== a.scope.runId
      )
        throw new Error(
          "\u6587\u6863\u76EE\u6807\u5DF2\u8FC7\u671F\u6216\u4E0D\u5C5E\u4E8E\u672C\u6B21\u6267\u884C\u3002\u8BF7\u5728\u5F53\u524D\u6267\u884C\u4E2D\u91CD\u65B0\u8BFB\u53D6\u5F15\u7528\u6216\u6253\u5F00\u6587\u6863 ID\u3002",
        )
      if (h.referenceId) {
        let w = await d(h.referenceId, a, h.sourceMessageId)
        if (
          w.scope.taskId !== h.taskId ||
          w.scope.branchId !== h.branchId ||
          w.sourceMessageId !== h.sourceMessageId ||
          (f.referenceId !== void 0 && f.referenceId !== h.referenceId)
        )
          throw new Error("\u539F\u5F15\u7528\u7684\u8BBF\u95EE\u6743\u9650\u5DF2\u53D8\u5316\u3002")
      }
      return ((h.expires = Date.now() + 6e5), h)
    },
    l = (f, a, h, w, g) => {
      if ((h.signal.throwIfAborted(), typeof a.revision != "string"))
        throw new Error("\u7F16\u8F91\u5668\u672A\u8FD4\u56DE\u6709\u6548\u6587\u6863\u7248\u672C\u3002")
      let y = crypto.randomUUID()
      for (let [R, L] of i) L.expires < Date.now() && i.delete(R)
      for (; i.size >= 128; ) i.delete(i.keys().next().value)
      let m = F(a.reference),
        A = m ? { ...m, text: m.text ?? g?.text ?? "" } : g
      i.set(y, {
        ...f,
        ...(w ? { referenceId: w.referenceId, sourceMessageId: w.sourceMessageId } : {}),
        ...h.scope,
        revision: a.revision,
        reference: A,
        expires: Date.now() + 6e5,
      })
      let E = { ...a }
      return (
        delete E.reference,
        {
          ok: !0,
          documentId: f.documentId,
          targetId: y,
          ...(w ? { referenceId: w.referenceId, sourceMessageId: w.sourceMessageId } : {}),
          ...E,
        }
      )
    },
    I = async () => {
      if (!e) throw new Error("\u6587\u6863\u5E93\u672A\u521D\u59CB\u5316\u3002")
      return (await e.execute("list")).documents
    },
    b = (f, a) => {
      t.subscriptions.add(
        t.agent.registerTool(`${q}.${f}`, async (h, w) => {
          try {
            return (w.signal.throwIfAborted(), await a(h, w))
          } catch (g) {
            return { ok: !1, error: g instanceof Error ? g.message : String(g) }
          }
        }),
      )
    }
  ;(b("capabilities", async (f, a) => {
    if (f.targetId) {
      let h = await p(f, a)
      return s(h, "capabilities", { expectedRevision: h.revision }, a.signal)
    }
    return {
      ok: !0,
      formats: ["docx", "xlsx", "pptx", "pdf"],
      skills: ["office", "docx", "xlsx", "pptx", "pdf"],
      entryPoints: {
        snapshot: "lexora_reference_list \u2192 lexora_reference_read(sourceMessageId,kind,referenceId[,offset,limit])",
        reference:
          "references \u2192 read(sourceMessageId,referenceId)\uFF08\u9A8C\u8BC1\u5F53\u524D\u5B9A\u4F4D\u5E76\u7ED1\u5B9A\u76EE\u6807\uFF09",
        library: "documents \u2192 read(documentId)",
        create: "create(kind,name)",
      },
      workflow:
        "lexora_reference_read \u8BFB\u53D6\u4E0D\u53EF\u53D8\u5386\u53F2\u5FEB\u7167\uFF1Bread \u8BFB\u53D6\u5F53\u524D\u6587\u6863\u5E76\u8FD4\u56DE targetId/revision\uFF0C\u5B9A\u4F4D\u6216\u539F\u6587\u6539\u53D8\u65F6\u62D2\u7EDD\u91CD\u65B0\u7ED1\u5B9A\u3002targetId \u4EC5\u5728\u5F53\u524D\u6267\u884C\u6709\u6548\uFF0C\u4E0D\u8DE8\u8F6E\u6B21\u6216\u5B50 Agent \u590D\u7528\u3002edit \u4F7F\u7528 expectedRevision\uFF1B\u81EA\u8EAB\u4FEE\u6539\u540E\u7528 read(targetId) \u7EE7\u7EED\u8BFB\u53D6\u6700\u65B0\u6587\u6863\uFF0C\u539F\u5F15\u7528\u4ECD\u662F\u5FEB\u7167\u3002export \u53D1\u5E03\u4EFB\u52A1\u4EA7\u7269\uFF1Brender \u8FD4\u56DE\u6A21\u578B\u56FE\u7247\uFF08\u4EE5\u76EE\u6807\u80FD\u529B\u4E3A\u51C6\uFF09\u3002",
      tools: ["references", "documents", "create", "read", "edit", "organize", "render", "export"],
      limits: { fileBytes: 67108864, retainedVersions: 12, targetLifetimeSeconds: 600 },
      persistence:
        "\u672C\u5730\u6587\u4EF6\u7F16\u8F91\u5148\u5E94\u7528\u5230\u5F53\u524D\u7F13\u51B2\uFF0Cedit(action=save) \u624D\u5199\u56DE\u539F\u4EF6\uFF1BOffice \u65B0\u5EFA\u548C\u5BFC\u5165\u7684\u6587\u6863\u5E93\u6587\u4EF6\u81EA\u52A8\u4FDD\u5B58\u3002export \u53D1\u5E03\u5F53\u524D\u5185\u5BB9\u4E3A\u4EFB\u52A1\u4EA7\u7269\uFF0C\u4E0D\u6539\u53D8\u539F\u4EF6\u4FDD\u5B58\u72B6\u6001\u3002",
    }
  }),
    b("references", async (f, a) => {
      let h = await a.references.list()
      return {
        ok: !0,
        items: h.items.map((w) => ({
          referenceId: w.referenceId,
          sourceMessageId: w.sourceMessageId,
          title: w.title,
          excerpt: w.excerpt,
        })),
        truncated: h.truncated,
      }
    }),
    b("documents", async (f) => {
      let a = typeof f.query == "string" ? f.query.toLocaleLowerCase() : ""
      return {
        ok: !0,
        documents: (await I())
          .filter(
            (w) =>
              (f.trash === !0 ? w.trashedAt !== null : w.trashedAt === null) &&
              (!f.kind || w.kind === f.kind) &&
              (!a || w.name.toLocaleLowerCase().includes(a)),
          )
          .map(me),
      }
    }),
    b("create", async (f, a) => {
      if (!["docx", "xlsx", "pptx", "pdf"].includes(String(f.kind)))
        throw new Error("kind \u5FC5\u987B\u662F docx\u3001xlsx\u3001pptx \u6216 pdf\u3002")
      let h = j(f.name, f.kind),
        w = await u({ create: { kind: f.kind, name: h } }, a.signal),
        g = F(await s(w, "read", {}, a.signal))
      if (!g)
        throw new Error(
          "\u6587\u4EF6\u5DF2\u521B\u5EFA\uFF0C\u4F46\u8BFB\u53D6\u5931\u8D25\u3002\u8BF7\u5148\u67E5\u8BE2\u6587\u6863\u5E93\uFF0C\u52FF\u91CD\u590D\u65B0\u5EFA\u3002",
        )
      return l(w, g, a)
    }),
    b("read", async (f, a) => {
      let h = F(f.query),
        w = h
          ? { query: { operation: typeof h.operation == "string" ? h.operation : "context", input: ye(h.input) } }
          : {}
      if (f.targetId) {
        let A = await p(f, a),
          E = F(
            await s(
              A,
              "read",
              { expectedRevision: A.revision, ...(A.reference ? { reference: re(A.reference) } : {}), ...w },
              a.signal,
            ),
          )
        if (!E || E.revision !== A.revision)
          throw new Error(
            "\u8BFB\u53D6\u65F6\u6587\u6863\u7248\u672C\u53D8\u5316\u3002\u8BF7\u91CD\u65B0\u6253\u5F00\u6700\u65B0\u6587\u6863\u76EE\u6807\u3002",
          )
        F(E.reference) && (A.reference = E.reference)
        let R = { ...E }
        return (delete R.reference, { ok: !0, targetId: f.targetId, documentId: A.documentId, ...R })
      }
      if (f.referenceId) {
        let A = await d(f.referenceId, a, f.sourceMessageId),
          E = Gr(A.locator.data, A.text, A)
        if (E.state === "session" && r.get(E.sessionId)?.documentId !== E.documentId)
          throw new Error(
            "\u672A\u4FDD\u5B58\u5F15\u7528\u7684\u7F16\u8F91\u4F1A\u8BDD\u5DF2\u5173\u95ED\u3002\u8BF7\u8BFB\u53D6\u5386\u53F2\u5FEB\u7167\uFF0C\u6216\u91CD\u65B0\u6253\u5F00\u6587\u6863\u5E76\u5F15\u7528\u3002",
          )
        let R = await x(E.documentId, E.sessionId, a.signal),
          L = F(
            await s(
              R,
              "read",
              {
                ...(E.state === "saved"
                  ? { documentVersion: E.documentVersion }
                  : { referenceState: "session", referenceRevision: E.revision ?? "" }),
                reference: re(E.reference),
                ...w,
              },
              a.signal,
            ),
          )
        if (!L) throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u5F15\u7528\u3002")
        return l(R, L, a, A, E.reference)
      }
      let g = (await I()).find((A) => A.id === f.documentId && A.trashedAt === null)
      if (!g)
        throw new Error(
          "\u8BF7\u63D0\u4F9B references \u8FD4\u56DE\u7684 referenceId\u3001\u5DF2\u6709 targetId\uFF0C\u6216 documents \u8FD4\u56DE\u7684 documentId\u3002\u4E0D\u8981\u6309\u540D\u79F0\u731C\u6D4B\u76EE\u6807\u3002",
        )
      let y = await x(g.id, void 0, a.signal),
        m = F(await s(y, "read", { ...w }, a.signal))
      if (!m) throw new Error("\u6587\u6863\u8BFB\u53D6\u5931\u8D25\u3002")
      return l(y, m, a)
    }),
    b("edit", async (f, a) => {
      let h = await p(f, a)
      if (h.revision !== f.expectedRevision)
        throw new Error(
          "\u4FEE\u6539\u76EE\u6807\u7248\u672C\u5DF2\u53D8\u5316\u3002\u8BF7\u4F7F\u7528\u6700\u8FD1\u4E00\u6B21\u8BFB\u53D6\u6216\u4FEE\u6539\u8FD4\u56DE\u7684 revision\uFF0C\u52FF\u91CD\u8BD5\u65E7\u4FEE\u6539\u3002",
        )
      if (typeof f.operation != "string")
        throw new Error(
          "\u8BF7\u4F7F\u7528 capabilities \u6216\u8BFB\u53D6\u7ED3\u679C\u4E2D\u516C\u5E03\u7684\u64CD\u4F5C\u3002",
        )
      let w = {
          expectedRevision: h.revision,
          ...(h.reference ? { reference: re(h.reference) } : {}),
          action: f.operation,
          input: ye(f.input),
        },
        g
      try {
        if (
          ((g = F(await s(h, "edit", w, a.signal))),
          !g || typeof g.revision != "string" || typeof g.mutated != "boolean" || typeof g.saved != "boolean")
        )
          throw new Error("\u7F16\u8F91\u5668\u672A\u8FD4\u56DE\u5B8C\u6574\u64CD\u4F5C\u56DE\u6267\u3002")
      } catch (y) {
        return (
          i.delete(String(f.targetId)),
          {
            ok: !1,
            outcome: "unknown",
            documentId: h.documentId,
            error: `${y instanceof Error ? y.message : String(y)} \u8BF7\u68C0\u67E5\u5F53\u524D\u6587\u6863\uFF1B\u6B64\u76EE\u6807\u5DF2\u64A4\u56DE\uFF0C\u4E0D\u8981\u91CD\u590D\u6267\u884C\u4FEE\u6539\u3002`,
          }
        )
      }
      return (
        (h.revision = g.revision),
        g.mutated === !0 && (h.reference = void 0),
        { ok: !0, targetId: f.targetId, documentId: h.documentId, ...g }
      )
    }),
    b("organize", async (f, a) => {
      let h = ["rename", "favorite", "trash", "restore", "duplicate", "restoreVersion"]
      if (f.action === "versions") {
        let y = (await I()).find((m) => m.id === f.documentId)
        if (!y) throw new Error("\u6587\u6863\u4E0D\u5B58\u5728\u3002")
        return {
          ok: !0,
          ...me(y),
          versions: y.versions.map((m) => ({ id: m.id, createdAt: m.createdAt, label: m.label, size: m.file.size })),
        }
      }
      if (!h.includes(String(f.action)))
        throw new Error(
          "\u4E0D\u652F\u6301\u6B64\u6587\u6863\u7BA1\u7406\u64CD\u4F5C\u3002\u6C38\u4E45\u5220\u9664\u8BF7\u5728\u6587\u6863\u5E93\u4E2D\u64CD\u4F5C\u3002",
        )
      let w = (await I()).find((y) => y.id === f.documentId)
      if (!w || w.revision !== f.expectedRevision)
        throw new Error(
          "\u6587\u6863\u5E93\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u67E5\u8BE2 documents\u3002",
        )
      a.signal.throwIfAborted()
      let g = await e.execute(String(f.action), {
        id: w.id,
        revision: w.revision,
        ...(f.name !== void 0 ? { name: f.name } : {}),
        ...(f.value !== void 0 ? { value: f.value } : {}),
        ...(f.versionId !== void 0 ? { versionId: f.versionId } : {}),
      })
      return { ok: !0, document: me(g) }
    }),
    b("render", async (f, a) => {
      let h = await p(f, a),
        w = F(await s(h, "render", { expectedRevision: h.revision, input: ye(f.input) }, a.signal, 45e3)),
        g = Array.isArray(w?.images) ? w.images : []
      try {
        for (let y of g) {
          let m = F(y)
          if (!m || typeof m.id != "string") throw new Error("\u6E32\u67D3\u8D44\u6E90\u65E0\u6548\u3002")
          await a.results.addImage({ resource: { id: m.id } })
        }
        return {
          ok: !0,
          targetId: f.targetId,
          revision: h.revision,
          images: g.map((y) => {
            let m = F(y)
            return { name: m.name, mimeType: m.mimeType, size: m.size }
          }),
        }
      } finally {
        for (let y of g) {
          let m = F(y)
          typeof m?.id == "string" && (await t.resources.release({ id: m.id }).catch(() => {}))
        }
      }
    }),
    b("export", async (f, a) => {
      let h = await p(f, a)
      if (f.expectedRevision !== h.revision)
        throw new Error("\u5BFC\u51FA\u7248\u672C\u5DF2\u53D8\u5316\uFF0C\u8BF7\u4F7F\u7528\u6700\u65B0 revision\u3002")
      let w = F(await s(h, "export", { expectedRevision: h.revision }, a.signal)),
        g = F(w?.file)
      if (!g || typeof g.id != "string" || typeof w?.revision != "string")
        throw new Error("\u6587\u6863\u672A\u80FD\u5BFC\u51FA\u3002")
      h.revision = w.revision
      try {
        let y = await a.artifacts.publish({ resource: { id: g.id }, name: j(f.name ?? g.name, w.kind) })
        return {
          ok: !0,
          targetId: f.targetId,
          revision: h.revision,
          documentVersion: w.documentVersion,
          artifact: { ...y },
        }
      } finally {
        await t.resources.release({ id: g.id }).catch(() => {})
      }
    }),
    t.signal.addEventListener(
      "abort",
      () => {
        for (let f of [...n.values()]) f.finish(void 0, new Error("Office \u63D2\u4EF6\u5DF2\u505C\u6B62\u3002"))
        for (let f of [...o.values()]) f.reject(new Error("Office \u63D2\u4EF6\u5DF2\u505C\u6B62\u3002"))
        ;(r.clear(), i.clear())
      },
      { once: !0 },
    ))
}
function At(t) {
  let e = new Z({
    get: () => t.storage.get(),
    set: (r) => t.storage.set(r),
    files: () => t.resources.listFiles(),
    release: (r) => t.resources.release(r),
    publish: () => t.views.broadcast({ type: "office-library-changed" }),
  })
  ;(Xe(t, e),
    t.subscriptions.add(
      t.commands.register(`${q}.manage`, ({ arguments: r }) => {
        if (!r || typeof r != "object" || Array.isArray(r) || typeof r.action != "string")
          throw new Error("\u6587\u6863\u64CD\u4F5C\u53C2\u6570\u65E0\u6548\u3002")
        return e.execute(r.action, r).then(
          (n) => ({ ok: !0, value: n }),
          (n) => ({
            ok: !1,
            error:
              n instanceof Error
                ? n.message
                : "\u6587\u6863\u5E93\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
          }),
        )
      }),
    ))
}
export { At as activate }
/*! Bundled license information:

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)

@noble/hashes/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
