import { net } from "electron"

export interface RequestNetResult<T> {
  status: number
  headers: Record<any, any>
  data: T
}

export interface RequestNetParams {
  headers?: Record<string, string | string[]>
  url?: string
  body?: any
  method?: "GET" | "POST" | "PUT" | "DELETE"
  isFile?: boolean
}

const requestNet = <T = any>({
  headers,
  body,
  method,
  url,
  isFile,
}: RequestNetParams): Promise<RequestNetResult<T>> => {
  return new Promise((resolve, reject) => {
    try {
      const req = net.request({
        method: method || "GET",
        url: url!,
        headers,
      })

      // 设置请求头
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          req.setHeader(key, value as string)
        }
      }

      // 处理响应
      req.on("response", (response) => {
        let data = ""
        response.on("data", (chunk: Buffer) => {
          data += chunk.toString()
        })
        response.on("end", () => {
          let parsedData: T
          try {
            parsedData = JSON.parse(data)
          } catch {
            parsedData = data as T
          }
          resolve({
            status: response.statusCode,
            headers: response.headers as Record<string, string>,
            data: parsedData,
          })
        })
      })

      // 错误处理
      req.on("error", (error) => {
        console.log("error:", error)
        reject(error)
      })

      if (isFile) {
        req.setHeader("Content-Type", "application/octet-stream")
        req.write(body)
      } else {
        if (body) {
          req.setHeader("Content-Type", "application/json")
          req.write(typeof body === "string" ? body : JSON.stringify(body))
        }
      }
      req.end()
    } catch (error) {
      reject(error)
    }
  })
}

export default requestNet
