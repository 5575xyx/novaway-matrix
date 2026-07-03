// @ts-ignore
import kuaiShosignCore from "./kuaiShoSignCore.js"
import qs from "qs"
// @ts-ignore
import crypto from "crypto-js"

interface ISignParams {
  json: Record<string, any>
  type: "form-data" | "json"
  url: string
}

class KwaiSign {
  exports: any = {}

  constructor() {
    const obj = {
      exports: {},
      id: 75407,
      loaded: true,
    }
    kuaiShosignCore[75407](obj)
    this.exports = obj.exports
  }

  sign(params: ISignParams) {
    return new Promise(async (resolve, reject) => {
      const { url } = params
      const md5 = this.md5(params)

      this.exports.realm.global["$encode"](md5, {
        suc(s: string) {
          resolve(`${url}?__NS_sig3=${s}`)
        },
        err(e: string) {
          console.error("签名失败：", e)
          reject(e)
        },
      })
    })
  }

  private md5({ json, type }: ISignParams) {
    let str = ""
    if (type === "form-data") {
      str = qs.stringify(json)
    } else {
      str = JSON.stringify(json)
    }
    return crypto.MD5(str).toString()
  }
}

const kwaiSign = new KwaiSign()
export default kwaiSign
